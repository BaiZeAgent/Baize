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
          // 成功
          result.retries = attemptCount - 1;
          if (context.hooks?.onTaskComplete) {
            await context.hooks.onTaskComplete(task, result);
          }
          return result;
        }

        // 失败，尝试恢复
        const recovery = await this.recoveryEngine.recover(
          new Error(result.error || '任务执行失败'),
          {
            task: { skillName: currentSkill, params: currentParams },
            userInput: context.userInput,
            previousAttempts: attemptCount,
          }
        );

        state.recoveryHistory.push(recovery);
        if (context.hooks?.onRecovery) {
          await context.hooks.onRecovery(recovery);
        }

        if (!recovery.shouldRetry) {
          // 不可恢复
          result.retries = attemptCount - 1;
          if (context.hooks?.onTaskError) {
            await context.hooks.onTaskError(task, new Error(result.error || '不可恢复'));
          }
          return result;
        }

        // 应用恢复策略
        const adjusted = this.applyRecovery(task, recovery, currentParams, currentSkill);
        currentParams = adjusted.params;
        currentSkill = adjusted.skillName;

        // 记录恢复经验
        this.recoveryEngine.recordExperience(
          new Error(result.error || ''),
          recovery.rootCause,
          recovery.strategy,
          false // 暂时标记为失败，成功后会更新
        );

      } catch (error) {
        logger.error(`[执行任务] ${task.id} 异常: ${error}`);
        
        // 异常恢复
        const recovery = await this.recoveryEngine.recover(error as Error, {
          task: { skillName: currentSkill, params: currentParams },
          userInput: context.userInput,
          previousAttempts: attemptCount,
        });

        state.recoveryHistory.push(recovery);

        if (!recovery.shouldRetry) {
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

        const adjusted = this.applyRecovery(task, recovery, currentParams, currentSkill);
        currentParams = adjusted.params;
        currentSkill = adjusted.skillName;
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

    // 检查是否有特殊数据需要展示（真实数据优先）
    const lastResult = state.completedTasks[state.completedTasks.length - 1];
    
    // 根据用户请求决定返回格式
    const wantMultiple = context.userInput.includes('前') || 
                         context.userInput.includes('列表') || 
                         context.userInput.includes('列出') ||
                         context.userInput.includes('几个');
    
    // 如果用户要求多个结果，优先返回列表
    if (wantMultiple && lastResult?.data?.results) {
      const results = lastResult.data.results as any[];
      if (results.length > 0 && results[0].link && results[0].link !== 'undefined') {
        let msg = `找到了 ${results.length} 个结果：
`;
        results.forEach((v, i) => {
          if (v.link && v.link !== 'undefined') {
            msg += `${i + 1}. ${v.title}
   链接: ${v.link}
   播放: ${v.playCount || '未知'}
`;
          }
        });
        return msg;
      }
    }
    
    // 默认返回第一个结果
    if (lastResult?.data?.firstVideo) {
      const v = lastResult.data.firstVideo as any;
      if (v.link && v.link !== 'undefined') {
        return `找到了！第一个视频是「${v.title}」，链接是 ${v.link}，播放量 ${v.playCount}。`;
      }
    }

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个智能助手。根据任务执行结果，给用户一个友好的回复。

## 规则
1. 总结执行结果
2. 如果有失败，说明原因和已采取的措施
3. 使用自然语言，像朋友一样交流
4. 不要过于技术化`,
      },
      {
        role: 'user',
        content: `用户请求: ${context.userInput}

执行计划: ${plan.description}
总任务数: ${plan.tasks.length}
成功: ${successCount}
失败: ${failCount}

执行结果:
${state.completedTasks.map(r => 
  `- ${r.taskId}: ${r.success ? '成功' : '失败'} - ${r.message.slice(0, 100)}`
).join('\n')}

${failCount > 0 ? `失败任务:\n${state.failedTasks.join(', ')}` : ''}

请给用户一个回复。`,
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
