/**
 * 重试机制
 * 
 * 第五章 5.3 错误恢复
 * 
 * 功能：
 * 1. 指数退避重试
 * 2. 重试策略配置
 */

import { getLogger } from '../observability/logger';
import { Task, TaskResult, SkillContext } from '../types';

const logger = getLogger('executor:retry');

/**
 * 重试策略
 */
export interface RetryPolicy {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryableErrors: string[];
}

/**
 * 默认重试策略
 */
const DEFAULT_POLICY: RetryPolicy = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  retryableErrors: ['timeout', 'network', 'temporary', 'rate limit'],
};

/**
 * 重试执行器
 */
export class RetryExecutor {
  private policy: RetryPolicy;

  constructor(policy: Partial<RetryPolicy> = {}) {
    this.policy = { ...DEFAULT_POLICY, ...policy };
  }

  /**
   * 带重试的执行
   */
  async execute(
    task: Task,
    executor: (task: Task) => Promise<TaskResult>,
    context?: SkillContext
  ): Promise<TaskResult> {
    let lastResult: TaskResult | null = null;
    let delay = this.policy.initialDelay;

    for (let attempt = 0; attempt <= this.policy.maxRetries; attempt++) {
      const result = await executor(task);

      if (result.success) {
        if (attempt > 0) {
          logger.info('重试成功', { taskId: task.id, attempts: attempt + 1 });
        }
        return result;
      }

      lastResult = result;

      // 检查是否可重试
      if (!this.isRetryable(result.error || '')) {
        logger.debug('错误不可重试', { taskId: task.id, error: result.error });
        break;
      }

      // 还有重试机会
      if (attempt < this.policy.maxRetries) {
        logger.warn('任务失败，准备重试', {
          taskId: task.id,
          attempt: attempt + 1,
          maxRetries: this.policy.maxRetries,
          delay,
          error: result.error,
        });

        await this.sleep(delay);
        delay = Math.min(delay * this.policy.backoffMultiplier, this.policy.maxDelay);
      }
    }

    logger.error('重试耗尽', {
      taskId: task.id,
      attempts: this.policy.maxRetries + 1,
      lastError: lastResult?.error,
    });

    return lastResult || {
      taskId: task.id,
      success: false,
      error: '重试失败',
      duration: 0, data: {}, message: "",
    };
  }

  /**
   * 检查错误是否可重试
   */
  private isRetryable(error: string): boolean {
    const lowerError = error.toLowerCase();
    return this.policy.retryableErrors.some(e => lowerError.includes(e));
  }

  /**
   * 延迟
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 全局实例
let retryExecutor: RetryExecutor | null = null;

export function getRetryExecutor(policy?: Partial<RetryPolicy>): RetryExecutor {
  if (!retryExecutor) {
    retryExecutor = new RetryExecutor(policy);
  }
  return retryExecutor;
}
