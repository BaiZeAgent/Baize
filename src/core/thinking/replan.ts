/**
 * 重规划机制
 * 
 * 第三章 3.2 动态重规划机制
 * 
 * 功能：
 * 1. 检测是否需要重规划
 * 2. 执行重规划
 */

import { getLogger } from '../../observability/logger';
import { Validation, Understanding, Decomposition } from '../../types';

const logger = getLogger('thinking:replan');

/**
 * 重规划管理器
 */
export class ReplanManager {
  private consecutiveFailures: number = 0;
  private maxConsecutiveFailures: number = 2;

  /**
   * 检查是否需要重规划
   */
  needsReplanning(validation: Validation): boolean {
    // 连续失败超过阈值
    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
      logger.info('触发重规划: 连续失败', { count: this.consecutiveFailures });
      return true;
    }

    // 问题过多
    if (validation.issues && validation.issues.length > 3) {
      logger.info('触发重规划: 问题过多', { issues: validation.issues.length });
      return true;
    }

    return false;
  }

  /**
   * 记录失败
   */
  recordFailure(): void {
    this.consecutiveFailures++;
    logger.debug('记录失败', { consecutiveFailures: this.consecutiveFailures });
  }

  /**
   * 重置失败计数
   */
  resetFailures(): void {
    this.consecutiveFailures = 0;
    logger.debug('重置失败计数');
  }

  /**
   * 获取连续失败次数
   */
  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  /**
   * 生成重规划提示
   */
  generateReplanPrompt(
    originalUnderstanding: Understanding,
    validation: Validation
  ): string {
    return `${originalUnderstanding.coreNeed}

注意: 之前的尝试失败了。
失败原因: ${validation.issues?.join(', ') || '未知'}
请重新分析并制定新的执行计划。`;
  }
}

// 全局实例
let replanManager: ReplanManager | null = null;

export function getReplanManager(): ReplanManager {
  if (!replanManager) {
    replanManager = new ReplanManager();
  }
  return replanManager;
}
