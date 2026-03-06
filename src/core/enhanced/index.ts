/**
 * 白泽增强模块 - 核心入口
 * 
 * 整合四大核心模块：
 * 1. 元认知层 - 能力评估、边界检测、自我反思
 * 2. 思考层 - 任务分解、推理引擎、规划生成
 * 3. 执行层 - 增强ReAct、智能重试、结果验证
 * 4. 恢复层 - 根因分析、策略生成、经验学习
 */

import { RiskLevel } from '../../types';

// 导出类型
export type { 
  CapabilityAssessment, 
  ComplexityAnalysis, 
  SelfReflection, 
  CapabilityBoundary 
} from './metacognition';

export type { 
  SubTask, 
  ExecutionPlan, 
  ReasoningResult, 
  ReasoningStep, 
  DecompositionResult 
} from './thinking';

export type { 
  ExecutionContext, 
  ExecutionHooks, 
  TaskResult, 
  ExecutionResult, 
  ExecutionProgress 
} from './execution';

export type { 
  ErrorRootCause, 
  ErrorType, 
  ErrorCategory, 
  RecoveryStrategy, 
  StrategyType, 
  RecoveryResult, 
  RecoveryExperience 
} from './recovery';

// 导出模块
export { MetacognitionEngine, getMetacognition, resetMetacognition } from './metacognition';
export { ThinkingEngine, getThinkingEngine, resetThinkingEngine } from './thinking';
export { EnhancedExecutor, getEnhancedExecutor, resetEnhancedExecutor } from './execution';
export { RecoveryEngine, getRecoveryEngine, resetRecoveryEngine } from './recovery';

// 导出统一入口
import { MetacognitionEngine, getMetacognition } from './metacognition';
import { ThinkingEngine, getThinkingEngine } from './thinking';
import { EnhancedExecutor, getEnhancedExecutor } from './execution';
import { RecoveryEngine, getRecoveryEngine } from './recovery';
import { getLogger } from '../../observability/logger';

const logger = getLogger('core:enhanced');

/**
 * 增强版白泽核心
 * 
 * 使用方法：
 * ```typescript
 * import { EnhancedBaizeCore } from './enhanced';
 * 
 * const core = new EnhancedBaizeCore();
 * const result = await core.process('帮我分析这个数据文件');
 * ```
 */
export class EnhancedBaizeCore {
  private metacognition: MetacognitionEngine;
  private thinking: ThinkingEngine;
  private executor: EnhancedExecutor;
  private recovery: RecoveryEngine;

  constructor() {
    this.metacognition = getMetacognition();
    this.thinking = getThinkingEngine();
    this.executor = getEnhancedExecutor();
    this.recovery = getRecoveryEngine();
  }

  /**
   * 处理用户输入
   */
  async process(
    userInput: string,
    context?: {
      sessionId?: string;
      userId?: string;
      workspaceDir?: string;
      history?: Array<{ role: string; content: string }>;
    }
  ): Promise<import('./execution').ExecutionResult> {
    const startTime = Date.now();
    
    // 1. 思考和规划（包含能力评估）
    logger.info(`[增强核心] 开始思考: ${userInput.slice(0, 50)}...`);
    const plan = await this.thinking.think(userInput);

    // 2. 执行（传递计划，避免重复评估）
    logger.info(`[增强核心] 开始执行计划: ${plan.id}, 任务数: ${plan.tasks.length}`);
    const result = await this.executor.execute(userInput, {
      sessionId: context?.sessionId || 'default',
      userId: context?.userId,
      workspaceDir: context?.workspaceDir || process.cwd(),
      userInput,
      history: context?.history,
    }, plan);  // 传递计划

    return result;
  }

  /**
   * 快速评估（不执行）
   */
  async assess(userInput: string) {
    return this.metacognition.assessCapability(userInput);
  }

  /**
   * 获取能力边界
   */
  async getCapabilities() {
    return this.metacognition.getCapabilityBoundary();
  }
}

// 全局实例
let enhancedCoreInstance: EnhancedBaizeCore | null = null;

export function getEnhancedCore(): EnhancedBaizeCore {
  if (!enhancedCoreInstance) {
    enhancedCoreInstance = new EnhancedBaizeCore();
  }
  return enhancedCoreInstance;
}

export function resetEnhancedCore(): void {
  enhancedCoreInstance = null;
}
