/**
 * ReAct 执行器 - ReAct 循环模式
 * 
 * 核心机制：
 * - while (true) 循环
 * - 每次工具执行后，LLM 看到结果并决定下一步
 * - 支持中途调整策略
 * - 支持错误恢复
 * 
 * 设计参考：OpenClaw run.ts
 */

import { Task, TaskResult, SkillResult, SkillContext, LLMMessage, RiskLevel } from '../types';
import { getSkillRegistry } from '../skills/registry';
import { getLogger } from '../observability/logger';
import { getMemory } from '../memory';
import { getLLMManager } from '../llm';
import { getLockManager, ResourceLockManager } from '../scheduler/lock';

const logger = getLogger('executor:react');

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

/** ReAct 执行结果 */
export interface ReActResult {
  success: boolean;
  taskResults: TaskResult[];
  errors: string[];
  duration: number;
  finalMessage: string;
  rawResult?: string;
  /** 执行轮次 */
  iterations: number;
  /** 是否中途调整过策略 */
  strategyAdjusted: boolean;
}

/** 执行上下文 */
export interface ReActContext extends SkillContext {
  /** 对话历史 */
  history?: Array<{ role: string; content: string }>;
  /** 用户原始输入 */
  userIntent?: string;
  /** 会话ID */
  sessionId?: string;
}

/** LLM 决策 */
interface LLMDecision {
  /** 下一步动作 */
  action: 'execute' | 'adjust' | 'complete' | 'abort';
  /** 要执行的任务（execute 时） */
  task?: {
    skillName: string;
    params: Record<string, unknown>;
    description: string;
  };
  /** 调整说明（adjust 时） */
  adjustment?: string;
  /** 完成消息（complete 时） */
  message?: string;
  /** 中止原因（abort 时） */
  reason?: string;
}

/** 执行状态 */
interface ExecutionState {
  /** 已执行的任务 */
  executedTasks: TaskResult[];
  /** 当前输出 */
  currentOutput: string;
  /** 错误列表 */
  errors: string[];
  /** 迭代次数 */
  iterations: number;
  /** 是否调整过策略 */
  strategyAdjusted: boolean;
}

// ═══════════════════════════════════════════════════════════════
// ReAct 执行器
// ═══════════════════════════════════════════════════════════════

export class ReActExecutor {
  private maxIterations: number;
  private skillRegistry = getSkillRegistry();
  private memory = getMemory();
  private llm = getLLMManager();
  private lockManager: ResourceLockManager;

  constructor(maxIterations: number = 10) {
    this.maxIterations = maxIterations;
    this.lockManager = getLockManager();
  }

  /**
   * ReAct 主循环
   */
  async execute(
    initialTasks: Task[],
    parallelGroups: string[][],
    context: ReActContext = {},
    userIntent?: string
  ): Promise<ReActResult> {
    const startTime = Date.now();
    
    logger.info('ReAct 执行开始', {
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
    };

    // 如果没有初始任务，直接让 LLM 处理
    if (initialTasks.length === 0) {
      return this.executeDirectLLM(startTime, context, userIntent);
    }

    // 将初始任务转换为待执行队列
    let pendingTasks = [...initialTasks];

    try {
      // ReAct 主循环
      while (state.iterations < this.maxIterations) {
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

        logger.info('LLM 决策', {
          action: decision.action,
          task: decision.task?.skillName,
        });

        // 2. 根据决策执行
        switch (decision.action) {
          case 'execute':
            if (decision.task) {
              const result = await this.executeTask(decision.task, context);
              state.executedTasks.push(result);
              
              if (result.success) {
                state.currentOutput += result.message + '\n';
              } else {
                state.errors.push(result.error || '执行失败');
              }
              
              // 从待执行列表中移除已执行的任务
              pendingTasks = pendingTasks.filter(
                t => t.skillName !== decision.task!.skillName
              );
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
            break;

          case 'complete':
            // 执行完成
            logger.info('ReAct 执行完成', { iterations: state.iterations });
            
            const finalMessage = await this.generateFinalMessage(
              state,
              userIntent,
              decision.message
            );
            
            return {
              success: state.errors.length === 0,
              taskResults: state.executedTasks,
              errors: state.errors,
              duration: (Date.now() - startTime) / 1000,
              finalMessage,
              rawResult: state.currentOutput,
              iterations: state.iterations,
              strategyAdjusted: state.strategyAdjusted,
            };

          case 'abort':
            // 中止执行
            logger.warn('ReAct 执行中止', { reason: decision.reason });
            
            return {
              success: false,
              taskResults: state.executedTasks,
              errors: [...state.errors, decision.reason || '执行中止'],
              duration: (Date.now() - startTime) / 1000,
              finalMessage: decision.reason || '执行中止',
              rawResult: state.currentOutput,
              iterations: state.iterations,
              strategyAdjusted: state.strategyAdjusted,
            };
        }

        // 3. 检查是否所有任务都已完成
        if (pendingTasks.length === 0 && state.iterations >= initialTasks.length) {
          // 所有任务完成，生成最终结果
          const finalMessage = await this.generateFinalMessage(
            state,
            userIntent
          );
          
          return {
            success: state.errors.length === 0,
            taskResults: state.executedTasks,
            errors: state.errors,
            duration: (Date.now() - startTime) / 1000,
            finalMessage,
            rawResult: state.currentOutput,
            iterations: state.iterations,
            strategyAdjusted: state.strategyAdjusted,
          };
        }
      }

      // 达到最大迭代次数
      logger.warn('ReAct 达到最大迭代次数', { maxIterations: this.maxIterations });
      
      return {
        success: false,
        taskResults: state.executedTasks,
        errors: [...state.errors, '达到最大迭代次数'],
        duration: (Date.now() - startTime) / 1000,
        finalMessage: '执行超时：达到最大迭代次数',
        rawResult: state.currentOutput,
        iterations: state.iterations,
        strategyAdjusted: state.strategyAdjusted,
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('ReAct 执行错误', { error: errorMsg });
      
      return {
        success: false,
        taskResults: state.executedTasks,
        errors: [...state.errors, errorMsg],
        duration: (Date.now() - startTime) / 1000,
        finalMessage: `执行错误: ${errorMsg}`,
        rawResult: state.currentOutput,
        iterations: state.iterations,
        strategyAdjusted: state.strategyAdjusted,
      };
    }
  }

  /**
   * 获取 LLM 决策
   */
  private async getLLMDecision(
    pendingTasks: Task[],
    state: ExecutionState,
    context: ReActContext,
    userIntent?: string
  ): Promise<LLMDecision> {
    // 构建上下文
    const executedSummary = state.executedTasks.map(t => 
      `${t.taskId}: ${t.success ? '成功' : '失败'} - ${t.message?.substring(0, 100)}`
    ).join('\n');

    const pendingSummary = pendingTasks.map(t =>
      `${t.id}: ${t.skillName} - ${t.description}`
    ).join('\n');

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个任务执行决策器。根据当前执行状态，决定下一步操作。

## 当前状态
- 已执行任务: ${state.executedTasks.length}
- 待执行任务: ${pendingTasks.length}
- 错误数: ${state.errors.length}

## 已执行任务结果
${executedSummary || '无'}

## 待执行任务
${pendingSummary || '无'}

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
5. 每次只做一个决策`,
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
   * 重新规划任务
   */
  private async replanTasks(
    state: ExecutionState,
    context: ReActContext,
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
    // 如果 LLM 已经提供了消息，直接使用
    if (llmMessage) {
      return llmMessage;
    }

    // 否则让 LLM 根据执行结果生成回复
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
    } catch (error) {
      // 如果 LLM 失败，返回原始结果
      return state.currentOutput || '执行完成';
    }
  }

  /**
   * 直接使用 LLM 处理（无任务时）
   */
  private async executeDirectLLM(
    startTime: number,
    context: ReActContext,
    userIntent?: string
  ): Promise<ReActResult> {
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
      };
    }
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

let reactExecutorInstance: ReActExecutor | null = null;

export function getReActExecutor(): ReActExecutor {
  if (!reactExecutorInstance) {
    reactExecutorInstance = new ReActExecutor();
  }
  return reactExecutorInstance;
}

export function resetReActExecutor(): void {
  reactExecutorInstance = null;
}
