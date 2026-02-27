/**
 * ReAct 执行器 V2 - OpenClaw 风格
 * 
 * 核心改进：
 * 1. 完整的 while(true) 循环
 * 2. 工具执行钩子机制
 * 3. 上下文溢出处理
 * 4. 错误恢复和重试
 * 5. 流式输出支持
 * 
 * 参考：OpenClaw run.ts
 */

import { Task, TaskResult, SkillResult, SkillContext, LLMMessage, RiskLevel } from '../types';
import { getSkillRegistry } from '../skills/registry';
import { getLogger } from '../observability/logger';
import { getMemory } from '../memory';
import { getLLMManager } from '../llm';
import { getLockManager, ResourceLockManager } from '../scheduler/lock';
import { StreamEvent } from '../types/stream';

const logger = getLogger('executor:react-v2');

// ═══════════════════════════════════════════════════════════════
// 常量配置
// ═══════════════════════════════════════════════════════════════

const MAX_RUN_LOOP_ITERATIONS = 24;
const MAX_OVERFLOW_COMPACTION_ATTEMPTS = 3;
const CONTEXT_WINDOW_WARN_TOKENS = 8000;
const CONTEXT_WINDOW_HARD_MIN_TOKENS = 1000;

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

/** 工具调用事件 */
export interface ToolCallEvent {
  toolCallId: string;
  toolName: string;
  params: Record<string, unknown>;
  startTime: number;
}

/** 工具结果事件 */
export interface ToolResultEvent {
  toolCallId: string;
  toolName: string;
  result: unknown;
  error?: string;
  duration: number;
  success: boolean;
}

/** 执行钩子 */
export interface ExecutionHooks {
  beforeToolCall?: (event: ToolCallEvent) => Promise<void>;
  afterToolCall?: (event: ToolResultEvent) => Promise<void>;
  onThinking?: (message: string) => Promise<void>;
  onContent?: (text: string) => Promise<void>;
  onError?: (error: string) => Promise<void>;
}

/** ReAct 执行结果 V2 */
export interface ReActResultV2 {
  success: boolean;
  taskResults: TaskResult[];
  errors: string[];
  duration: number;
  finalMessage: string;
  rawResult?: string;
  iterations: number;
  strategyAdjusted: boolean;
  toolCalls: ToolResultEvent[];
}

/** 执行上下文 */
export interface ReActContextV2 extends SkillContext {
  history?: Array<{ role: string; content: string }>;
  userIntent?: string;
  sessionId?: string;
  hooks?: ExecutionHooks;
}

/** LLM 决策 */
interface LLMDecision {
  action: 'execute' | 'adjust' | 'complete' | 'abort';
  task?: {
    skillName: string;
    params: Record<string, unknown>;
    description: string;
  };
  adjustment?: string;
  message?: string;
  reason?: string;
  thinking?: string;
}

/** 执行状态 */
interface ExecutionState {
  executedTasks: TaskResult[];
  currentOutput: string;
  errors: string[];
  iterations: number;
  strategyAdjusted: boolean;
  toolCalls: ToolResultEvent[];
  contextTokens: number;
  lastToolError?: { toolName: string; error: string };
}

// ═══════════════════════════════════════════════════════════════
// ReAct 执行器 V2
// ═══════════════════════════════════════════════════════════════

export class ReActExecutorV2 {
  private maxIterations: number;
  private skillRegistry = getSkillRegistry();
  private memory = getMemory();
  private llm = getLLMManager();
  private lockManager: ResourceLockManager;
  private toolCallCounter = 0;

  constructor(maxIterations: number = MAX_RUN_LOOP_ITERATIONS) {
    this.maxIterations = maxIterations;
    this.lockManager = getLockManager();
  }

  /**
   * ReAct 主循环 - OpenClaw 风格
   */
  async execute(
    initialTasks: Task[],
    parallelGroups: string[][],
    context: ReActContextV2 = {},
    userIntent?: string
  ): Promise<ReActResultV2> {
    const startTime = Date.now();
    
    logger.info('ReAct V2 执行开始', {
      taskCount: initialTasks.length,
      userIntent: userIntent?.substring(0, 100),
    });

    // 初始化执行状态
    const state: ExecutionState = {
      executedTasks: [],
      currentOutput: '',
      errors: [],
      iterations: 0,
      strategyAdjusted: false,
      toolCalls: [],
      contextTokens: 0,
    };

    // 如果没有初始任务，直接让 LLM 处理
    if (initialTasks.length === 0) {
      return this.executeDirectLLM(startTime, context, userIntent);
    }

    // 将初始任务转换为待执行队列
    let pendingTasks = [...initialTasks];
    let overflowCompactionAttempts = 0;

    try {
      // ═══════════════════════════════════════════════════════════
      // ReAct 主循环 - while (true)
      // ═══════════════════════════════════════════════════════════
      while (true) {
        // 检查迭代限制
        if (state.iterations >= this.maxIterations) {
          logger.warn('ReAct 达到最大迭代次数', { maxIterations: this.maxIterations });
          return this.createResult(state, startTime, '达到最大迭代次数', false);
        }
        state.iterations++;

        logger.debug(`ReAct 迭代 ${state.iterations}`, {
          pendingTasks: pendingTasks.length,
          executedTasks: state.executedTasks.length,
        });

        // 1. 获取 LLM 决策
        const decision = await this.getLLMDecision(
          pendingTasks,
          state,
          context,
          userIntent
        );

        // 触发思考钩子
        if (decision.thinking && context.hooks?.onThinking) {
          await context.hooks.onThinking(decision.thinking);
        }

        logger.info('LLM 决策', {
          action: decision.action,
          task: decision.task?.skillName,
        });

        // 2. 根据决策执行
        switch (decision.action) {
          case 'execute':
            if (decision.task) {
              const result = await this.executeTaskWithHooks(
                decision.task,
                context
              );
              
              state.executedTasks.push(result.taskResult);
              state.toolCalls.push(result.toolEvent);
              
              if (result.taskResult.success) {
                state.currentOutput += result.taskResult.message + '\n';
              } else {
                state.errors.push(result.taskResult.error || '执行失败');
                state.lastToolError = {
                  toolName: decision.task.skillName,
                  error: result.taskResult.error || '执行失败',
                };
              }
              
              // 从待执行列表中移除已执行的任务
              pendingTasks = pendingTasks.filter(
                t => t.skillName !== decision.task!.skillName
              );
              
              // 更新上下文 token 估算
              state.contextTokens += this.estimateTokens(result.taskResult.message || '');
            }
            break;

          case 'adjust':
            // 策略调整：重新生成任务列表
            state.strategyAdjusted = true;
            if (decision.adjustment) {
              logger.info('策略调整', { adjustment: decision.adjustment });
            }
            
            // 让 LLM 重新规划
            const newTasks = await this.replanTasks(state, context, userIntent);
            pendingTasks = newTasks;
            
            // 清除最后的工具错误
            state.lastToolError = undefined;
            break;

          case 'complete':
            // 执行完成
            logger.info('ReAct 执行完成', { iterations: state.iterations });
            
            const finalMessage = await this.generateFinalMessage(
              state,
              userIntent,
              decision.message
            );
            
            return this.createResult(state, startTime, finalMessage, true);

          case 'abort':
            // 中止执行
            logger.warn('ReAct 执行中止', { reason: decision.reason });
            
            return this.createResult(
              state,
              startTime,
              decision.reason || '执行中止',
              false
            );
        }

        // 3. 检查上下文溢出
        if (state.contextTokens > CONTEXT_WINDOW_WARN_TOKENS) {
          logger.warn('上下文接近溢出', { tokens: state.contextTokens });
          
          if (overflowCompactionAttempts < MAX_OVERFLOW_COMPACTION_ATTEMPTS) {
            overflowCompactionAttempts++;
            
            // 压缩上下文
            const compacted = await this.compactContext(state, context);
            if (compacted) {
              state.contextTokens = this.estimateTokens(state.currentOutput);
              logger.info('上下文压缩成功', { newTokens: state.contextTokens });
            }
          }
        }

        // 4. 检查是否所有任务都已完成
        if (pendingTasks.length === 0 && state.iterations >= initialTasks.length) {
          const finalMessage = await this.generateFinalMessage(state, userIntent);
          return this.createResult(state, startTime, finalMessage, true);
        }
      }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('ReAct 执行错误', { error: errorMsg });
      
      return this.createResult(state, startTime, `执行错误: ${errorMsg}`, false);
    }
  }

  /**
   * 执行任务并触发钩子
   */
  private async executeTaskWithHooks(
    taskInfo: { skillName: string; params: Record<string, unknown>; description: string },
    context: ReActContextV2
  ): Promise<{ taskResult: TaskResult; toolEvent: ToolResultEvent }> {
    const toolCallId = `tc_${++this.toolCallCounter}_${Date.now()}`;
    const startTime = Date.now();
    
    // 触发 beforeToolCall 钩子
    if (context.hooks?.beforeToolCall) {
      await context.hooks.beforeToolCall({
        toolCallId,
        toolName: taskInfo.skillName,
        params: taskInfo.params,
        startTime,
      });
    }

    // 执行任务
    const taskResult = await this.executeTask(taskInfo, context);
    const duration = Date.now() - startTime;

    // 创建工具事件
    const toolEvent: ToolResultEvent = {
      toolCallId,
      toolName: taskInfo.skillName,
      result: taskResult.data,
      error: taskResult.error,
      duration,
      success: taskResult.success,
    };

    // 触发 afterToolCall 钩子
    if (context.hooks?.afterToolCall) {
      await context.hooks.afterToolCall(toolEvent);
    }

    return { taskResult, toolEvent };
  }

  /**
   * 执行单个任务
   */
  private async executeTask(
    taskInfo: { skillName: string; params: Record<string, unknown>; description: string },
    context: SkillContext
  ): Promise<TaskResult> {
    const startTime = Date.now();
    const taskId = `task_${Date.now()}`;
    
    logger.info('执行任务', { skillName: taskInfo.skillName, params: taskInfo.params });

    try {
      // 获取技能
      let skill = this.skillRegistry.get(taskInfo.skillName);
      
      if (!skill) {
        // 尝试根据能力匹配
        const skills = this.skillRegistry.findByCapability(taskInfo.skillName);
        if (skills.length > 0) {
          skill = skills[0];
        }
      }

      if (!skill) {
        throw new Error(`技能不存在: ${taskInfo.skillName}`);
      }

      // 验证参数
      const validation = await skill.validateParams(taskInfo.params);
      if (!validation.valid) {
        throw new Error(validation.error || '参数验证失败');
      }

      // 执行技能
      const result = await skill.run(taskInfo.params, context);
      const duration = (Date.now() - startTime) / 1000;

      // 记录成功
      this.memory.recordSuccess(skill.name);

      logger.info('任务执行成功', { skillName: skill.name, duration });

      return {
        taskId,
        success: result.success,
        data: result.data,
        message: result.message,
        error: result.error,
        duration,
      };

    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      logger.error('任务执行失败', { skillName: taskInfo.skillName, error: errorMsg });
      
      if (taskInfo.skillName) {
        this.memory.recordFailure(taskInfo.skillName);
      }

      return {
        taskId,
        success: false,
        data: {},
        message: '执行失败',
        error: errorMsg,
        duration,
      };
    }
  }

  /**
   * 获取 LLM 决策 - OpenClaw 风格
   */
  private async getLLMDecision(
    pendingTasks: Task[],
    state: ExecutionState,
    context: ReActContextV2,
    userIntent?: string
  ): Promise<LLMDecision> {
    // 构建上下文
    const executedSummary = state.executedTasks.map(t => 
      `${t.taskId}: ${t.success ? '成功' : '失败'} - ${t.message?.substring(0, 100)}`
    ).join('\n');

    const pendingSummary = pendingTasks.map(t =>
      `${t.id}: ${t.skillName} - ${t.description}`
    ).join('\n');

    // 构建工具调用历史
    const toolCallHistory = state.toolCalls.slice(-5).map(tc =>
      `${tc.toolName}: ${tc.success ? '成功' : '失败'} (${tc.duration}ms)`
    ).join('\n');

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个任务执行决策器，采用 ReAct 模式工作。

## 当前状态
- 已执行任务: ${state.executedTasks.length}
- 待执行任务: ${pendingTasks.length}
- 错误数: ${state.errors.length}
- 迭代次数: ${state.iterations}/${this.maxIterations}

## 已执行任务结果
${executedSummary || '无'}

## 最近工具调用
${toolCallHistory || '无'}

## 待执行任务
${pendingSummary || '无'}

${state.lastToolError ? `## 最后的错误
${state.lastToolError.toolName}: ${state.lastToolError.error}` : ''}

## 决策选项

1. **execute**: 执行下一个任务
   - 当有待执行任务且没有严重错误时
   - 必须提供 task 对象

2. **adjust**: 调整策略
   - 当执行结果不理想需要重新规划时
   - 必须提供 adjustment 说明

3. **complete**: 执行完成
   - 当所有任务已完成或用户需求已满足时
   - 可提供 message 作为最终回复

4. **abort**: 中止执行
   - 当遇到无法恢复的错误时
   - 必须提供 reason

## 输出格式

输出 JSON 格式：
{
  "action": "execute|adjust|complete|abort",
  "thinking": "你的思考过程",
  "task": { "skillName": "xxx", "params": {}, "description": "xxx" },
  "adjustment": "调整说明",
  "message": "完成消息",
  "reason": "中止原因"
}

## 规则

1. 如果有待执行任务且没有错误，优先执行
2. 如果有错误但可以恢复，考虑 adjust
3. 如果用户需求已满足，选择 complete
4. 如果错误无法恢复，选择 abort
5. 每次只做一个决策
6. 先思考再决策`,
      },
      {
        role: 'user',
        content: `用户需求: ${userIntent || '未知'}

请根据当前状态做出决策。`,
      },
    ];

    try {
      const response = await this.llm.chat(messages, { temperature: 0.3 });
      const result = this.parseJSON(response.content);
      
      return {
        action: (result.action as LLMDecision['action']) || 'complete',
        thinking: result.thinking as string,
        task: result.task as LLMDecision['task'],
        adjustment: result.adjustment as string,
        message: result.message as string,
        reason: result.reason as string,
      };
    } catch (error) {
      logger.error('LLM 决策失败', { error });
      
      // 默认：执行下一个任务或完成
      if (pendingTasks.length > 0) {
        const nextTask = pendingTasks[0];
        return {
          action: 'execute',
          task: {
            skillName: nextTask.skillName || 'unknown',
            params: nextTask.params,
            description: nextTask.description,
          },
        };
      }
      
      return { action: 'complete', message: '执行完成' };
    }
  }

  /**
   * 压缩上下文
   */
  private async compactContext(
    state: ExecutionState,
    context: ReActContextV2
  ): Promise<boolean> {
    try {
      // 保留最近的任务结果
      const recentTasks = state.executedTasks.slice(-5);
      const recentOutput = recentTasks.map(t => t.message || '').join('\n');
      
      // 使用 LLM 压缩
      const messages: LLMMessage[] = [
        {
          role: 'system',
          content: '你是一个文本压缩器。保留关键信息，删除冗余内容。',
        },
        {
          role: 'user',
          content: `请压缩以下内容，保留关键信息：\n\n${state.currentOutput}`,
        },
      ];

      const response = await this.llm.chat(messages, { temperature: 0.3 });
      state.currentOutput = response.content;
      
      return true;
    } catch (error) {
      logger.error('上下文压缩失败', { error });
      return false;
    }
  }

  /**
   * 重新规划任务
   */
  private async replanTasks(
    state: ExecutionState,
    context: ReActContextV2,
    userIntent?: string
  ): Promise<Task[]> {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个任务规划器。根据执行结果重新规划任务。

## 可用技能
${this.skillRegistry.getAll().map(s => `- ${s.name}: ${s.description}`).join('\n')}

## 输出格式

输出 JSON 格式：
{
  "tasks": [
    {
      "id": "task_1",
      "skillName": "技能名称",
      "params": {},
      "description": "任务描述"
    }
  ]
}`,
      },
      {
        role: 'user',
        content: `用户需求: ${userIntent}

已执行任务:
${state.executedTasks.map(t => `${t.taskId}: ${t.success ? '成功' : '失败'}`).join('\n')}

错误:
${state.errors.join('\n')}

请重新规划任务。`,
      },
    ];

    try {
      const response = await this.llm.chat(messages, { temperature: 0.3 });
      const result = this.parseJSON(response.content);
      
      if (Array.isArray(result.tasks)) {
        return result.tasks.map((t: any, i: number) => ({
          id: t.id || `task_${i + 1}`,
          description: t.description || '',
          type: t.skillName || 'unknown',
          skillName: t.skillName,
          params: t.params || {},
          riskLevel: RiskLevel.LOW,
          dependencies: [],
        }));
      }
    } catch (error) {
      logger.error('重新规划失败', { error });
    }

    return [];
  }

  /**
   * 生成最终消息
   */
  private async generateFinalMessage(
    state: ExecutionState,
    userIntent?: string,
    llmMessage?: string
  ): Promise<string> {
    if (llmMessage) {
      return llmMessage;
    }

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个智能助手。根据任务执行结果，给用户一个友好的回复。

## 规则
1. 总结执行结果
2. 如果有错误，说明原因
3. 使用自然语言，像朋友一样交流`,
      },
      {
        role: 'user',
        content: `用户需求: ${userIntent || '未知'}

执行结果:
${state.executedTasks.map(t => `${t.taskId}: ${t.success ? '成功' : '失败'} - ${t.message?.substring(0, 200)}`).join('\n')}

${state.errors.length > 0 ? `错误:\n${state.errors.join('\n')}` : ''}

请给用户一个回复。`,
      },
    ];

    try {
      const response = await this.llm.chat(messages, { temperature: 0.7 });
      return response.content;
    } catch {
      return state.currentOutput || '执行完成';
    }
  }

  /**
   * 直接使用 LLM 处理
   */
  private async executeDirectLLM(
    startTime: number,
    context: ReActContextV2,
    userIntent?: string
  ): Promise<ReActResultV2> {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: '你是一个智能助手，请帮助用户解决问题。',
      },
      {
        role: 'user',
        content: userIntent || '你好',
      },
    ];

    try {
      const response = await this.llm.chat(messages, { temperature: 0.7 });
      
      return {
        success: true,
        taskResults: [],
        errors: [],
        duration: (Date.now() - startTime) / 1000,
        finalMessage: response.content,
        rawResult: response.content,
        iterations: 1,
        strategyAdjusted: false,
        toolCalls: [],
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      return {
        success: false,
        taskResults: [],
        errors: [errorMsg],
        duration: (Date.now() - startTime) / 1000,
        finalMessage: `处理失败: ${errorMsg}`,
        rawResult: '',
        iterations: 1,
        strategyAdjusted: false,
        toolCalls: [],
      };
    }
  }

  /**
   * 创建结果对象
   */
  private createResult(
    state: ExecutionState,
    startTime: number,
    finalMessage: string,
    success: boolean
  ): ReActResultV2 {
    return {
      success: success && state.errors.length === 0,
      taskResults: state.executedTasks,
      errors: state.errors,
      duration: (Date.now() - startTime) / 1000,
      finalMessage,
      rawResult: state.currentOutput,
      iterations: state.iterations,
      strategyAdjusted: state.strategyAdjusted,
      toolCalls: state.toolCalls,
    };
  }

  /**
   * 估算 token 数量
   */
  private estimateTokens(text: string): number {
    // 简单估算：中文约 1.5 字符/token，英文约 4 字符/token
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return Math.ceil(chineseChars / 1.5 + otherChars / 4);
  }

  /**
   * 解析 JSON
   */
  private parseJSON(text: string): Record<string, unknown> {
    try {
      return JSON.parse(text);
    } catch {
      const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) ||
                        text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[1] || jsonMatch[0]);
        } catch {
          // ignore
        }
      }
      return {};
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 全局实例
// ═══════════════════════════════════════════════════════════════

let reactExecutorV2Instance: ReActExecutorV2 | null = null;

export function getReActExecutorV2(): ReActExecutorV2 {
  if (!reactExecutorV2Instance) {
    reactExecutorV2Instance = new ReActExecutorV2();
  }
  return reactExecutorV2Instance;
}

export function resetReActExecutorV2(): void {
  reactExecutorV2Instance = null;
}
