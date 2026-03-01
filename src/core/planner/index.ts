/**
 * 智能任务规划器 - 复杂任务分解与执行 (修复版)
 */

import { LLMMessage, TaskResult, RiskLevel } from '../../types';
import { getLLMManager } from '../../llm';
import { getSkillRegistry } from '../../skills/registry';
import { getToolRegistry } from '../../tools';
import { getLogger } from '../../observability/logger';
import { getEnhancedMemory } from '../../memory/v3';
import { getIntelligentRouter, IntentHierarchy } from '../router/intelligent-router';
import { Skill } from '../../skills/base';
import { BaseTool, ToolResult } from '../../tools/base';

const logger = getLogger('core:planner');

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

export interface ExecutionPlan {
  id: string;
  description: string;
  goal: string;
  tasks: PlannedTask[];
  dependencies: TaskDependency[];
  parallelGroups: string[][];
  estimatedDuration: number;
  risks: string[];
  fallbackPlanId?: string;
  createdAt: number;
  status: PlanStatus;
}

export interface PlannedTask {
  id: string;
  order: number;
  description: string;
  type: string;
  skillName: string;
  params: Record<string, unknown>;
  riskLevel: RiskLevel;
  dependencies: string[];
  estimatedDuration: number;
  dependsOn: string[];
  parallelizable: boolean;
  maxRetries: number;
  currentRetries: number;
  status: TaskStatus;
  result?: TaskResult;
}

export interface TaskDependency {
  taskId: string;
  dependsOn: string[];
  type: 'sequential' | 'conditional' | 'parallel';
}

export type PlanStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused';
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface ExecutionContext {
  sessionId: string;
  userId?: string;
  workspaceDir?: string;
  completedTasks: Map<string, TaskResult>;
  variables: Record<string, unknown>;
  userInput: string;
  intent?: IntentHierarchy;
}

export interface PlanExecutionResult {
  success: boolean;
  plan: ExecutionPlan;
  results: TaskResult[];
  finalMessage: string;
  duration: number;
  adjustments: string[];
}

// ═══════════════════════════════════════════════════════════════
// 智能任务规划器
// ═══════════════════════════════════════════════════════════════

export class TaskPlanner {
  private llm = getLLMManager();
  private skillRegistry = getSkillRegistry();
  private toolRegistry = getToolRegistry();
  private memory = getEnhancedMemory();
  private router = getIntelligentRouter();
  
  private planCounter = 0;
  private activePlans: Map<string, ExecutionPlan> = new Map();
  
  /**
   * 统一执行方法
   */
  private async executeSkillOrTool(
    name: string,
    params: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<{ success: boolean; message: string; error?: string; data?: any }> {
    const skill = this.skillRegistry.get(name);
    const tool = this.toolRegistry.get(name);
    
    if (skill) {
      const result = await skill.run(params, {
        sessionId: context.sessionId,
        conversationId: context.sessionId,
        userId: context.userId,
      });
      return {
        success: result.success,
        message: result.message || '',
        error: result.error,
        data: result.data,
      };
    } else if (tool) {
      const result: ToolResult = await tool.safeExecute(params, {
        sessionId: context.sessionId,
        conversationId: context.sessionId,
      });
      return {
        success: result.success,
        message: result.success ? JSON.stringify(result.data) : '',
        error: result.error,
        data: result.data,
      };
    } else {
      return {
        success: false,
        message: '',
        error: `工具不存在: ${name}`,
      };
    }
  }
  
  async createPlan(
    userInput: string,
    intent: IntentHierarchy,
    context: ExecutionContext
  ): Promise<ExecutionPlan> {
    logger.info(`[任务规划] 开始规划: ${userInput.slice(0, 50)}...`);
    
    const tools = this.toolRegistry.getAll().map((t: any) => ({
      name: t.name,
      description: t.description,
      whenToUse: '',
    }));
    
    const skills = this.skillRegistry.getAll().map((s: any) => ({
      name: s.name,
      description: s.description,
      whenToUse: s.whenToUse || '',
      inputSchema: s.inputSchema,
    }));
    
    const allTools = [...tools, ...skills];
    
    const toolsDesc = allTools.map(t => {
      let desc = `- ${t.name}: ${t.description}`;
      if (t.whenToUse) desc += ` [适用: ${t.whenToUse}]`;
      return desc;
    }).join('\n');
    
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个任务规划专家。将复杂任务分解为可执行的子任务。

## 可用工具
${toolsDesc}

## 用户意图
- 表面意图: ${intent.surface}
- 深层意图: ${intent.deep}
- 执行意图: ${intent.execution}
- 复杂度: ${intent.complexity}

## 输出格式（JSON）

{
  "description": "计划描述",
  "goal": "最终目标",
  "tasks": [
    {
      "id": "task_1",
      "order": 1,
      "skillName": "工具名称",
      "description": "任务描述",
      "params": {},
      "dependsOn": [],
      "parallelizable": false,
      "estimatedDuration": 10,
      "maxRetries": 2
    }
  ],
  "risks": [],
  "estimatedDuration": 30
}`
      },
      {
        role: 'user',
        content: `请为以下请求创建执行计划：\n\n${userInput}\n\n要求：任务要具体、可执行，参数要完整。`
      }
    ];
    
    try {
      const response = await this.llm.chat(messages, { temperature: 0.2 });
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        const plan: ExecutionPlan = {
          id: `plan_${++this.planCounter}_${Date.now()}`,
          description: parsed.description || '执行计划',
          goal: parsed.goal || intent.deep,
          tasks: this.validateAndEnhanceTasks(parsed.tasks || [], allTools),
          dependencies: this.buildDependencies(parsed.tasks || []),
          parallelGroups: this.identifyParallelGroups(parsed.tasks || []),
          estimatedDuration: parsed.estimatedDuration || 30,
          risks: parsed.risks || [],
          createdAt: Date.now(),
          status: 'pending',
        };
        
        this.activePlans.set(plan.id, plan);
        logger.info(`[任务规划] 创建计划: ${plan.id}, 任务数: ${plan.tasks.length}`);
        
        return plan;
      }
    } catch (error) {
      logger.error(`[任务规划] 错误: ${error}`);
    }
    
    return this.createSimplePlan(userInput, intent);
  }
  
  async executePlan(
    plan: ExecutionPlan,
    context: ExecutionContext
  ): Promise<PlanExecutionResult> {
    logger.info(`[计划执行] 开始执行: ${plan.id}`);
    const startTime = Date.now();
    
    plan.status = 'running';
    const results: TaskResult[] = [];
    const adjustments: string[] = [];
    
    try {
      for (const task of plan.tasks) {
        if (!this.checkDependencies(task, results)) {
          logger.warn(`[计划执行] 任务 ${task.id} 依赖未满足，跳过`);
          task.status = 'skipped';
          continue;
        }
        
        task.status = 'running';
        const result = await this.executeTaskWithRetry(task, context);
        
        task.result = result;
        task.status = result.success ? 'completed' : 'failed';
        results.push(result);
        
        context.completedTasks.set(task.id, result);
        
        if (!result.success) {
          const adjustment = await this.handleTaskFailure(task, plan, context);
          if (adjustment) {
            adjustments.push(adjustment);
          }
        }
        
        this.memory.recordEvent('task_execution', JSON.stringify({
          planId: plan.id,
          taskId: task.id,
          success: result.success,
          duration: result.duration,
        }));
      }
      
      const successCount = results.filter(r => r.success).length;
      const success = successCount === results.length;
      
      plan.status = success ? 'completed' : 'failed';
      
      const finalMessage = await this.generateFinalMessage(plan, results, context);
      
      const duration = (Date.now() - startTime) / 1000;
      
      logger.info(`[计划执行] 完成: ${plan.id}, 成功: ${successCount}/${results.length}`);
      
      return {
        success,
        plan,
        results,
        finalMessage,
        duration,
        adjustments,
      };
      
    } catch (error) {
      plan.status = 'failed';
      logger.error(`[计划执行] 错误: ${error}`);
      
      return {
        success: false,
        plan,
        results,
        finalMessage: `执行失败: ${error}`,
        duration: (Date.now() - startTime) / 1000,
        adjustments,
      };
    }
  }
  
  async adjustPlan(
    plan: ExecutionPlan,
    failedTask: PlannedTask,
    context: ExecutionContext
  ): Promise<ExecutionPlan> {
    logger.info(`[计划调整] 调整计划: ${plan.id}`);
    
    // 简单调整：跳过失败任务
    failedTask.status = 'skipped';
    
    for (const task of plan.tasks) {
      if (task.dependsOn.includes(failedTask.id)) {
        task.status = 'skipped';
      }
    }
    
    return plan;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // 私有方法
  // ═══════════════════════════════════════════════════════════════
  
  private validateAndEnhanceTasks(
    tasks: any[],
    availableTools: any[]
  ): PlannedTask[] {
    const result: PlannedTask[] = [];
    
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      
      const toolExists = availableTools.some(tool => tool.name === t.skillName);
      if (!toolExists) {
        logger.warn(`[任务验证] 工具不存在: ${t.skillName}, 跳过`);
        continue;
      }
      
      const task: PlannedTask = {
        id: t.id || `task_${i + 1}`,
        order: t.order || i + 1,
        description: t.description || '',
        type: t.skillName,
        skillName: t.skillName,
        params: t.params || {},
        riskLevel: RiskLevel.LOW,
        dependencies: [],
        estimatedDuration: t.estimatedDuration || 10,
        dependsOn: t.dependsOn || [],
        parallelizable: t.parallelizable ?? false,
        maxRetries: t.maxRetries || 2,
        currentRetries: 0,
        status: 'pending',
      };
      
      result.push(task);
    }
    
    return result;
  }
  
  private buildDependencies(tasks: any[]): TaskDependency[] {
    return tasks.map(t => ({
      taskId: t.id,
      dependsOn: t.dependsOn || [],
      type: t.parallelizable ? 'parallel' : 'sequential' as const,
    }));
  }
  
  private identifyParallelGroups(tasks: any[]): string[][] {
    const groups: string[][] = [];
    const processed = new Set<string>();
    
    for (const task of tasks) {
      if (processed.has(task.id)) continue;
      
      if (task.parallelizable && (!task.dependsOn || task.dependsOn.length === 0)) {
        const group = tasks
          .filter(t => t.parallelizable && (!t.dependsOn || t.dependsOn.length === 0))
          .map(t => t.id);
        
        if (group.length > 1) {
          groups.push(group);
          group.forEach(id => processed.add(id));
        }
      }
    }
    
    return groups;
  }
  
  private createSimplePlan(userInput: string, intent: IntentHierarchy): ExecutionPlan {
    return {
      id: `plan_${++this.planCounter}_${Date.now()}`,
      description: '简单执行计划',
      goal: intent.deep,
      tasks: [{
        id: 'task_1',
        order: 1,
        description: userInput,
        type: 'unknown',
        skillName: 'unknown',
        params: {},
        riskLevel: RiskLevel.LOW,
        dependencies: [],
        estimatedDuration: 10,
        dependsOn: [],
        parallelizable: false,
        maxRetries: 1,
        currentRetries: 0,
        status: 'pending',
      }],
      dependencies: [],
      parallelGroups: [],
      estimatedDuration: 10,
      risks: [],
      createdAt: Date.now(),
      status: 'pending',
    };
  }
  
  private checkDependencies(task: PlannedTask, completedResults: TaskResult[]): boolean {
    if (task.dependsOn.length === 0) return true;
    
    for (const depId of task.dependsOn) {
      const depResult = completedResults.find(r => r.taskId === depId);
      if (!depResult || !depResult.success) {
        return false;
      }
    }
    
    return true;
  }
  
  private async executeTaskWithRetry(
    task: PlannedTask,
    context: ExecutionContext
  ): Promise<TaskResult> {
    let lastError: string | undefined;
    
    for (let attempt = 0; attempt <= task.maxRetries; attempt++) {
      if (attempt > 0) {
        logger.info(`[任务执行] 重试 ${attempt}/${task.maxRetries}: ${task.id}`);
      }
      
      const result = await this.executeTask(task, context);
      
      if (result.success) {
        return result;
      }
      
      lastError = result.error;
    }
    
    return {
      taskId: task.id,
      success: false,
      data: {},
      message: '执行失败',
      error: lastError || '超过最大重试次数',
      duration: 0,
    };
  }
  
  private async executeTask(
    task: PlannedTask,
    context: ExecutionContext
  ): Promise<TaskResult> {
    const startTime = Date.now();
    
    logger.info(`[任务执行] ${task.id}: ${task.skillName}`);
    
    try {
      const result = await this.executeSkillOrTool(task.skillName, task.params, context);
      
      const duration = (Date.now() - startTime) / 1000;
      
      this.router.updateToolResult(task.skillName, result.success);
      
      return {
        taskId: task.id,
        success: result.success,
        data: result.data || {},
        message: result.message || '',
        error: result.error,
        duration,
      };
      
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      return {
        taskId: task.id,
        success: false,
        data: {},
        message: '执行失败',
        error: errorMsg,
        duration,
      };
    }
  }
  
  private async handleTaskFailure(
    task: PlannedTask,
    plan: ExecutionPlan,
    context: ExecutionContext
  ): Promise<string | null> {
    if (task.currentRetries < task.maxRetries) {
      return `任务 ${task.id} 失败，将重试`;
    }
    
    await this.adjustPlan(plan, task, context);
    return `任务 ${task.id} 失败，已调整计划`;
  }
  
  private async generateFinalMessage(
    plan: ExecutionPlan,
    results: TaskResult[],
    context: ExecutionContext
  ): Promise<string> {
    const successCount = results.filter(r => r.success).length;
    const failedCount = results.length - successCount;
    
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个智能助手。根据任务执行结果，给用户一个友好的回复。

## 执行计划
目标: ${plan.goal}

## 执行结果
- 总任务: ${results.length}
- 成功: ${successCount}
- 失败: ${failedCount}

## 规则
1. 总结执行结果
2. 如果有失败，说明原因
3. 使用自然语言，简洁明了`
      },
      {
        role: 'user',
        content: context.userInput,
      },
    ];
    
    try {
      const response = await this.llm.chat(messages, { temperature: 0.7 });
      return response.content;
    } catch {
      if (successCount === results.length) {
        return '任务已成功完成！';
      } else {
        return `任务完成，但有 ${failedCount} 个子任务失败。`;
      }
    }
  }
  
  getPlan(planId: string): ExecutionPlan | undefined {
    return this.activePlans.get(planId);
  }
  
  getActivePlans(): ExecutionPlan[] {
    return Array.from(this.activePlans.values()).filter(p => p.status === 'running');
  }
}

// ═══════════════════════════════════════════════════════════════
// 全局实例
// ═══════════════════════════════════════════════════════════════

let taskPlannerInstance: TaskPlanner | null = null;

export function getTaskPlanner(): TaskPlanner {
  if (!taskPlannerInstance) {
    taskPlannerInstance = new TaskPlanner();
  }
  return taskPlannerInstance;
}

export function resetTaskPlanner(): void {
  taskPlannerInstance = null;
}
