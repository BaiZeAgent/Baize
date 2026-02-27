/**
 * 错误恢复系统 - 多层 Failover 与自动重试
 * 
 * 提供企业级错误处理：
 * 1. 错误分类
 * 2. 认证 Profile 轮换
 * 3. 智能重试策略
 * 4. 上下文溢出恢复
 */

import { getLogger } from '../observability/logger';

const logger = getLogger('recovery');

// ═══════════════════════════════════════════════════════════════
// 错误分类
// ═══════════════════════════════════════════════════════════════

/**
 * 错误类别
 */
export type ErrorCategory = 
  | 'auth'           // 认证错误
  | 'rate_limit'     // 速率限制
  | 'billing'        // 计费错误
  | 'context_overflow' // 上下文溢出
  | 'timeout'        // 超时
  | 'network'        // 网络错误
  | 'model_error'    // 模型错误
  | 'tool_error'     // 工具错误
  | 'unknown';       // 未知错误

/**
 * 错误严重程度
 */
export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical';

/**
 * 分类后的错误
 */
export interface ClassifiedError {
  category: ErrorCategory;
  severity: ErrorSeverity;
  retryable: boolean;
  retryAfter?: number;
  profileSwitch?: boolean;
  modelSwitch?: boolean;
  compactSession?: boolean;
  message: string;
}

/**
 * 错误分类器
 */
export class ErrorClassifier {
  private patterns: Array<{
    pattern: RegExp;
    category: ErrorCategory;
    severity: ErrorSeverity;
    retryAfter?: number;
  }> = [
    // 认证错误
    { pattern: /401|unauthorized|invalid.*api.*key/i, category: 'auth', severity: 'high' },
    { pattern: /invalid.*token|token.*expired/i, category: 'auth', severity: 'high' },
    
    // 速率限制
    { pattern: /429|rate.*limit|too.*many.*requests/i, category: 'rate_limit', severity: 'medium', retryAfter: 60000 },
    
    // 计费错误
    { pattern: /billing|insufficient.*quota|payment.*required/i, category: 'billing', severity: 'critical' },
    
    // 上下文溢出
    { pattern: /context.*overflow|token.*limit|too.*long/i, category: 'context_overflow', severity: 'high' },
    
    // 超时
    { pattern: /timeout|timed.*out/i, category: 'timeout', severity: 'medium', retryAfter: 5000 },
    
    // 网络错误
    { pattern: /network|connection|econnrefused/i, category: 'network', severity: 'medium', retryAfter: 3000 },
    
    // 模型错误
    { pattern: /model.*not.*found|model.*overloaded|500|502|503/i, category: 'model_error', severity: 'medium', retryAfter: 10000 },
  ];
  
  classify(error: Error): ClassifiedError {
    const message = error.message;
    
    for (const { pattern, category, severity, retryAfter } of this.patterns) {
      if (pattern.test(message)) {
        return this.createResult(category, severity, message, retryAfter);
      }
    }
    
    return this.createResult('unknown', 'medium', message);
  }
  
  private createResult(
    category: ErrorCategory,
    severity: ErrorSeverity,
    message: string,
    retryAfter?: number
  ): ClassifiedError {
    return {
      category,
      severity,
      retryable: ['rate_limit', 'timeout', 'network', 'model_error'].includes(category),
      retryAfter,
      profileSwitch: ['auth', 'rate_limit', 'billing'].includes(category),
      modelSwitch: ['model_error', 'rate_limit'].includes(category),
      compactSession: category === 'context_overflow',
      message,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// 认证 Profile 管理
// ═══════════════════════════════════════════════════════════════

export interface AuthProfile {
  id: string;
  provider: string;
  priority: number;
  cooldownUntil?: number;
  failureCount: number;
  successCount: number;
}

export class AuthProfileManager {
  private profiles: Map<string, AuthProfile> = new Map();
  private currentIndex = 0;
  private profileOrder: string[] = [];
  
  addProfile(profile: AuthProfile): void {
    this.profiles.set(profile.id, profile);
    this.updateOrder();
  }
  
  getCurrentProfile(): AuthProfile | null {
    const startIndex = this.currentIndex;
    
    do {
      const profileId = this.profileOrder[this.currentIndex];
      const profile = this.profiles.get(profileId);
      
      if (profile && (!profile.cooldownUntil || Date.now() > profile.cooldownUntil)) {
        return profile;
      }
      
      this.currentIndex = (this.currentIndex + 1) % this.profileOrder.length;
    } while (this.currentIndex !== startIndex);
    
    return null;
  }
  
  advanceProfile(): AuthProfile | null {
    this.currentIndex = (this.currentIndex + 1) % this.profileOrder.length;
    return this.getCurrentProfile();
  }
  
  markFailure(id: string, cooldownMs?: number): void {
    const profile = this.profiles.get(id);
    if (profile) {
      profile.failureCount++;
      if (cooldownMs) {
        profile.cooldownUntil = Date.now() + cooldownMs;
      }
    }
  }
  
  markSuccess(id: string): void {
    const profile = this.profiles.get(id);
    if (profile) {
      profile.successCount++;
      profile.failureCount = 0;
      profile.cooldownUntil = undefined;
    }
  }
  
  private updateOrder(): void {
    this.profileOrder = Array.from(this.profiles.values())
      .sort((a, b) => b.priority - a.priority)
      .map(p => p.id);
  }
}

// ═══════════════════════════════════════════════════════════════
// 重试策略
// ═══════════════════════════════════════════════════════════════

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryableCategories: ErrorCategory[];
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 60000,
  backoffMultiplier: 2,
  retryableCategories: ['rate_limit', 'timeout', 'network', 'model_error'],
};

export class RetryPolicy {
  private attempts = 0;
  
  constructor(
    private config: RetryConfig = DEFAULT_RETRY_CONFIG,
    private classifier: ErrorClassifier = new ErrorClassifier()
  ) {}
  
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    let delay = this.config.baseDelay;
    
    while (this.attempts <= this.config.maxRetries) {
      try {
        return await fn();
      } catch (error) {
        this.attempts++;
        const classified = this.classifier.classify(error as Error);
        
        if (!this.config.retryableCategories.includes(classified.category)) {
          throw error;
        }
        
        if (this.attempts > this.config.maxRetries) {
          throw error;
        }
        
        const actualDelay = classified.retryAfter || delay;
        logger.warn(`重试 ${this.attempts}/${this.config.maxRetries}: 等待 ${actualDelay}ms`);
        
        await this.sleep(actualDelay);
        delay = Math.min(delay * this.config.backoffMultiplier, this.config.maxDelay);
      }
    }
    
    throw new Error('超过最大重试次数');
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ═══════════════════════════════════════════════════════════════
// 全局实例
// ═══════════════════════════════════════════════════════════════

let globalClassifier: ErrorClassifier | null = null;
let globalProfileManager: AuthProfileManager | null = null;

export function getErrorClassifier(): ErrorClassifier {
  if (!globalClassifier) {
    globalClassifier = new ErrorClassifier();
  }
  return globalClassifier;
}

export function getProfileManager(): AuthProfileManager {
  if (!globalProfileManager) {
    globalProfileManager = new AuthProfileManager();
  }
  return globalProfileManager;
}

export function resetRecovery(): void {
  globalClassifier = null;
  globalProfileManager = null;
}

export function classifyError(error: Error): ClassifiedError {
  return getErrorClassifier().classify(error);
}

export async function withRetry<T>(fn: () => Promise<T>, config?: Partial<RetryConfig>): Promise<T> {
  const policy = new RetryPolicy({ ...DEFAULT_RETRY_CONFIG, ...config });
  return policy.execute(fn);
}
