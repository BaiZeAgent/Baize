/**
 * 思考层 - 任务分析与规划引擎
 * 
 * 核心理念：
 * - 信任LLM的判断能力，让它一次性决定怎么处理
 * - 不硬编码关键词，不预设流程
 * - LLM自己决定是对话、简单任务还是复杂任务
 * - 查询历史经验辅助决策
 * 
 * 任务类型：
 * 1. chat - 普通对话，直接回复
 * 2. simple_task - 简单任务，单工具调用
 * 3. complex_task - 复杂任务，多步骤执行
 */

import { getSkillRegistry } from '../../skills/registry';
import { getToolRegistry } from '../../tools';
import { getLLMManager } from '../../llm';
import { getMemory } from '../../memory';
import { getLogger } from '../../observability/logger';
import { LLMMessage, RiskLevel } from '../../types';

const logger = getLogger('core:thinking');

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

/** 任务类型 */
export type TaskType = 'chat' | 'simple_task' | 'complex_task';

/** 子任务 */
export interface SubTask {
  id: string;
  skillName: string;
  description: string;
  params: Record<string, unknown>;
  dependencies: string[];
  riskLevel: RiskLevel;
  estimatedTime: number;
  isOptional: boolean;
  fallbackTaskId?: string;
}

/** 执行计划 */
export interface ExecutionPlan {
  id: string;
  description: string;
  tasks: SubTask[];
  parallelGroups: string[][];
  estimatedTotalTime: number;
  riskAssessment: {
    level: RiskLevel;
    factors: string[];
    mitigations: string[];
  };
  successCriteria: string[];
  /** 是否从经验中学习 */
  fromExperience?: boolean;
}

/** LLM决策结果 */
interface LLMDecision {
  type: TaskType;
  response?: string;
  tool?: string;
  params?: Record<string, unknown>;
  confidence?: number;
  steps?: Array<{
    id: string;
    tool: string;
    description: string;
    params: Record<string, unknown>;
    dependencies: string[];
  }>;
  reasoning?: string;
}

// ═══════════════════════════════════════════════════════════════
// 思考引擎
// ═══════════════════════════════════════════════════════════════

export class ThinkingEngine {
  private skillRegistry = getSkillRegistry();
  private toolRegistry = getToolRegistry();
  private llm = getLLMManager();
  private memory = getMemory();

  /**
   * 思考入口
   */
  async think(userInput: string, context?: { failedTool?: string; failureReason?: string }): Promise<ExecutionPlan> {
    logger.info(`[思考] 开始分析: ${userInput.slice(0, 50)}...`);

    try {
      const tools = this.getAvailableTools();

      // 1. 查询经验
      const experience = this.memory.findSuccessExperience(userInput, context?.failedTool);
      
      if (experience && !context?.failedTool) {
        // 有成功经验，直接用
        logger.info(`[思考] 使用历史经验: ${experience.tool}`);
        return this.createPlanFromExperience(userInput, experience);
      }

      // 2. 查询失败的工具（避免重复）
      const failedTools = this.memory.findFailedTools(userInput);
      const failedToolsStr = failedTools.length > 0 ? `\n注意：以下工具之前失败过，请优先考虑其他方案：${failedTools.join(', ')}` : '';

      // 3. LLM决策
      const decision = await this.getLLMDecision(userInput, tools, failedToolsStr, context);

      logger.info(`[思考] LLM决策: type=${decision.type}, reasoning=${decision.reasoning?.slice(0, 100)}`);

      // 4. 根据决策生成计划
      switch (decision.type) {
        case 'chat':
          return this.createChatPlan(userInput, decision);
        case 'simple_task':
          return this.createSimpleTaskPlan(userInput, decision);
        case 'complex_task':
          return this.createComplexTaskPlan(userInput, decision);
        default:
          return this.createChatPlan(userInput, {
            type: 'chat',
            response: '我需要更多信息来帮助你。',
          });
      }

    } catch (error) {
      logger.error(`[思考] 错误: ${error}`);
      return this.createChatPlan(userInput, {
        type: 'chat',
        response: `抱歉，我在处理你的请求时遇到了问题。请换一种方式描述？`,
      });
    }
  }

  /**
   * LLM决策
   */
  private async getLLMDecision(
    userInput: string, 
    tools: string, 
    failedToolsHint: string,
    context?: { failedTool?: string; failureReason?: string }
  ): Promise<LLMDecision> {
    
    const contextHint = context?.failedTool 
      ? `\n\n重要提示：之前使用 ${context.failedTool} 失败了，原因：${context.failureReason}。请选择不同的工具或更复杂的方案。`
      : '';

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个智能助手的决策核心。分析用户输入，决定如何处理。

## 可用工具
${tools}
${failedToolsHint}${contextHint}

## 判断任务类型

1. **chat**: 普通对话，不需要调用工具
   - 问候、闲聊、常识性问题
   - 用户只是在和你交流

2. **simple_task**: 简单任务，一个工具就能完成
   - 单一明确的操作
   - 例如：查时间、简单计算、创建文件

3. **complex_task**: 复杂任务，需要多个步骤
   - 需要多个工具配合
   - 例如：搜索网站并提取数据、多步操作

## 输出格式（必须是有效的JSON）

### chat类型：
{"type":"chat","response":"回复内容","reasoning":"为什么是对话"}

### simple_task类型：
{"type":"simple_task","tool":"工具名","params":{},"reasoning":"为什么是简单任务"}

### complex_task类型：
{"type":"complex_task","steps":[{"id":"step_1","tool":"工具名","description":"描述","params":{},"dependencies":[]},{"id":"step_2","tool":"工具名","description":"描述","params":{},"dependencies":["step_1"]}],"reasoning":"为什么是复杂任务"}

## 重要
1. 必须输出有效JSON
2. 工具名必须在可用工具列表中
3. 不要编造工具`
      },
      {
        role: 'user',
        content: userInput
      }
    ];

    const response = await this.llm.chat(messages, { temperature: 0.3 });
    
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { type: 'chat', response: response.content, reasoning: 'LLM未返回结构化决策' };
    }

    try {
      const decision = JSON.parse(jsonMatch[0]) as LLMDecision;
      if (!['chat', 'simple_task', 'complex_task'].includes(decision.type)) {
        decision.type = 'chat';
      }
      return decision;
    } catch {
      return { type: 'chat', response: response.content, reasoning: 'JSON解析失败' };
    }
  }

  /**
   * 从经验创建计划
   */
  private createPlanFromExperience(userInput: string, experience: any): ExecutionPlan {
    return {
      id: `plan_exp_${Date.now()}`,
      description: `经验驱动: ${userInput.slice(0, 50)}`,
      tasks: [{
        id: 'task_1',
        description: userInput,
        skillName: experience.tool,
        params: experience.params || {},
        dependencies: [],
        riskLevel: RiskLevel.LOW,
        estimatedTime: 10,
        isOptional: false,
      }],
      parallelGroups: [['task_1']],
      estimatedTotalTime: 10,
      riskAssessment: { level: RiskLevel.LOW, factors: [], mitigations: [] },
      successCriteria: ['任务执行成功'],
      fromExperience: true,
    };
  }

  /**
   * 创建对话计划
   */
  private createChatPlan(userInput: string, decision: LLMDecision): ExecutionPlan {
    return {
      id: `plan_chat_${Date.now()}`,
      description: `对话回复: ${userInput.slice(0, 50)}`,
      tasks: [{
        id: 'chat_response',
        description: '直接回复用户',
        skillName: 'chat',
        params: { response: decision.response || '你好！有什么我可以帮助你的吗？' },
        dependencies: [],
        riskLevel: RiskLevel.LOW,
        estimatedTime: 1,
        isOptional: false,
      }],
      parallelGroups: [['chat_response']],
      estimatedTotalTime: 1,
      riskAssessment: { level: RiskLevel.LOW, factors: [], mitigations: [] },
      successCriteria: ['用户得到回复'],
    };
  }

  /**
   * 创建简单任务计划
   */
  private createSimpleTaskPlan(userInput: string, decision: LLMDecision): ExecutionPlan {
    let toolName = decision.tool || 'unknown';
    let params = decision.params || {};

    // 验证工具
    const skill = this.skillRegistry.get(toolName);
    const hasTool = this.toolRegistry.has(toolName);

    if (!skill && !hasTool) {
      return this.createChatPlan(userInput, {
        type: 'chat',
        response: `我理解你想执行这个任务，但没有找到合适的工具。你可以换一种方式描述吗？`,
        reasoning: `工具 ${toolName} 不存在`
      });
    }

    // 浏览器自动化使用task参数格式
    if (toolName === 'browser-automation') {
      params = { task: userInput };
    }

    return {
      id: `plan_simple_${Date.now()}`,
      description: `简单任务: ${userInput.slice(0, 50)}`,
      tasks: [{
        id: 'task_1',
        description: userInput,
        skillName: toolName,
        params: params,
        dependencies: [],
        riskLevel: this.assessRisk(toolName, params),
        estimatedTime: 10,
        isOptional: false,
      }],
      parallelGroups: [['task_1']],
      estimatedTotalTime: 10,
      riskAssessment: { level: this.assessRisk(toolName, params), factors: [], mitigations: [] },
      successCriteria: ['任务执行成功'],
    };
  }

  /**
   * 创建复杂任务计划
   */
  private createComplexTaskPlan(userInput: string, decision: LLMDecision): ExecutionPlan {
    const steps = decision.steps || [];

    if (steps.length === 0) {
      return this.createChatPlan(userInput, {
        type: 'chat',
        response: '我理解这是一个复杂的任务，但需要更多信息来规划。你能详细描述一下吗？',
      });
    }

    const tasks: SubTask[] = steps.map((step, index) => ({
      id: step.id || `task_${index + 1}`,
      description: step.description,
      skillName: step.tool,
      params: step.params || {},
      dependencies: step.dependencies || [],
      riskLevel: this.assessRisk(step.tool, step.params),
      estimatedTime: 30,
      isOptional: false,
    }));

    // 验证工具
    const validTasks: SubTask[] = [];
    for (const task of tasks) {
      const skill = this.skillRegistry.get(task.skillName);
      const hasTool = this.toolRegistry.has(task.skillName);
      if (skill || hasTool) {
        validTasks.push(task);
      } else {
        logger.warn(`[思考] 工具不存在: ${task.skillName}`);
      }
    }

    if (validTasks.length === 0) {
      return this.createChatPlan(userInput, {
        type: 'chat',
        response: `我没有找到合适的工具来完成这个任务。请换一种方式描述？`,
      });
    }

    const parallelGroups = this.computeParallelGroups(validTasks);
    const totalTime = validTasks.reduce((sum, t) => sum + t.estimatedTime, 0);
    const maxRisk = Math.max(...validTasks.map(t => this.riskLevelToNumber(t.riskLevel)));

    return {
      id: `plan_complex_${Date.now()}`,
      description: `复杂任务: ${userInput.slice(0, 50)}`,
      tasks: validTasks,
      parallelGroups,
      estimatedTotalTime: totalTime,
      riskAssessment: { level: this.numberToRiskLevel(maxRisk), factors: [], mitigations: [] },
      successCriteria: ['所有步骤执行成功'],
    };
  }

  /**
   * 获取可用工具描述
   */
  private getAvailableTools(): string {
    const skills = this.skillRegistry.getAll();
    const tools = this.toolRegistry.getAll();
    const lines: string[] = [];

    for (const skill of skills) {
      // 特殊处理browser-automation
      if (skill.name === 'browser-automation') {
        lines.push(`- browser-automation: 浏览器自动化，支持多种操作
  用法示例: {"tool":"browser-automation","params":{"action":"bilibili_search","keyword":"搜索词"}}
  可用action: bilibili_search(搜索B站), open(打开网页), screenshot(截图)`);
        continue;
      }
      
      const caps = skill.capabilities?.length > 0 ? ` (${skill.capabilities.slice(0, 3).join(', ')})` : '';
      lines.push(`- ${skill.name}: ${skill.description.slice(0, 60)}${caps}`);
    }

    for (const tool of tools) {
      lines.push(`- ${tool.name}: ${tool.description.slice(0, 60)}`);
    }

    return lines.join('\n');
  }

  /**
   * 评估风险
   */
  private assessRisk(toolName: string, params: Record<string, unknown>): RiskLevel {
    const highRisk = ['delete', 'remove', 'drop', 'format', 'shutdown'];
    const mediumRisk = ['write', 'create', 'modify', 'execute'];

    const toolLower = toolName.toLowerCase();
    const paramsStr = JSON.stringify(params).toLowerCase();

    for (const p of highRisk) {
      if (toolLower.includes(p) || paramsStr.includes(p)) return RiskLevel.HIGH;
    }
    for (const p of mediumRisk) {
      if (toolLower.includes(p) || paramsStr.includes(p)) return RiskLevel.MEDIUM;
    }
    return RiskLevel.LOW;
  }

  /**
   * 计算并行组
   */
  private computeParallelGroups(tasks: SubTask[]): string[][] {
    const groups: string[][] = [];
    const completed = new Set<string>();
    const remaining = new Set(tasks.map(t => t.id));

    while (remaining.size > 0) {
      const ready: string[] = [];
      for (const taskId of remaining) {
        const task = tasks.find(t => t.id === taskId);
        if (task && task.dependencies.every(dep => completed.has(dep))) {
          ready.push(taskId);
        }
      }
      if (ready.length === 0) {
        const taskId = remaining.values().next().value;
        if (taskId) ready.push(taskId);
      }
      groups.push(ready);
      ready.forEach(id => {
        completed.add(id);
        remaining.delete(id);
      });
    }
    return groups;
  }

  private riskLevelToNumber(level: RiskLevel): number {
    switch (level) {
      case RiskLevel.LOW: return 1;
      case RiskLevel.MEDIUM: return 2;
      case RiskLevel.HIGH: return 3;
      case RiskLevel.CRITICAL: return 4;
      default: return 1;
    }
  }

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
