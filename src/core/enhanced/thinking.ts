/**
 * 思考层 - 任务分解与推理引擎
 * 
 * 核心能力：
 * 1. 任务分解 - 将复杂任务分解为可执行的子任务
 * 2. 推理引擎 - 进行逻辑推理，生成执行计划
 * 3. 规划生成 - 生成最优执行方案
 * 4. 依赖分析 - 分析任务之间的依赖关系
 */

import { getLLMManager } from '../../llm';
import { getSkillRegistry } from '../../skills/registry';
import { getToolRegistry } from '../../tools';
import { getLogger } from '../../observability/logger';
import { getMemory } from '../../memory';
import { LLMMessage, RiskLevel } from '../../types';
import { getMetacognition, ComplexityAnalysis } from './metacognition';

const logger = getLogger('core:thinking');

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

/** 子任务 */
export interface SubTask {
  id: string;
  description: string;
  skillName: string;
  params: Record<string, unknown>;
  dependencies: string[];      // 依赖的任务ID
  riskLevel: RiskLevel;
  estimatedTime: number;       // 预估时间(秒)
  isOptional: boolean;         // 是否可选
  fallbackTaskId?: string;     // 失败时的替代任务
}

/** 执行计划 */
export interface ExecutionPlan {
  id: string;
  description: string;
  tasks: SubTask[];
  parallelGroups: string[][];  // 可并行执行的任务组
  estimatedTotalTime: number;
  riskAssessment: {
    level: RiskLevel;
    factors: string[];
    mitigations: string[];
  };
  successCriteria: string[];   // 成功标准
  rollbackPlan?: string;       // 回滚计划
}

/** 推理结果 */
export interface ReasoningResult {
  conclusion: string;
  steps: ReasoningStep[];
  confidence: number;
  assumptions: string[];
  alternatives: string[];
}

/** 推理步骤 */
export interface ReasoningStep {
  step: number;
  action: string;
  reasoning: string;
  result: string;
  confidence: number;
}

/** 任务分解结果 */
export interface DecompositionResult {
  success: boolean;
  subtasks: SubTask[];
  dependencies: Map<string, string[]>;
  executionOrder: string[];
  reasoning: string;
  canSimplify: boolean;
  simplifiedVersion?: ExecutionPlan;
}

// ═══════════════════════════════════════════════════════════════
// 思考引擎
// ═══════════════════════════════════════════════════════════════

export class ThinkingEngine {
  private llm = getLLMManager();
  private skillRegistry = getSkillRegistry();
  private toolRegistry = getToolRegistry();
  private memory = getMemory();
  private metacognition = getMetacognition();

  /**
   * 思考入口
   * 对用户输入进行深度思考和规划
   */
  async think(userInput: string): Promise<ExecutionPlan> {
    logger.info(`[思考] 开始思考: ${userInput.slice(0, 50)}...`);

    // 1. 分析任务复杂度
    const complexity = await this.metacognition.analyzeComplexity(userInput);
    logger.info(`[思考] 复杂度: ${complexity.score}, 子任务数: ${complexity.subtaskCount}`);

    // 2. 根据复杂度选择策略
    if (complexity.score <= 3) {
      // 简单任务：直接生成单步计划
      return this.generateSimplePlan(userInput, complexity);
    } else if (complexity.score <= 6) {
      // 中等任务：分解后规划
      return this.generateMediumPlan(userInput, complexity);
    } else {
      // 复杂任务：深度分解和规划
      return this.generateComplexPlan(userInput, complexity);
    }
  }

  /**
   * 生成简单计划（单步任务）
   */
  private async generateSimplePlan(
    userInput: string,
    complexity: ComplexityAnalysis
  ): Promise<ExecutionPlan> {
    // 直接匹配工具
    const match = await this.matchTool(userInput);
    
    const task: SubTask = {
      id: 'task_1',
      description: userInput,
      skillName: match.toolName,
      params: match.params,
      dependencies: [],
      riskLevel: this.assessRiskLevel(match.toolName, match.params),
      estimatedTime: complexity.timeEstimate,
      isOptional: false,
    };

    return {
      id: `plan_${Date.now()}`,
      description: `执行: ${userInput}`,
      tasks: [task],
      parallelGroups: [['task_1']],
      estimatedTotalTime: complexity.timeEstimate,
      riskAssessment: {
        level: task.riskLevel,
        factors: [],
        mitigations: [],
      },
      successCriteria: ['任务成功执行'],
    };
  }

  /**
   * 生成中等计划（多步任务）
   */
  private async generateMediumPlan(
    userInput: string,
    complexity: ComplexityAnalysis
  ): Promise<ExecutionPlan> {
    // 分解任务
    const decomposition = await this.decomposeTask(userInput, complexity);
    
    if (!decomposition.success || decomposition.subtasks.length === 0) {
      // 分解失败，回退到简单计划
      return this.generateSimplePlan(userInput, complexity);
    }

    // 构建执行计划
    return this.buildExecutionPlan(userInput, decomposition, complexity);
  }

  /**
   * 生成复杂计划（深度分解）
   */
  private async generateComplexPlan(
    userInput: string,
    complexity: ComplexityAnalysis
  ): Promise<ExecutionPlan> {
    logger.info('[思考] 复杂任务，开始深度分解');

    // 1. 能力评估
    const assessment = await this.metacognition.assessCapability(userInput);
    
    if (!assessment.canComplete) {
      // 生成澄清计划
      return this.generateClarificationPlan(userInput, assessment);
    }

    // 2. 深度分解
    const decomposition = await this.deepDecompose(userInput, complexity, assessment);

    // 3. 推理验证
    const reasoning = await this.reason(userInput, decomposition);

    // 4. 构建计划
    const plan = this.buildExecutionPlan(userInput, decomposition, complexity);

    // 5. 添加风险缓解
    plan.riskAssessment.mitigations = reasoning.assumptions;

    return plan;
  }

  /**
   * 分解任务
   */
  async decomposeTask(
    userInput: string,
    complexity: ComplexityAnalysis
  ): Promise<DecompositionResult> {
    // 获取可用工具
    const tools = this.getAvailableTools();

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个任务分解专家。将复杂任务分解为可执行的子任务。

## 可用工具
${tools}

## 分解规则
1. 每个子任务必须能由单个工具完成
2. 明确标注任务之间的依赖关系
3. 标注哪些任务可以并行执行
4. 为每个任务估算执行时间
5. 标注任务的风险等级

## 输出格式
{
  "success": true/false,
  "subtasks": [
    {
      "id": "task_1",
      "description": "任务描述",
      "skillName": "工具名称",
      "params": {},
      "dependencies": [],
      "estimatedTime": 秒数,
      "riskLevel": "low|medium|high|critical",
      "isOptional": false
    }
  ],
  "executionOrder": ["task_1", "task_2"],
  "reasoning": "分解理由"
}`,
      },
      {
        role: 'user',
        content: `请分解以下任务：
${userInput}

任务复杂度: ${complexity.score}
预计子任务数: ${complexity.subtaskCount}`,
      },
    ];

    try {
      const response = await this.llm.chat(messages, { temperature: 0.3 });
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        const subtasks: SubTask[] = (parsed.subtasks || []).map((t: any) => ({
          id: t.id,
          description: t.description,
          skillName: t.skillName,
          params: t.params || {},
          dependencies: t.dependencies || [],
          riskLevel: this.parseRiskLevel(t.riskLevel),
          estimatedTime: t.estimatedTime || 10,
          isOptional: t.isOptional || false,
        }));

        // 构建依赖图
        const dependencies = new Map<string, string[]>();
        for (const task of subtasks) {
          dependencies.set(task.id, task.dependencies);
        }

        // 计算执行顺序
        const executionOrder = this.topologicalSort(subtasks, dependencies);

        return {
          success: true,
          subtasks,
          dependencies,
          executionOrder,
          reasoning: parsed.reasoning || '',
          canSimplify: subtasks.length > 3,
        };
      }
    } catch (error) {
      logger.error(`[任务分解] 错误: ${error}`);
    }

    return {
      success: false,
      subtasks: [],
      dependencies: new Map(),
      executionOrder: [],
      reasoning: '分解失败',
      canSimplify: false,
    };
  }

  /**
   * 深度分解（用于复杂任务）
   */
  private async deepDecompose(
    userInput: string,
    complexity: ComplexityAnalysis,
    assessment: any
  ): Promise<DecompositionResult> {
    // 先进行初步分解
    const initialDecomposition = await this.decomposeTask(userInput, complexity);
    
    if (!initialDecomposition.success) {
      return initialDecomposition;
    }

    // 对每个子任务进行进一步验证
    const validatedSubtasks: SubTask[] = [];
    
    for (const task of initialDecomposition.subtasks) {
      // 验证工具是否存在
      const toolExists = this.skillRegistry.get(task.skillName) || 
                        this.toolRegistry.has(task.skillName);
      
      if (toolExists) {
        validatedSubtasks.push(task);
      } else {
        // 尝试找替代工具
        const alternative = await this.findAlternativeTool(task);
        if (alternative) {
          validatedSubtasks.push({
            ...task,
            skillName: alternative,
            description: `${task.description} (使用替代工具: ${alternative})`,
          });
        } else if (!task.isOptional) {
          // 必需任务无法执行，标记问题
          logger.warn(`[深度分解] 无法找到工具: ${task.skillName}`);
          validatedSubtasks.push({
            ...task,
            skillName: 'ask_user',
            description: `需要用户帮助: ${task.description}`,
          });
        }
      }
    }

    return {
      ...initialDecomposition,
      subtasks: validatedSubtasks,
    };
  }

  /**
   * 推理引擎
   */
  async reason(
    userInput: string,
    decomposition: DecompositionResult
  ): Promise<ReasoningResult> {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个推理引擎。验证任务分解是否合理，并生成推理链。

## 推理规则
1. 验证每个子任务是否必要
2. 验证依赖关系是否正确
3. 验证执行顺序是否最优
4. 识别潜在的失败点
5. 提出假设和替代方案

## 输出格式
{
  "conclusion": "最终结论",
  "steps": [
    {
      "step": 1,
      "action": "动作描述",
      "reasoning": "推理过程",
      "result": "推理结果",
      "confidence": 0.0-1.0
    }
  ],
  "confidence": 0.0-1.0,
  "assumptions": ["假设1", "假设2"],
  "alternatives": ["替代方案1", "替代方案2"]
}`,
      },
      {
        role: 'user',
        content: `用户目标: ${userInput}

任务分解:
${decomposition.subtasks.map(t => `- ${t.id}: ${t.skillName} - ${t.description}`).join('\n')}

执行顺序: ${decomposition.executionOrder.join(' -> ')}

请验证这个分解方案是否合理。`,
      },
    ];

    try {
      const response = await this.llm.chat(messages, { temperature: 0.3 });
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          conclusion: parsed.conclusion || '',
          steps: parsed.steps || [],
          confidence: parsed.confidence || 0.5,
          assumptions: parsed.assumptions || [],
          alternatives: parsed.alternatives || [],
        };
      }
    } catch (error) {
      logger.error(`[推理] 错误: ${error}`);
    }

    return {
      conclusion: '推理失败',
      steps: [],
      confidence: 0.5,
      assumptions: [],
      alternatives: [],
    };
  }

  /**
   * 匹配工具
   */
  private async matchTool(
    userInput: string
  ): Promise<{ toolName: string; params: Record<string, unknown>; confidence: number }> {
    const tools = this.getAvailableTools();

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个工具匹配专家。为用户请求选择最合适的工具。

## 可用工具
${tools}

## 输出格式
{
  "toolName": "工具名称",
  "params": {},
  "confidence": 0.0-1.0
}`,
      },
      {
        role: 'user',
        content: userInput,
      },
    ];

    try {
      const response = await this.llm.chat(messages, { temperature: 0.2 });
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          toolName: parsed.toolName,
          params: parsed.params || {},
          confidence: parsed.confidence || 0.5,
        };
      }
    } catch (error) {
      logger.error(`[工具匹配] 错误: ${error}`);
    }

    return {
      toolName: 'unknown',
      params: {},
      confidence: 0,
    };
  }

  /**
   * 构建执行计划
   */
  private buildExecutionPlan(
    userInput: string,
    decomposition: DecompositionResult,
    complexity: ComplexityAnalysis
  ): ExecutionPlan {
    // 计算并行组
    const parallelGroups = this.computeParallelGroups(
      decomposition.subtasks,
      decomposition.dependencies
    );

    // 计算总时间
    const totalTime = decomposition.subtasks.reduce(
      (sum, t) => sum + t.estimatedTime,
      0
    );

    // 风险评估
    const maxRisk = Math.max(
      ...decomposition.subtasks.map(t => this.riskLevelToNumber(t.riskLevel))
    );

    return {
      id: `plan_${Date.now()}`,
      description: userInput,
      tasks: decomposition.subtasks,
      parallelGroups,
      estimatedTotalTime: totalTime,
      riskAssessment: {
        level: this.numberToRiskLevel(maxRisk),
        factors: decomposition.subtasks
          .filter(t => t.riskLevel !== RiskLevel.LOW)
          .map(t => `${t.id}: ${t.riskLevel}`),
        mitigations: [],
      },
      successCriteria: ['所有必需任务成功完成'],
    };
  }

  /**
   * 生成澄清计划
   */
  private generateClarificationPlan(
    userInput: string,
    assessment: any
  ): ExecutionPlan {
    return {
      id: `plan_${Date.now()}`,
      description: `需要澄清: ${userInput}`,
      tasks: [{
        id: 'clarify',
        description: '向用户询问更多信息',
        skillName: 'ask_user',
        params: { questions: assessment.helpQuestions },
        dependencies: [],
        riskLevel: RiskLevel.LOW,
        estimatedTime: 30,
        isOptional: false,
      }],
      parallelGroups: [['clarify']],
      estimatedTotalTime: 30,
      riskAssessment: {
        level: RiskLevel.LOW,
        factors: [],
        mitigations: [],
      },
      successCriteria: ['用户提供了足够的信息'],
    };
  }

  /**
   * 获取可用工具描述
   */
  private getAvailableTools(): string {
    const skills = this.skillRegistry.getAll();
    const tools = this.toolRegistry.getAll();

    const skillDesc = skills.map(s => {
      let desc = `- ${s.name}: ${s.description}`;
      if (s.inputSchema?.properties) {
        const params = Object.keys(s.inputSchema.properties).join(', ');
        desc += ` [参数: ${params}]`;
      }
      return desc;
    }).join('\n');

    const toolDesc = tools.map(t => `- ${t.name}: ${t.description}`).join('\n');

    return `技能:\n${skillDesc}\n\n工具:\n${toolDesc}`;
  }

  /**
   * 查找替代工具
   */
  private async findAlternativeTool(task: SubTask): Promise<string | null> {
    const skills = this.skillRegistry.getAll();
    
    // 根据描述相似度查找
    for (const skill of skills) {
      if (skill.description.toLowerCase().includes(task.description.toLowerCase().slice(0, 20))) {
        return skill.name;
      }
    }
    
    return null;
  }

  /**
   * 评估风险等级
   */
  private assessRiskLevel(
    toolName: string,
    params: Record<string, unknown>
  ): RiskLevel {
    // 高风险操作
    const highRiskOps = ['delete', 'remove', 'format', 'drop', 'truncate'];
    for (const op of highRiskOps) {
      if (toolName.toLowerCase().includes(op) || 
          JSON.stringify(params).toLowerCase().includes(op)) {
        return RiskLevel.HIGH;
      }
    }

    // 中风险操作
    const mediumRiskOps = ['write', 'update', 'modify', 'change'];
    for (const op of mediumRiskOps) {
      if (toolName.toLowerCase().includes(op)) {
        return RiskLevel.MEDIUM;
      }
    }

    return RiskLevel.LOW;
  }

  /**
   * 解析风险等级字符串
   */
  private parseRiskLevel(level: string | undefined): RiskLevel {
    switch (level?.toLowerCase()) {
      case 'low': return RiskLevel.LOW;
      case 'medium': return RiskLevel.MEDIUM;
      case 'high': return RiskLevel.HIGH;
      case 'critical': return RiskLevel.CRITICAL;
      default: return RiskLevel.LOW;
    }
  }

  /**
   * 拓扑排序
   */
  private topologicalSort(
    tasks: SubTask[],
    dependencies: Map<string, string[]>
  ): string[] {
    const result: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (taskId: string) => {
      if (visited.has(taskId)) return;
      if (visiting.has(taskId)) {
        // 循环依赖，跳过
        return;
      }

      visiting.add(taskId);

      const deps = dependencies.get(taskId) || [];
      for (const dep of deps) {
        visit(dep);
      }

      visiting.delete(taskId);
      visited.add(taskId);
      result.push(taskId);
    };

    for (const task of tasks) {
      visit(task.id);
    }

    return result;
  }

  /**
   * 计算并行组
   */
  private computeParallelGroups(
    tasks: SubTask[],
    dependencies: Map<string, string[]>
  ): string[][] {
    const groups: string[][] = [];
    const assigned = new Set<string>();

    // 按依赖层级分组
    while (assigned.size < tasks.length) {
      const group: string[] = [];
      
      for (const task of tasks) {
        if (assigned.has(task.id)) continue;
        
        const deps = dependencies.get(task.id) || [];
        const allDepsAssigned = deps.every(d => assigned.has(d));
        
        if (allDepsAssigned) {
          group.push(task.id);
        }
      }
      
      if (group.length === 0) {
        // 避免死循环，将剩余任务加入
        for (const task of tasks) {
          if (!assigned.has(task.id)) {
            group.push(task.id);
          }
        }
      }
      
      groups.push(group);
      group.forEach(id => assigned.add(id));
    }

    return groups;
  }

  /**
   * 风险等级转数字
   */
  private riskLevelToNumber(level: RiskLevel): number {
    switch (level) {
      case RiskLevel.LOW: return 1;
      case RiskLevel.MEDIUM: return 2;
      case RiskLevel.HIGH: return 3;
      case RiskLevel.CRITICAL: return 4;
      default: return 1;
    }
  }

  /**
   * 数字转风险等级
   */
  private numberToRiskLevel(num: number): RiskLevel {
    if (num >= 4) return RiskLevel.CRITICAL;
    if (num >= 3) return RiskLevel.HIGH;
    if (num >= 2) return RiskLevel.MEDIUM;
    return RiskLevel.LOW;
  }
}

// ═══════════════════════════════════════════════════════════════
// 全局实例
// ═══════════════════════════════════════════════════════════════

let thinkingEngineInstance: ThinkingEngine | null = null;

export function getThinkingEngine(): ThinkingEngine {
  if (!thinkingEngineInstance) {
    thinkingEngineInstance = new ThinkingEngine();
  }
  return thinkingEngineInstance;
}

export function resetThinkingEngine(): void {
  thinkingEngineInstance = null;
}
