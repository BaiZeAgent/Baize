/**
 * 执行层 - 增强版执行引擎
 * 
 * 核心能力：
 * 1. 增强ReAct循环 - 更智能的迭代执行
 * 2. 智能重试 - 基于错误类型的智能重试
 * 3. 结果验证 - 验证执行结果是否符合预期
 * 4. 动态调整 - 根据执行情况动态调整计划
 */

import { getSkillRegistry } from '../../skills/registry';
import { getToolRegistry } from '../../tools';
import { getLLMManager } from '../../llm';
import { getMemory } from '../../memory';
import { getLogger } from '../../observability/logger';
import { LLMMessage, RiskLevel } from '../../types';
import { getMetacognition, CapabilityAssessment } from './metacognition';
import { getRecoveryEngine, RecoveryResult } from './recovery';
import { ExecutionPlan, SubTask, getThinkingEngine } from './thinking';

const logger = getLogger('core:execution');

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

/** 执行上下文 */
export interface ExecutionContext {
  sessionId: string;
  userId?: string;
  workspaceDir: string;
  userInput: string;
  history?: Array<{ role: string; content: string }>;
  hooks?: ExecutionHooks;
  skipAssessment?: boolean;  // 跳过能力评估
}

/** 执行钩子 */
export interface ExecutionHooks {
  onTaskStart?: (task: SubTask) => Promise<void>;
  onTaskComplete?: (task: SubTask, result: TaskResult) => Promise<void>;
  onTaskError?: (task: SubTask, error: Error) => Promise<void>;
  onRecovery?: (recovery: RecoveryResult) => Promise<void>;
  onProgress?: (progress: ExecutionProgress) => Promise<void>;
}

/** 任务结果 */
export interface TaskResult {
  taskId: string;
  success: boolean;
  data: Record<string, unknown>;
  message: string;
  error?: string;
  duration: number;
  retries: number;
}

/** 执行结果 */
export interface ExecutionResult {
  success: boolean;
  plan: ExecutionPlan;
  taskResults: TaskResult[];
  finalMessage: string;
  duration: number;
  totalIterations: number;
  recoveryUsed: boolean;
  reflections: string[];
  needClarification?: boolean;
  questions?: string[];
  missingCapabilities?: string[];
}

/** 执行进度 */
export interface ExecutionProgress {
  currentTask: string;
  completedTasks: number;
  totalTasks: number;
  percentage: number;
  status: 'running' | 'waiting' | 'error' | 'complete';
}

/** 执行状态 */
interface ExecutionState {
  currentTaskIndex: number;
  completedTasks: TaskResult[];
  failedTasks: string[];
  retries: Map<string, number>;
  maxRetriesPerTask: number;
  startTime: number;
  iterations: number;
  maxIterations: number;
  recoveryHistory: RecoveryResult[];
}

// ═══════════════════════════════════════════════════════════════
// 增强执行器
// ═══════════════════════════════════════════════════════════════

export class EnhancedExecutor {
  private skillRegistry = getSkillRegistry();
  private toolRegistry = getToolRegistry();
  private llm = getLLMManager();
  private memory = getMemory();
  private metacognition = getMetacognition();
  private recoveryEngine = getRecoveryEngine();
  private thinkingEngine = getThinkingEngine();

  // 配置
  private readonly MAX_GLOBAL_ITERATIONS = 100;
  private readonly MAX_TASK_RETRIES = 5;
  private readonly TASK_TIMEOUT = 60000;

  /**
   * 执行入口
   * @param userInput 用户输入
   * @param context 执行上下文
   * @param plan 可选的预生成计划（如果已由上层生成）
   */
  async execute(
    userInput: string,
    context: ExecutionContext,
    plan?: ExecutionPlan
  ): Promise<ExecutionResult> {
    logger.info(`[执行] 开始执行: ${userInput.slice(0, 50)}...`);
    const startTime = Date.now();

    try {
      // 如果没有提供计划，则生成计划
      if (!plan) {
        plan = await this.thinkingEngine.think(userInput);
      }
      
      logger.info(`[执行] 计划: ${plan.id}, 任务数: ${plan.tasks.length}`);

      // 对话类型直接返回
      if (plan.tasks.length === 1 && plan.tasks[0].skillName === 'chat') {
        const response = plan.tasks[0].params.response as string || '你好！有什么我可以帮助你的吗？';
        return {
          success: true,
          plan,
          taskResults: [{
            taskId: 'chat_response',
            success: true,
            data: { response },
            message: response,
            duration: 0,
            retries: 0,
          }],
          finalMessage: response,
          duration: Date.now() - startTime,
          totalIterations: 0,
          recoveryUsed: false,
          reflections: [],
        };
      }

      // 执行计划
      const result = await this.executePlan(plan, context);

      // 反思异步执行，不等待
      setImmediate(() => {
        this.metacognition.reflect(userInput, {
          success: result.success,
          steps: result.taskResults.map(r => ({
            action: r.taskId,
            result: r.message,
            success: r.success,
          })),
          errors: result.taskResults.filter(r => !r.success).map(r => r.error || ''),
          duration: Date.now() - startTime,
        }).catch(e => logger.error('反思失败: ' + e));
      });

      result.duration = Date.now() - startTime;

      return result;
    } catch (error) {
      logger.error(`[执行] 错误: ${error}`);
      return {
        success: false,
        plan: {
          id: 'error',
          description: '执行失败',
          tasks: [],
          parallelGroups: [],
          estimatedTotalTime: 0,
          riskAssessment: { level: RiskLevel.HIGH, factors: [], mitigations: [] },
          successCriteria: [],
        },
        taskResults: [],
        finalMessage: `执行失败: ${error}`,
        duration: Date.now() - startTime,
        totalIterations: 0,
        recoveryUsed: false,
        reflections: [],
      };
    }
  }

  /**
   * 执行计划
   */
  private async executePlan(
    plan: ExecutionPlan,
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    const state: ExecutionState = {
      currentTaskIndex: 0,
      completedTasks: [],
      failedTasks: [],
      retries: new Map(),
      maxRetriesPerTask: this.MAX_TASK_RETRIES,
      startTime: Date.now(),
      iterations: 0,
      maxIterations: this.MAX_GLOBAL_ITERATIONS,
      recoveryHistory: [],
    };

    // 如果没有任务，直接返回
    if (plan.tasks.length === 0) {
      return {
        success: true,
        plan,
        taskResults: [],
        finalMessage: '任务完成（无需执行具体步骤）',
        duration: Date.now() - state.startTime,
        totalIterations: 0,
        recoveryUsed: false,
        reflections: [],
      };
    }

    // 按并行组执行
    for (let groupIndex = 0; groupIndex < plan.parallelGroups.length; groupIndex++) {
      const group = plan.parallelGroups[groupIndex];
      
      logger.info(`[执行] 并行组 ${groupIndex + 1}/${plan.parallelGroups.length}: ${group.join(', ')}`);

      // 并行执行组内任务
      const groupResults = await Promise.all(
        group.map(taskId => {
          const task = plan.tasks.find(t => t.id === taskId);
          if (!task) {
            return Promise.resolve(this.createErrorTaskResult(taskId, '任务不存在'));
          }
          return this.executeTaskWithRetry(task, plan, context, state);
        })
      );

      // 检查结果
      for (const result of groupResults) {
        state.completedTasks.push(result);
        if (!result.success) {
          state.failedTasks.push(result.taskId);
        }
      }

      // 更新进度
      if (context.hooks?.onProgress) {
        await context.hooks.onProgress({
          currentTask: group[group.length - 1],
          completedTasks: state.completedTasks.length,
          totalTasks: plan.tasks.length,
          percentage: (state.completedTasks.length / plan.tasks.length) * 100,
          status: state.failedTasks.length > 0 ? 'error' : 'running',
        });
      }

      // 如果有失败且不可继续，停止执行
      if (state.failedTasks.length > 0) {
        const canContinue = await this.canContinueAfterFailure(plan, state);
        if (!canContinue) {
          break;
        }
      }
    }

    // 生成最终消息
    const finalMessage = await this.generateFinalMessage(plan, state, context);

    return {
      success: state.failedTasks.length === 0,
      plan,
      taskResults: state.completedTasks,
      finalMessage,
      duration: Date.now() - state.startTime,
      totalIterations: state.iterations,
      recoveryUsed: state.recoveryHistory.length > 0,
      reflections: [],
    };
  }

  /**
   * 执行单个任务（带重试和恢复）
   */
  private async executeTaskWithRetry(
    task: SubTask,
    plan: ExecutionPlan,
    context: ExecutionContext,
    state: ExecutionState
  ): Promise<TaskResult> {
    const startTime = Date.now();
    let currentParams = { ...task.params };
    let currentSkill = task.skillName;
    let attemptCount = 0;
    const maxAttempts = state.maxRetriesPerTask;

    // 执行前钩子
    if (context.hooks?.onTaskStart) {
      await context.hooks.onTaskStart(task);
    }

    while (attemptCount < maxAttempts) {
      attemptCount++;
      state.iterations++;

      logger.info(`[执行任务] ${task.id} 尝试 ${attemptCount}/${maxAttempts}`);

      try {
        // 执行任务
        const result = await this.executeTask(
          { ...task, skillName: currentSkill, params: currentParams },
          context
        );

        if (result.success) {
          // 检查点：LLM判断结果是否符合预期
          const checkpoint = await this.checkpoint(task, result, context);
          
          if (checkpoint.status === 'good') {
            // 结果符合预期
            result.retries = attemptCount - 1;
            if (context.hooks?.onTaskComplete) {
              await context.hooks.onTaskComplete(task, result);
            }
            return result;
          }
          
          if (checkpoint.status === 'adjust' && checkpoint.adjustedParams) {
            // 需要调整参数重试
            logger.info(`[检查点] 调整参数: ${checkpoint.reason}`);
            currentParams = { ...currentParams, ...checkpoint.adjustedParams };
            continue;
          }
          
          if (checkpoint.status === 'upgrade') {
            // 需要升级方案
            logger.info(`[检查点] 升级方案: ${checkpoint.reason}`);
            return this.upgradeAndRetry(task, plan, context, state, checkpoint.reason || '结果不符合预期');
          }
        }

        // 失败，LLM探索：分析失败原因，决定下一步
        const exploration = await this.exploreAfterFailure(
          task,
          { skillName: currentSkill, params: currentParams },
          result.error || '任务执行失败',
          context,
          state
        );
        
        if (exploration.done) {
          // LLM认为无法完成
          result.retries = attemptCount - 1;
          return result;
        }
        
        if (exploration.newPlan) {
          // LLM决定换一个完全不同的方案
          logger.info(`[探索] 换方案: ${exploration.reasoning}`);
          return this.executeTaskWithRetry(
            exploration.newPlan.tasks[0],
            exploration.newPlan,
            context,
            state
          );
        }
        
        // 应用LLM建议的调整
        if (exploration.adjustedParams) {
          currentParams = { ...currentParams, ...exploration.adjustedParams };
        }
        if (exploration.newSkill) {
          currentSkill = exploration.newSkill;
        }

      } catch (error) {
        logger.error(`[执行任务] ${task.id} 异常: ${error}`);
        
        // 异常探索
        const exploration = await this.exploreAfterFailure(
          task,
          { skillName: currentSkill, params: currentParams },
          (error as Error).message,
          context,
          state
        );
        
        if (exploration.done) {
          return {
            taskId: task.id,
            success: false,
            data: {},
            message: '',
            error: (error as Error).message,
            duration: Date.now() - startTime,
            retries: attemptCount - 1,
          };
        }
        
        if (exploration.newPlan) {
          return this.executeTaskWithRetry(
            exploration.newPlan.tasks[0],
            exploration.newPlan,
            context,
            state
          );
        }
        
        if (exploration.adjustedParams) {
          currentParams = { ...currentParams, ...exploration.adjustedParams };
        }
        if (exploration.newSkill) {
          currentSkill = exploration.newSkill;
        }
      }
    }

    // 超过最大重试次数
    return {
      taskId: task.id,
      success: false,
      data: {},
      message: '',
      error: `超过最大重试次数 (${maxAttempts})`,
      duration: Date.now() - startTime,
      retries: attemptCount - 1,
    };
  }

  /**
   * 执行单个任务
   */
  private async executeTask(
    task: SubTask,
    context: ExecutionContext
  ): Promise<TaskResult> {
    const startTime = Date.now();

    try {
      // 1. 检查技能/工具
      let skill = this.skillRegistry.get(task.skillName);
      let isTool = false;

      if (!skill) {
        if (this.toolRegistry.has(task.skillName)) {
          isTool = true;
        } else {
          throw new Error(`技能或工具不存在: ${task.skillName}`);
        }
      }

      // 2. 执行
      let result: { success: boolean; data: Record<string, unknown>; message: string; error?: string };
      
      if (isTool) {
        const toolResult = await this.toolRegistry.execute(task.skillName, task.params, context);
        result = {
          success: toolResult.success,
          data: (toolResult.data || {}) as Record<string, unknown>,
          message: toolResult.error || '执行完成',
          error: toolResult.error,
        };
      } else {
        const skillResult = await skill!.run(task.params, context);
        result = {
          success: skillResult.success,
          data: (skillResult.data || {}) as Record<string, unknown>,
          message: skillResult.message || '执行完成',
          error: skillResult.error,
        };
      }

      // 3. 记录成功
      if (result.success) {
        this.memory.recordSuccess(task.skillName);
      } else {
        this.memory.recordFailure(task.skillName);
      }

      return {
        taskId: task.id,
        ...result,
        duration: Date.now() - startTime,
        retries: 0,
      };

    } catch (error) {
      this.memory.recordFailure(task.skillName);
      
      return {
        taskId: task.id,
        success: false,
        data: {},
        message: '',
        error: (error as Error).message,
        duration: Date.now() - startTime,
        retries: 0,
      };
    }
  }

  /**
   * 创建错误任务结果
   */
  private createErrorTaskResult(taskId: string, error: string): TaskResult {
    return {
      taskId,
      success: false,
      data: {},
      message: '',
      error,
      duration: 0,
      retries: 0,
    };
  }

  /**
   * 应用恢复策略
   */
  private applyRecovery(
    task: SubTask,
    recovery: RecoveryResult,
    currentParams: Record<string, unknown>,
    currentSkill: string
  ): { params: Record<string, unknown>; skillName: string } {
    let params = { ...currentParams };
    let skillName = currentSkill;

    switch (recovery.strategy) {
      case 'correct_params':
        if (recovery.correctedParams) {
          params = { ...params, ...recovery.correctedParams };
        }
        break;

      case 'use_alternative':
        if (recovery.alternativeTool) {
          skillName = recovery.alternativeTool;
        }
        break;

      case 'decompose':
        // 分解由上层处理
        break;

      case 'ask_user':
        // 用户交互由上层处理
        break;
    }

    return { params, skillName };
  }

  /**
   * 判断失败后是否可以继续
   */
  private async canContinueAfterFailure(
    plan: ExecutionPlan,
    state: ExecutionState
  ): Promise<boolean> {
    // 检查失败的任务是否是可选的
    for (const failedTaskId of state.failedTasks) {
      const task = plan.tasks.find(t => t.id === failedTaskId);
      if (task && !task.isOptional) {
        // 检查是否有替代任务
        if (task.fallbackTaskId) {
          // 可以尝试替代任务
          continue;
        }
        return false;
      }
    }
    return true;
  }

  /**
   * 生成最终消息
   */
  private async generateFinalMessage(
    plan: ExecutionPlan,
    state: ExecutionState,
    context: ExecutionContext
  ): Promise<string> {
    const successCount = state.completedTasks.filter(r => r.success).length;
    const failCount = state.failedTasks.length;

    // 获取最后一个任务的结果数据
    const lastResult = state.completedTasks[state.completedTasks.length - 1];

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个智能助手。根据任务执行结果，给用户一个友好的回复。

## 规则
1. 如果有数据结果，直接展示给用户（标题、链接等）
2. 数据必须是真实的，来自执行结果，不要编造
3. 使用自然语言，像朋友一样交流
4. 不要过于技术化`,
      },
      {
        role: 'user',
        content: `用户请求: ${context.userInput}

执行结果:
${state.completedTasks.map(r => 
  `- ${r.taskId}: ${r.success ? '成功' : '失败'}\n  消息: ${r.message}\n  数据: ${JSON.stringify(r.data || {})}`
).join('\n')}

${lastResult?.data ? `\n关键数据:\n${JSON.stringify(lastResult.data, null, 2)}` : ''}

请根据执行结果给用户回复。如果有数据，直接展示真实数据。`,
      },
    ];

    try {
      const response = await this.llm.chat(messages, { temperature: 0.7 });
      return response.content;
    } catch {
      if (failCount === 0) {
        return `任务完成！共执行了 ${successCount} 个步骤。`;
      } else {
        return `任务部分完成。成功 ${successCount} 个，失败 ${failCount} 个。`;
      }
    }
  }

  /**
   * 检查点：LLM判断执行结果是否符合预期
   */
  private async checkpoint(
    task: SubTask,
    result: TaskResult,
    context: ExecutionContext
  ): Promise<{ status: 'good' | 'adjust' | 'upgrade'; reason?: string; adjustedParams?: Record<string, unknown> }> {
    // 简单任务不需要检查点
    if (task.skillName === 'chat' || task.skillName === 'time' || task.skillName === 'calculator') {
      return { status: 'good' };
    }

    // 有明确有效数据的认为成功
    if (result.data && Object.keys(result.data).length > 0) {
      // 检查数据是否有效
      if (result.data.firstVideo) {
        const v = result.data.firstVideo as any;
        if (v.link && v.link !== 'undefined') {
          return { status: 'good' };
        }
      }
      if (result.data.results) {
        const results = result.data.results as any[];
        if (results.length > 0 && results[0].link && results[0].link !== 'undefined') {
          return { status: 'good' };
        }
      }
    }

    // 让LLM判断
    try {
      const response = await this.llm.chat([
        {
          role: 'system',
          content: `你是执行监控器。快速判断执行结果是否符合预期。

输出格式（必须是JSON）：
{"status":"good" | "adjust" | "upgrade","reason":"原因","adjustedParams":{}}

判断标准：
- good: 结果符合预期
- adjust: 方向对但参数需要微调
- upgrade: 方向错了，需要换方案`
        },
        {
          role: 'user',
          content: `任务: ${task.description}
工具: ${task.skillName}
结果: ${JSON.stringify(result.data).slice(0, 300)}
成功: ${result.success}

这个结果符合预期吗？`
        }
      ], { temperature: 0.1, maxTokens: 200 });

      const jsonMatch = response.content.match(/{[sS]*}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      logger.debug(`[检查点] LLM判断失败: ${e}`);
    }

    // 默认认为成功
    return { status: 'good' };
  }

  /**
   * 升级方案并重试
   */
  private async upgradeAndRetry(
    task: SubTask,
    plan: ExecutionPlan,
    context: ExecutionContext,
    state: ExecutionState,
    reason: string
  ): Promise<TaskResult> {
    logger.info(`[升级] 原因: ${reason}`);

    // 记录失败经验
    this.memory.recordExperience({
      task: context.userInput,
      tool: task.skillName,
      params: task.params,
      success: false,
      context: this.extractContext(context.userInput),
      errorMessage: reason,
      timestamp: Date.now(),
    });

    // 让思考引擎重新规划
    const newPlan = await this.thinkingEngine.think(context.userInput, {
      failedTool: task.skillName,
      failureReason: reason,
    });

    // 如果新计划不同，执行新计划
    if (newPlan.tasks.length > 0 && newPlan.tasks[0].skillName !== task.skillName) {
      logger.info(`[升级] 新方案: ${newPlan.tasks[0].skillName}`);
      return this.executeTaskWithRetry(newPlan.tasks[0], newPlan, context, state);
    }

    // 无法升级
    return {
      taskId: task.id,
      success: false,
      data: {},
      message: '',
      error: `无法找到更好的方案: ${reason}`,
      duration: 0,
      retries: state.retries.get(task.id) || 0,
    };
  }

  /**
   * LLM探索：失败后分析原因，决定下一步
   */
  private async exploreAfterFailure(
    task: SubTask,
    current: { skillName: string; params: Record<string, unknown> },
    error: string,
    context: ExecutionContext,
    state: ExecutionState
  ): Promise<{
    done: boolean;
    newPlan?: ExecutionPlan;
    newSkill?: string;
    adjustedParams?: Record<string, unknown>;
    reasoning: string;
  }> {
    // 获取已尝试的方案
    const triedSkills = state.recoveryHistory
      .map(r => r.alternativeTool)
      .filter(Boolean);
    
    // 获取可用工具
    const availableTools = this.getAvailableToolsDescription();
    
    // LLM分析
    const response = await this.llm.chat([
      {
        role: 'system',
        content: `你是任务执行专家。当一个方案失败后，分析原因并决定下一步。

## 可用操作

1. **retry**: 调整参数重试当前工具
   {"action": "retry", "adjustedParams": {...}, "reasoning": "原因"}

2. **switch**: 换一个工具
   {"action": "switch", "newTool": "工具名", "params": {...}, "reasoning": "原因"}

3. **replan**: 完全重新规划
   {"action": "replan", "reasoning": "当前方案不可行，需要换思路"}

4. **abort**: 放弃
   {"action": "abort", "reasoning": "无法完成"}

## 规则

1. 分析失败的根本原因
2. 考虑是否有其他方式可以达成目标
3. 不要重复已经失败的方案
4. 输出有效的JSON`
      },
      {
        role: 'user',
        content: `## 任务
${context.userInput}

## 当前尝试
工具: ${current.skillName}
参数: ${JSON.stringify(current.params)}

## 失败原因
${error}

## 已尝试过的工具
${triedSkills.length > 0 ? triedSkills.join(', ') : '无'}

## 可用工具
${availableTools}

## 下一步操作
请输出JSON格式的决策：`
      }
    ], { temperature: 0.3 });

    // 解析响应
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { done: true, reasoning: '无法解析LLM响应' };
    }

    try {
      const decision = JSON.parse(jsonMatch[0]);
      
      switch (decision.action) {
        case 'retry':
          return {
            done: false,
            adjustedParams: decision.adjustedParams,
            reasoning: decision.reasoning
          };
          
        case 'switch':
          return {
            done: false,
            newSkill: decision.newTool,
            adjustedParams: decision.params,
            reasoning: decision.reasoning
          };
          
        case 'replan':
          // 重新规划
          const newPlan = await this.thinkingEngine.think(context.userInput, {
            failedTool: current.skillName,
            failureReason: error,
          });
          return {
            done: false,
            newPlan,
            reasoning: decision.reasoning
          };
          
        case 'abort':
          return {
            done: true,
            reasoning: decision.reasoning
          };
          
        default:
          return { done: true, reasoning: '未知操作' };
      }
    } catch (e) {
      return { done: true, reasoning: '解析失败: ' + (e as Error).message };
    }
  }

  /**
   * 获取可用工具描述
   */
  private getAvailableToolsDescription(): string {
    const skills = this.skillRegistry.getAll();
    const tools = this.toolRegistry.getAll();
    const lines: string[] = [];

    for (const skill of skills) {
      lines.push(`- ${skill.name}: ${skill.description.slice(0, 50)}`);
    }
    for (const tool of tools) {
      lines.push(`- ${tool.name}: ${tool.description.slice(0, 50)}`);
    }

    return lines.join('\n');
  }

  /**
   * 提取上下文关键词
   */
  private extractContext(text: string): string {
    const keywords: string[] = [];
    if (text.includes('B站') || text.includes('bilibili')) keywords.push('B站');
    if (text.includes('天气')) keywords.push('天气');
    if (text.includes('文件')) keywords.push('文件');
    if (text.includes('搜索')) keywords.push('搜索');
    if (text.includes('时间') || text.includes('几点')) keywords.push('时间');
    return keywords.join(',');
  }

  /**
   * 创建澄清结果
   */
  private createClarificationResult(
    userInput: string,
    assessment: CapabilityAssessment,
    startTime: number
  ): ExecutionResult {
    return {
      success: false,
      plan: {
        id: 'clarification',
        description: '需要用户澄清',
        tasks: [],
        parallelGroups: [],
        estimatedTotalTime: 0,
        riskAssessment: { level: RiskLevel.LOW, factors: [], mitigations: [] },
        successCriteria: [],
      },
      taskResults: [],
      finalMessage: assessment.helpQuestions.join('\n'),
      duration: Date.now() - startTime,
      totalIterations: 0,
      recoveryUsed: false,
      reflections: ['需要用户提供更多信息'],
      needClarification: true,
      questions: assessment.helpQuestions,
      missingCapabilities: assessment.missingCapabilities,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// 全局实例
// ═══════════════════════════════════════════════════════════════

let enhancedExecutorInstance: EnhancedExecutor | null = null;

export function getEnhancedExecutor(): EnhancedExecutor {
  if (!enhancedExecutorInstance) {
    enhancedExecutorInstance = new EnhancedExecutor();
  }
  return enhancedExecutorInstance;
}

export function resetEnhancedExecutor(): void {
  enhancedExecutorInstance = null;
}
