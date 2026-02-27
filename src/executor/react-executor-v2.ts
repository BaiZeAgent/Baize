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

const BASE_RUN_LOOP_ITERATIONS = 24;
const MAX_RUN_LOOP_ITERATIONS = 160;
const MIN_RUN_LOOP_ITERATIONS = 32;
const ITERATIONS_PER_ERROR_TYPE = 8;
const MAX_OVERFLOW_COMPACTION_ATTEMPTS = 3;
const CONTEXT_WINDOW_WARN_TOKENS = 8000;
const CONTEXT_WINDOW_HARD_MIN_TOKENS = 1000;

/**
 * 动态计算最大迭代次数
 * 参考 OpenClaw 的 resolveMaxRunRetryIterations
 */
function resolveMaxIterations(errorTypeCount: number = 1): number {
  const scaled = BASE_RUN_LOOP_ITERATIONS + Math.max(1, errorTypeCount) * ITERATIONS_PER_ERROR_TYPE;
  return Math.min(MAX_RUN_LOOP_ITERATIONS, Math.max(MIN_RUN_LOOP_ITERATIONS, scaled));
}

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
  lastToolError?: { toolName: string; error: string; params?: Record<string, unknown> };
  /** 已遇到的错误类型集合 */
  errorTypes: Set<string>;
  /** 参数验证失败次数 */
  paramValidationFailures: number;
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
  /** 参数验证失败后的自动修正次数 */
  private static readonly MAX_PARAM_CORRECTION_ATTEMPTS = 3;

  constructor(maxIterations?: number) {
    // 默认使用动态计算，也支持手动指定
    this.maxIterations = maxIterations ?? resolveMaxIterations(1);
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
      errorTypes: new Set(),
      paramValidationFailures: 0,
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
            
            // 先尝试截断长工具结果
            this.truncateToolResults(state);
            
            // 压缩上下文
            const compacted = await this.compactContext(state, context);
            if (compacted) {
              state.contextTokens = this.estimateTokens(state.currentOutput);
              logger.info('上下文压缩成功', { newTokens: state.contextTokens });
            }
          }
          
          // 如果压缩后仍然过大，强制截断
          if (state.contextTokens > CONTEXT_WINDOW_WARN_TOKENS * 1.5) {
            logger.warn('上下文仍然过大，强制截断');
            // 保留最近的输出
            const recentOutputs = state.executedTasks.slice(-3).map(t => t.message || '').join('\n');
            state.currentOutput = recentOutputs.substring(0, CONTEXT_WINDOW_WARN_TOKENS * 2);
            state.contextTokens = this.estimateTokens(state.currentOutput);
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

    // 执行任务（带参数自动修正）
    const taskResult = await this.executeTaskWithCorrection(taskInfo, context);
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
   * 执行任务（带参数自动修正）
   * 
   * v3.2.1 优化：增加对"未知操作"错误的支持
   */
  private async executeTaskWithCorrection(
    taskInfo: { skillName: string; params: Record<string, unknown>; description: string },
    context: ReActContextV2
  ): Promise<TaskResult> {
    let currentParams = { ...taskInfo.params };
    let correctionAttempts = 0;

    while (correctionAttempts < ReActExecutorV2.MAX_PARAM_CORRECTION_ATTEMPTS) {
      const result = await this.executeTask({ ...taskInfo, params: currentParams }, context);

      if (result.success) {
        return result;
      }

      // 检查是否是参数验证错误
      const errorMsg = result.error || '';
      const isParamError = errorMsg.includes('参数值错误') || 
                          errorMsg.includes('缺少必填参数') ||
                          errorMsg.includes('未知操作');
      
      if (isParamError) {
        correctionAttempts++;
        
        // 增强错误消息（如果是"未知操作"错误）
        const enhancedError = this.enhanceParamError(taskInfo.skillName, currentParams, errorMsg);
        
        // 尝试自动修正参数
        const correctedParams = this.tryCorrectParamsSync(
          taskInfo.skillName,
          currentParams,
          enhancedError
        );
        
        if (correctedParams) {
          logger.info('参数自动修正', {
            skillName: taskInfo.skillName,
            originalParams: currentParams,
            correctedParams,
            attempt: correctionAttempts,
          });
          currentParams = correctedParams;
          continue;
        }
      }

      // 无法修正或不是参数错误，直接返回
      return result;
    }

    // 超过最大修正次数
    return {
      taskId: `task_${Date.now()}`,
      success: false,
      data: {},
      message: '执行失败',
      error: `参数自动修正失败，已尝试 ${correctionAttempts} 次`,
      duration: 0,
    };
  }

  /**
   * 同步版本的参数修正方法
   * 
   * v3.2.1 优化：支持多种错误消息格式
   */
  private tryCorrectParamsSync(
    skillName: string,
    params: Record<string, unknown>,
    errorMsg: string
  ): Record<string, unknown> | null {
    const skill = this.skillRegistry.get(skillName);
    if (!skill) {
      return null;
    }

    const schema = skill.inputSchema as {
      properties?: Record<string, { enum?: string[]; type?: string; description?: string }>;
    };

    if (!schema?.properties) {
      return null;
    }

    const correctedParams = { ...params };
    let hasCorrection = false;

    // 1. 尝试从错误消息解析参数名和可选值
    // 格式1: [可选值: xxx, yyy]
    const enumMatch = errorMsg.match(/\[可选值:\s*([^\]]+)\]/);
    // 格式2: action 可选值: xxx, yyy 或 xxx可选值: xxx, yyy
    const actionMatch = errorMsg.match(/(\w+)\s*可选值:\s*([^\n]+)/i);
    // 格式3: 参数值错误: xxx
    const paramMatch = errorMsg.match(/参数值错误:\s*(\w+)/);
    
    // 如果找到了可选值信息
    if (enumMatch || actionMatch) {
      let validOptions: string[] = [];
      let paramName = '';
      
      if (enumMatch && paramMatch) {
        validOptions = enumMatch[1].split(',').map(s => s.trim()).filter(s => s);
        paramName = paramMatch[1];
      } else if (actionMatch) {
        paramName = actionMatch[1];
        validOptions = actionMatch[2].split(',').map(s => s.trim()).filter(s => s);
      }
      
      if (validOptions.length > 0 && paramName) {
        correctedParams[paramName] = validOptions[0];
        hasCorrection = true;
        logger.info('自动修正参数', { paramName, oldValue: params[paramName], newValue: validOptions[0] });
      }
    }

    // 2. 如果无法从错误消息解析，尝试从 schema 获取
    if (!hasCorrection) {
      for (const [paramName, prop] of Object.entries(schema.properties)) {
        if (prop.enum && params[paramName] !== undefined) {
          const currentValue = String(params[paramName]);
          if (!prop.enum.includes(currentValue)) {
            correctedParams[paramName] = prop.enum[0];
            hasCorrection = true;
            logger.info('从schema自动修正参数', { paramName, oldValue: currentValue, newValue: prop.enum[0] });
            break;
          }
        }
      }
    }

    return hasCorrection ? correctedParams : null;
  }

  /**
   * 尝试自动修正参数
   * 
   * v3.2.1 优化：支持多种错误格式，增强自动修正能力
   */
  private async tryCorrectParams(
    skillName: string,
    params: Record<string, unknown>,
    errorMsg: string,
    context: ReActContextV2
  ): Promise<Record<string, unknown> | null> {
    const skill = this.skillRegistry.get(skillName);
    if (!skill) {
      return null;
    }

    const schema = skill.inputSchema as {
      properties?: Record<string, { enum?: string[]; type?: string; description?: string }>;
    };

    if (!schema?.properties) {
      return null;
    }

    const correctedParams = { ...params };
    let hasCorrection = false;

    // 1. 尝试从错误消息解析参数名和可选值
    // 格式1: [可选值: xxx, yyy]
    const enumMatch = errorMsg.match(/\[可选值:\s*([^\]]+)\]/);
    // 格式2: action 可选值: xxx, yyy
    const actionMatch = errorMsg.match(/action\s*可选值:\s*([^\n]+)/i);
    // 格式3: 参数值错误: xxx
    const paramMatch = errorMsg.match(/参数值错误:\s*(\w+)/);
    
    if ((enumMatch || actionMatch) && paramMatch) {
      const validOptionsStr = enumMatch ? enumMatch[1] : (actionMatch ? actionMatch[1] : '');
      const validOptions = validOptionsStr.split(',').map(s => s.trim()).filter(s => s);
      const paramName = paramMatch[1];
      
      if (validOptions.length > 0) {
        // 使用第一个有效选项
        correctedParams[paramName] = validOptions[0];
        hasCorrection = true;
        logger.info('自动修正参数', { paramName, oldValue: params[paramName], newValue: validOptions[0] });
      }
    }

    // 2. 如果无法从错误消息解析，尝试从 schema 获取
    if (!hasCorrection) {
      for (const [paramName, prop] of Object.entries(schema.properties)) {
        if (prop.enum && params[paramName] !== undefined) {
          const currentValue = String(params[paramName]);
          if (!prop.enum.includes(currentValue)) {
            // 使用第一个有效选项
            correctedParams[paramName] = prop.enum[0];
            hasCorrection = true;
            logger.info('从schema自动修正参数', { paramName, oldValue: currentValue, newValue: prop.enum[0] });
            break;
          }
        }
      }
    }

    return hasCorrection ? correctedParams : null;
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
        const availableSkills = this.skillRegistry.getAll().map(s => s.name).join(', ');
        throw new Error(`技能不存在: ${taskInfo.skillName}。可用技能: ${availableSkills}`);
      }

      // 验证参数
      const validation = await skill.validateParams(taskInfo.params);
      if (!validation.valid) {
        // 增强错误消息，包含技能的详细参数信息
        const detailedError = this.enhanceParamError(skill.name, taskInfo.params, validation.error || '参数验证失败');
        throw new Error(detailedError);
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
   * 增强参数错误消息
   * 
   * v3.2.1 优化：处理"未知操作"错误，添加可选值提示
   */
  private enhanceParamError(
    skillName: string,
    params: Record<string, unknown>,
    originalError: string
  ): string {
    const skill = this.skillRegistry.get(skillName);
    if (!skill) {
      return originalError;
    }

    const schema = skill.inputSchema as {
      required?: string[];
      properties?: Record<string, {
        type?: string;
        enum?: string[];
        description?: string;
      }>;
    };

    let enhanced = originalError;

    // 检查是否是"未知操作"类型的错误
    const unknownOpMatch = originalError.match(/未知操作:\s*(\w+)/i);
    if (unknownOpMatch && schema?.properties?.action?.enum) {
      // 直接添加可选值，格式化以便自动修正
      enhanced = `参数值错误: action。当前值 "${unknownOpMatch[1]}" 不在允许的选项中。action 可选值: ${schema.properties.action.enum.join(', ')}`;
      return enhanced;
    }

    if (schema?.properties) {
      // 添加可用参数选项
      for (const [paramName, prop] of Object.entries(schema.properties)) {
        if (prop.enum && params[paramName] !== undefined) {
          const currentValue = String(params[paramName]);
          if (!prop.enum.includes(currentValue)) {
            enhanced += ` [可选值: ${prop.enum.join(', ')}]`;
          }
        }
      }
    }

    return enhanced;
  }

  /**
   * 获取 LLM 决策 - OpenClaw 风格
   * 
   * v3.2.1 优化：增强错误反馈，提供更详细的参数修正建议
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

    // 构建技能详细信息（特别是在有错误时）
    let errorGuidance = '';
    if (state.lastToolError && state.lastToolError.toolName) {
      const detailedInfo = this.skillRegistry.getSkillDetailedInfo(state.lastToolError.toolName);
      
      // 解析错误信息，提供更具体的修正建议
      let specificGuidance = '';
      const errorMsg = state.lastToolError.error || '';
      
      // 检测参数值错误
      const enumMatch = errorMsg.match(/\[可选值:\s*([^\]]+)\]/);
      const paramMatch = errorMsg.match(/参数值错误:\s*(\w+)/);
      
      if (enumMatch && paramMatch) {
        const validOptions = enumMatch[1];
        const paramName = paramMatch[1];
        specificGuidance = `\n
**重要修正指导**：
- 错误的参数: ${paramName}
- 正确的可选值: ${validOptions}
- 请在下次执行时使用上述正确的参数值`;
      }
      
      errorGuidance = `\n
## ⚠️ 错误分析

**失败的技能**: ${state.lastToolError.toolName}
**错误信息**: ${state.lastToolError.error}

## 技能参数说明
${detailedInfo}
${specificGuidance}

**请仔细阅读上述信息，在下次执行时使用正确的参数值！**`;
    }

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
${errorGuidance}
## 决策选项

1. **execute**: 执行下一个任务
   - 当有待执行任务且没有严重错误时
   - 必须提供 task 对象
   - **如果有参数错误，必须使用正确的参数值**

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
  "thinking": "你的思考过程（分析错误原因，说明如何修正）",
  "task": { "skillName": "xxx", "params": { "action": "正确的值", ... }, "description": "xxx" },
  "adjustment": "调整说明",
  "message": "完成消息",
  "reason": "中止原因"
}

## 关键规则

1. **参数必须精确匹配**：如果之前的错误是参数值错误，必须使用技能定义中列出的可选值
2. 如果有待执行任务且没有错误，优先执行
3. 如果有错误但可以恢复，使用正确的参数重新执行
4. 如果用户需求已满足，选择 complete
5. 如果错误无法恢复，选择 abort
6. 每次只做一个决策
7. 先思考再决策`,
      },
      {
        role: 'user',
        content: `用户需求: ${userIntent || '未知'}

请根据当前状态做出决策。如果有参数错误，请使用正确的参数值重新执行。`,
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
   * 截断过长的工具结果
   * 参考 OpenClaw 的 truncateOversizedToolResultsInSession
   */
  private truncateToolResults(state: ExecutionState, maxTokens: number = CONTEXT_WINDOW_WARN_TOKENS): void {
    for (const task of state.executedTasks) {
      if (task.message && this.estimateTokens(task.message) > 2000) {
        // 截断长消息，保留前后部分
        const message = task.message;
        const halfTokens = 1000;
        const prefixEnd = this.findTruncationPoint(message, halfTokens);
        const suffixStart = this.findTruncationPoint(message, halfTokens, true);
        
        task.message = message.substring(0, prefixEnd) +
          `\n... [已截断，原始长度: ${message.length} 字符] ...\n` +
          message.substring(suffixStart);
        
        logger.info('工具结果已截断', { 
          taskId: task.taskId,
          originalLength: message.length,
          truncatedLength: task.message.length,
        });
      }
    }
  }

  /**
   * 找到截断点（避免在单词中间截断）
   */
  private findTruncationPoint(text: string, targetTokens: number, fromEnd: boolean = false): number {
    const estimatedChars = targetTokens * 2; // 粗略估计
    const whitespaceRegex = /\s/;
    
    if (fromEnd) {
      const startPos = Math.max(0, text.length - estimatedChars);
      // 找到下一个空白字符
      for (let i = startPos; i < text.length; i++) {
        if (whitespaceRegex.test(text[i])) {
          return i;
        }
      }
      return startPos;
    } else {
      // 找到前一个空白字符
      for (let i = estimatedChars; i >= 0; i--) {
        if (whitespaceRegex.test(text[i])) {
          return i;
        }
      }
      return estimatedChars;
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
