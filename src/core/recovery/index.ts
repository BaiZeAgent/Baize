/**
 * 错误恢复管理器 - 自动恢复与降级处理
 *
 * 核心功能：
 * 1. 错误分类（认证/速率限制/网络/超时）
 * 2. Profile轮换（多API Key支持）
 * 3. 指数退避重试
 * 4. 友好错误提示
 *
 * 设计原则：
 * - 尽可能自动恢复，不打断用户
 * - 无法恢复时给出明确提示
 * - 记录错误历史，用于分析
 */

import { getLogger } from '../../observability/logger';

const logger = getLogger('core:recovery');

/**
 * 错误类型
 */
export enum ErrorKind {
  /** 认证错误 */
  AUTH = 'auth',
  /** 速率限制 */
  RATE_LIMIT = 'rate_limit',
  /** 计费错误 */
  BILLING = 'billing',
  /** 上下文溢出 */
  CONTEXT_OVERFLOW = 'context_overflow',
  /** 超时 */
  TIMEOUT = 'timeout',
  /** 网络错误 */
  NETWORK = 'network',
  /** 模型错误 */
  MODEL = 'model',
  /** 工具错误 */
  TOOL = 'tool',
  /** 未知错误 */
  UNKNOWN = 'unknown',
}

/**
 * 错误信息
 */
export interface ErrorInfo {
  /** 错误类型 */
  kind: ErrorKind;
  /** 原始错误 */
  originalError: Error;
  /** 错误消息 */
  message: string;
  /** 是否可恢复 */
  recoverable: boolean;
  /** Provider信息 */
  provider?: string;
  /** Profile ID */
  profileId?: string;
}

/**
 * 恢复策略
 */
export interface RecoveryStrategy {
  /** 策略类型 */
  type: 'retry' | 'rotate_profile' | 'fallback_model' | 'abort';
  /** 延迟（毫秒） */
  delayMs?: number;
  /** 目标Profile ID */
  targetProfileId?: string;
  /** 目标模型 */
  targetModel?: string;
  /** 友好错误消息 */
  friendlyMessage?: string;
}

/**
 * 恢复结果
 */
export interface RecoveryResult {
  /** 是否应该重试 */
  shouldRetry: boolean;
  /** 友好错误消息 */
  friendlyError?: { kind: string; message: string };
  /** 恢复策略 */
  strategy?: RecoveryStrategy;
}

/**
 * Profile状态
 */
export interface ProfileStatus {
  /** Profile ID */
  profileId: string;
  /** 是否在冷却中 */
  inCooldown: boolean;
  /** 冷却结束时间 */
  cooldownUntil?: number;
  /** 失败次数 */
  failureCount: number;
  /** 最后失败原因 */
  lastFailureReason?: ErrorKind;
}

/**
 * 错误恢复配置
 */
export interface ErrorRecoveryConfig {
  /** 是否启用Profile轮换 */
  enableProfileRotation: boolean;
  /** Profile冷却时间（毫秒） */
  profileCooldownMs: number;
  /** 最大重试迭代 */
  maxRetryIterations: number;
  /** 重试延迟（毫秒） */
  retryDelayMs: number;
  /** 指数退避倍数 */
  backoffMultiplier: number;
  /** 最大退避延迟（毫秒） */
  maxBackoffMs: number;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: ErrorRecoveryConfig = {
  enableProfileRotation: true,
  profileCooldownMs: 60000,
  maxRetryIterations: 32,
  retryDelayMs: 1000,
  backoffMultiplier: 2,
  maxBackoffMs: 30000,
};

/**
 * 错误恢复管理器
 */
export class ErrorRecoveryManager {
  private config: ErrorRecoveryConfig;
  private profileStatus: Map<string, ProfileStatus> = new Map();
  private currentProfileIndex: number = 0;
  private profiles: string[] = [];

  constructor(config: Partial<ErrorRecoveryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 设置可用的Profile列表
   */
  setProfiles(profiles: string[]): void {
    this.profiles = profiles;
    logger.debug(`[recovery-profiles] count=${profiles.length}`);
  }

  /**
   * 处理错误
   */
  async handle(params: {
    error: unknown;
    iterations: number;
    currentProfileId?: string;
  }): Promise<RecoveryResult> {
    const { error, iterations, currentProfileId } = params;

    // 1. 分类错误
    const errorInfo = this.classifyError(error);
    logger.debug(`[recovery-classify] kind=${errorInfo.kind} recoverable=${errorInfo.recoverable}`);

    // 2. 检查是否可恢复
    if (!errorInfo.recoverable) {
      return this.buildAbortResult(errorInfo);
    }

    // 3. 检查重试次数
    if (iterations >= this.config.maxRetryIterations) {
      return this.buildRetryLimitResult();
    }

    // 4. 确定恢复策略
    const strategy = this.determineStrategy(errorInfo, currentProfileId);

    if (!strategy) {
      return this.buildAbortResult(errorInfo);
    }

    // 5. 执行恢复策略
    return this.executeStrategy(strategy, errorInfo, currentProfileId);
  }

  /**
   * 分类错误
   */
  private classifyError(error: unknown): ErrorInfo {
    const errorMessage = this.extractErrorMessage(error);
    const lowerMessage = errorMessage.toLowerCase();

    // 认证错误
    if (this.isAuthError(errorMessage)) {
      return {
        kind: ErrorKind.AUTH,
        originalError: error instanceof Error ? error : new Error(errorMessage),
        message: errorMessage,
        recoverable: true,
      };
    }

    // 速率限制
    if (this.isRateLimitError(errorMessage)) {
      return {
        kind: ErrorKind.RATE_LIMIT,
        originalError: error instanceof Error ? error : new Error(errorMessage),
        message: errorMessage,
        recoverable: true,
      };
    }

    // 计费错误
    if (this.isBillingError(errorMessage)) {
      return {
        kind: ErrorKind.BILLING,
        originalError: error instanceof Error ? error : new Error(errorMessage),
        message: errorMessage,
        recoverable: true,
      };
    }

    // 上下文溢出
    if (this.isContextOverflowError(errorMessage)) {
      return {
        kind: ErrorKind.CONTEXT_OVERFLOW,
        originalError: error instanceof Error ? error : new Error(errorMessage),
        message: errorMessage,
        recoverable: true,
      };
    }

    // 超时
    if (this.isTimeoutError(errorMessage)) {
      return {
        kind: ErrorKind.TIMEOUT,
        originalError: error instanceof Error ? error : new Error(errorMessage),
        message: errorMessage,
        recoverable: true,
      };
    }

    // 网络错误
    if (this.isNetworkError(errorMessage)) {
      return {
        kind: ErrorKind.NETWORK,
        originalError: error instanceof Error ? error : new Error(errorMessage),
        message: errorMessage,
        recoverable: true,
      };
    }

    // 未知错误
    return {
      kind: ErrorKind.UNKNOWN,
      originalError: error instanceof Error ? error : new Error(errorMessage),
      message: errorMessage,
      recoverable: false,
    };
  }

  /**
   * 确定恢复策略
   */
  private determineStrategy(
    errorInfo: ErrorInfo,
    currentProfileId?: string
  ): RecoveryStrategy | null {
    switch (errorInfo.kind) {
      case ErrorKind.AUTH:
      case ErrorKind.RATE_LIMIT:
      case ErrorKind.BILLING:
        return this.determineProfileRotationStrategy(currentProfileId);

      case ErrorKind.TIMEOUT:
      case ErrorKind.NETWORK:
        return {
          type: 'retry',
          delayMs: this.config.retryDelayMs,
        };

      case ErrorKind.CONTEXT_OVERFLOW:
        return { type: 'retry' };

      default:
        return null;
    }
  }

  /**
   * 确定Profile轮换策略
   */
  private determineProfileRotationStrategy(currentProfileId?: string): RecoveryStrategy | null {
    if (!this.config.enableProfileRotation || this.profiles.length === 0) {
      return {
        type: 'abort',
        friendlyMessage: '请检查API配置或稍后重试。',
      };
    }

    // 标记当前Profile失败
    if (currentProfileId) {
      this.markProfileFailure(currentProfileId, ErrorKind.AUTH);
    }

    // 找到下一个可用的Profile
    const nextProfile = this.findNextAvailableProfile(currentProfileId);

    if (!nextProfile) {
      return {
        type: 'abort',
        friendlyMessage: '所有API配置暂时不可用，请稍后重试。',
      };
    }

    return {
      type: 'rotate_profile',
      targetProfileId: nextProfile,
      delayMs: this.config.retryDelayMs,
    };
  }

  /**
   * 执行恢复策略
   */
  private async executeStrategy(
    strategy: RecoveryStrategy,
    errorInfo: ErrorInfo,
    currentProfileId?: string
  ): Promise<RecoveryResult> {
    switch (strategy.type) {
      case 'retry':
        return { shouldRetry: true, strategy };

      case 'rotate_profile':
        logger.info(`[recovery-rotate] from=${currentProfileId} to=${strategy.targetProfileId}`);
        return { shouldRetry: true, strategy };

      case 'abort':
      default:
        return this.buildAbortResult(errorInfo, strategy.friendlyMessage);
    }
  }

  /**
   * 找到下一个可用的Profile
   */
  private findNextAvailableProfile(currentProfileId?: string): string | null {
    const currentIndex = currentProfileId 
      ? this.profiles.indexOf(currentProfileId) 
      : -1;

    // 从下一个开始查找
    for (let i = 1; i <= this.profiles.length; i++) {
      const nextIndex = (currentIndex + i) % this.profiles.length;
      const profileId = this.profiles[nextIndex];

      if (!this.isProfileInCooldown(profileId)) {
        return profileId;
      }
    }

    return null;
  }

  /**
   * 检查Profile是否在冷却中
   */
  private isProfileInCooldown(profileId: string): boolean {
    const status = this.profileStatus.get(profileId);
    if (!status || !status.inCooldown) {
      return false;
    }

    if (status.cooldownUntil && Date.now() > status.cooldownUntil) {
      status.inCooldown = false;
      return false;
    }

    return true;
  }

  /**
   * 标记Profile失败
   */
  private markProfileFailure(profileId: string, reason: ErrorKind): void {
    let status = this.profileStatus.get(profileId);

    if (!status) {
      status = {
        profileId,
        inCooldown: false,
        failureCount: 0,
      };
      this.profileStatus.set(profileId, status);
    }

    status.failureCount++;
    status.lastFailureReason = reason;

    // 认证或速率限制错误，进入冷却
    if (reason === ErrorKind.AUTH || reason === ErrorKind.RATE_LIMIT) {
      status.inCooldown = true;
      status.cooldownUntil = Date.now() + this.config.profileCooldownMs;
    }

    logger.debug(`[recovery-failure] profileId=${profileId} reason=${reason} failures=${status.failureCount}`);
  }

  /**
   * 计算退避延迟
   */
  calculateBackoff(iterations: number): number {
    const delay = this.config.retryDelayMs * 
      Math.pow(this.config.backoffMultiplier, iterations);
    return Math.min(delay, this.config.maxBackoffMs);
  }

  /**
   * 提取错误消息
   */
  private extractErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    if (typeof error === 'string') {
      return error;
    }
    return String(error);
  }

  /**
   * 判断是否为认证错误
   */
  private isAuthError(message: string): boolean {
    const patterns = [
      /invalid.*api.*key/i,
      /authentication.*failed/i,
      /unauthorized/i,
      /401/,
      /api.*key.*expired/i,
    ];
    return patterns.some(p => p.test(message));
  }

  /**
   * 判断是否为速率限制错误
   */
  private isRateLimitError(message: string): boolean {
    const patterns = [
      /rate.*limit/i,
      /too.*many.*requests/i,
      /429/,
      /quota.*exceeded/i,
      /requests.*per.*minute/i,
    ];
    return patterns.some(p => p.test(message));
  }

  /**
   * 判断是否为计费错误
   */
  private isBillingError(message: string): boolean {
    const patterns = [
      /billing.*not.*active/i,
      /insufficient.*quota/i,
      /payment.*required/i,
      /credit.*exhausted/i,
    ];
    return patterns.some(p => p.test(message));
  }

  /**
   * 判断是否为上下文溢出错误
   */
  private isContextOverflowError(message: string): boolean {
    const patterns = [
      /context.*length.*exceed/i,
      /token.*limit.*exceed/i,
      /prompt.*too.*long/i,
      /max.*context/i,
    ];
    return patterns.some(p => p.test(message));
  }

  /**
   * 判断是否为超时错误
   */
  private isTimeoutError(message: string): boolean {
    const patterns = [
      /timeout/i,
      /timed.*out/i,
      /request.*timeout/i,
    ];
    return patterns.some(p => p.test(message));
  }

  /**
   * 判断是否为网络错误
   */
  private isNetworkError(message: string): boolean {
    const patterns = [
      /network.*error/i,
      /connection.*refused/i,
      /econnreset/i,
      /enotfound/i,
      /socket.*hang.*up/i,
    ];
    return patterns.some(p => p.test(message));
  }

  /**
   * 构建中止结果
   */
  private buildAbortResult(
    errorInfo: ErrorInfo,
    customMessage?: string
  ): RecoveryResult {
    return {
      shouldRetry: false,
      friendlyError: {
        kind: errorInfo.kind,
        message: customMessage || this.getFriendlyMessage(errorInfo),
      },
    };
  }

  /**
   * 构建重试限制结果
   */
  private buildRetryLimitResult(): RecoveryResult {
    return {
      shouldRetry: false,
      friendlyError: {
        kind: 'retry_limit',
        message: '请求多次重试后仍失败，请稍后再试。',
      },
    };
  }

  /**
   * 获取友好错误消息
   */
  private getFriendlyMessage(errorInfo: ErrorInfo): string {
    const messages: Record<ErrorKind, string> = {
      [ErrorKind.AUTH]: '认证失败，请检查API配置。',
      [ErrorKind.RATE_LIMIT]: '请求过于频繁，请稍后再试。',
      [ErrorKind.BILLING]: '账户余额不足，请检查账户状态。',
      [ErrorKind.CONTEXT_OVERFLOW]: '对话内容过长，建议开始新会话。',
      [ErrorKind.TIMEOUT]: '请求超时，请稍后再试。',
      [ErrorKind.NETWORK]: '网络连接失败，请检查网络。',
      [ErrorKind.MODEL]: '模型服务异常，请稍后再试。',
      [ErrorKind.TOOL]: '工具执行失败。',
      [ErrorKind.UNKNOWN]: '发生未知错误。',
    };

    return messages[errorInfo.kind] || errorInfo.message;
  }

  /**
   * 清除所有Profile状态
   */
  clearAllProfiles(): void {
    this.profileStatus.clear();
    logger.debug('[recovery-clear] 所有Profile状态已清除');
  }
}

// 全局实例
let recoveryManagerInstance: ErrorRecoveryManager | null = null;

/**
 * 获取错误恢复管理器实例
 */
export function getRecoveryManager(): ErrorRecoveryManager {
  if (!recoveryManagerInstance) {
    recoveryManagerInstance = new ErrorRecoveryManager();
  }
  return recoveryManagerInstance;
}

/**
 * 重置错误恢复管理器实例（测试用）
 */
export function resetRecoveryManager(): void {
  recoveryManagerInstance = null;
}
