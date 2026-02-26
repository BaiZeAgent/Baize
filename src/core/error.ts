/**
 * 错误处理系统
 */
import { BaizeError, ErrorCategory, ErrorSeverity } from '../types';
import { getMemory } from '../memory';
import { getLogger } from '../observability/logger';

const logger = getLogger('error');

export class ErrorHandler {
  private memory = getMemory();

  async handle(error: Error | BaizeError): Promise<void> {
    const baizeError = this.normalizeError(error);
    logger.error(`错误发生: ${baizeError.message}`, {
      category: baizeError.category,
      severity: baizeError.severity,
    });
    this.memory.recordEpisode('error', JSON.stringify({
      category: baizeError.category,
      severity: baizeError.severity,
      message: baizeError.message,
      detail: baizeError.detail,
    }));
    switch (baizeError.category) {
      case ErrorCategory.USER_INPUT:
        await this.handleUserInputError(baizeError);
        break;
      case ErrorCategory.SKILL_ERROR:
        await this.handleSkillError(baizeError);
        break;
      case ErrorCategory.LLM_ERROR:
        await this.handleLLMError(baizeError);
        break;
      case ErrorCategory.NETWORK_ERROR:
        await this.handleNetworkError(baizeError);
        break;
      default:
        await this.handleUnknownError(baizeError);
    }
  }

  getRecoveryStrategy(error: BaizeError): string[] {
    const strategies: string[] = [];
    switch (error.category) {
      case ErrorCategory.NETWORK_ERROR:
        strategies.push('retry', 'use_cache', 'offline_mode');
        break;
      case ErrorCategory.SKILL_ERROR:
        strategies.push('retry', 'fallback_skill', 'ask_user');
        break;
      case ErrorCategory.SKILL_TIMEOUT:
        strategies.push('retry', 'increase_timeout', 'simplify_task');
        break;
      case ErrorCategory.LLM_ERROR:
        strategies.push('retry', 'fallback_model', 'rule_based');
        break;
      case ErrorCategory.USER_INPUT:
        strategies.push('ask_user', 'use_default');
        break;
      default:
        strategies.push('retry', 'ask_user');
    }
    const historicalSolution = this.memory.getErrorRecovery(error.category);
    if (historicalSolution) strategies.unshift(historicalSolution);
    return strategies;
  }

  private normalizeError(error: Error | BaizeError): BaizeError {
    if ('category' in error) return error;
    let category = ErrorCategory.UNKNOWN;
    if (error.message.includes('network') || error.message.includes('timeout')) {
      category = ErrorCategory.NETWORK_ERROR;
    } else if (error.message.includes('skill')) {
      category = ErrorCategory.SKILL_ERROR;
    } else if (error.message.includes('LLM') || error.message.includes('API')) {
      category = ErrorCategory.LLM_ERROR;
    } else if (error.message.includes('user')) {
      category = ErrorCategory.USER_INPUT;
    }
    return {
      category,
      severity: ErrorSeverity.MEDIUM,
      message: error.message,
      detail: error.stack || '',
      recoverable: true,
      recoveryOptions: this.getRecoveryStrategy({ 
        category, 
        severity: ErrorSeverity.MEDIUM, 
        message: error.message, 
        detail: error.stack || '', 
        recoverable: true, 
        recoveryOptions: [] 
      } as BaizeError),
    };
  }

  private async handleUserInputError(error: BaizeError): Promise<void> {
    logger.info('用户输入错误，需要用户重新输入');
  }

  private async handleSkillError(error: BaizeError): Promise<void> {
    logger.info('技能执行错误，尝试恢复');
    if (error.recoverable) {
      this.memory.learnErrorRecovery(ErrorCategory.SKILL_ERROR, error.recoveryOptions[0] || 'retry');
    }
  }

  private async handleLLMError(error: BaizeError): Promise<void> {
    logger.info('LLM调用错误，尝试降级');
  }

  private async handleNetworkError(error: BaizeError): Promise<void> {
    logger.info('网络错误，尝试重试');
  }

  private async handleUnknownError(error: BaizeError): Promise<void> {
    logger.error('未知错误，需要人工介入');
  }
}

export class DegradationManager {
  private currentLevel = 0;
  private thresholds = { errorRate: 0.5, latencyMs: 5000, queueSize: 100 };

  assess(metrics: { errorRate: number; latencyMs: number; queueSize: number }): number {
    let level = 0;
    if (metrics.errorRate > this.thresholds.errorRate * 2) level = 4;
    else if (metrics.errorRate > this.thresholds.errorRate) level = 3;
    else if (metrics.latencyMs > this.thresholds.latencyMs * 2) level = 2;
    else if (metrics.latencyMs > this.thresholds.latencyMs) level = 1;
    if (level !== this.currentLevel) {
      logger.warn(`降级等级变更: ${this.currentLevel} -> ${level}`);
      this.currentLevel = level;
    }
    return level;
  }

  getCurrentLevel(): number { return this.currentLevel; }

  getStrategy(level: number): Record<string, unknown> {
    switch (level) {
      case 0: return { mode: 'normal' };
      case 1: return { mode: 'minimal', disableFeatures: ['proactive', 'evolution'] };
      case 2: return { mode: 'moderate', disableFeatures: ['proactive', 'evolution', 'parallel'], useCache: true };
      case 3: return { mode: 'severe', disableFeatures: ['proactive', 'evolution', 'parallel', 'complex_tasks'], useCache: true };
      case 4: return { mode: 'emergency', readOnly: true, disableFeatures: ['all'] };
      default: return { mode: 'normal' };
    }
  }
}

let errorHandler: ErrorHandler | null = null;
let degradationManager: DegradationManager | null = null;

export function getErrorHandler(): ErrorHandler {
  if (!errorHandler) errorHandler = new ErrorHandler();
  return errorHandler;
}

export function getDegradationManager(): DegradationManager {
  if (!degradationManager) degradationManager = new DegradationManager();
  return degradationManager;
}
