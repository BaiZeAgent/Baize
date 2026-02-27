/**
 * 审批系统 - 敏感操作确认流程
 * 
 * 提供企业级操作审批：
 * 1. 审批请求生成
 * 2. 审批状态管理
 * 3. 超时处理
 * 4. 审计日志
 */

import { getLogger } from '../observability/logger';
import { randomBytes } from 'crypto';

const logger = getLogger('approval');

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

/**
 * 审批类型
 */
export type ApprovalType = 'exec' | 'tool' | 'file' | 'network' | 'config';

/**
 * 风险级别
 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/**
 * 审批状态
 */
export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';

/**
 * 审批请求
 */
export interface ApprovalRequest {
  id: string;
  type: ApprovalType;
  operation: string;
  risk: RiskLevel;
  message: string;
  timestamp: number;
  expiresAt?: number;
  metadata?: Record<string, unknown>;
}

/**
 * 审批结果
 */
export interface ApprovalResult {
  id: string;
  status: ApprovalStatus;
  approvedBy?: string;
  approvedAt?: number;
  reason?: string;
}

/**
 * 审批配置
 */
export interface ApprovalConfig {
  enabled: boolean;
  defaultTimeout: number;  // 默认超时 (ms)
  autoApproveLowRisk: boolean;
  autoApprovePatterns?: RegExp[];
  notifyOnRequest?: (request: ApprovalRequest) => void;
}

/**
 * 默认配置
 */
export const DEFAULT_APPROVAL_CONFIG: ApprovalConfig = {
  enabled: true,
  defaultTimeout: 300000, // 5 分钟
  autoApproveLowRisk: false,
};

// ═══════════════════════════════════════════════════════════════
// 审批管理器
// ═══════════════════════════════════════════════════════════════

/**
 * 待处理的审批
 */
interface PendingApproval {
  request: ApprovalRequest;
  resolve: (result: ApprovalResult) => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout;
}

/**
 * 审批管理器
 */
export class ApprovalManager {
  private pending: Map<string, PendingApproval> = new Map();
  private history: ApprovalResult[] = [];
  private maxHistorySize = 1000;
  
  constructor(private config: ApprovalConfig = DEFAULT_APPROVAL_CONFIG) {}
  
  /**
   * 请求审批
   */
  async requestApproval(
    request: Omit<ApprovalRequest, 'id' | 'timestamp'>,
    options?: { timeout?: number }
  ): Promise<ApprovalResult> {
    if (!this.config.enabled) {
      // 审批未启用，自动通过
      return {
        id: this.generateId(),
        status: 'approved',
        approvedAt: Date.now(),
        reason: '审批系统未启用',
      };
    }
    
    // 检查自动批准
    if (this.shouldAutoApprove(request)) {
      logger.info(`自动批准: ${request.operation}`);
      return {
        id: this.generateId(),
        status: 'approved',
        approvedAt: Date.now(),
        reason: '自动批准',
      };
    }
    
    const fullRequest: ApprovalRequest = {
      ...request,
      id: this.generateId(),
      timestamp: Date.now(),
      expiresAt: Date.now() + (options?.timeout || this.config.defaultTimeout),
    };
    
    logger.info(`审批请求: ${fullRequest.id} - ${request.operation} (风险: ${request.risk})`);
    
    // 通知
    if (this.config.notifyOnRequest) {
      this.config.notifyOnRequest(fullRequest);
    }
    
    return new Promise((resolve, reject) => {
      const pending: PendingApproval = {
        request: fullRequest,
        resolve,
        reject,
      };
      
      // 设置超时
      pending.timer = setTimeout(() => {
        this.expireApproval(fullRequest.id);
      }, options?.timeout || this.config.defaultTimeout);
      
      this.pending.set(fullRequest.id, pending);
    });
  }
  
  /**
   * 批准请求
   */
  approve(id: string, approvedBy?: string, reason?: string): boolean {
    const pending = this.pending.get(id);
    if (!pending) {
      logger.warn(`审批请求不存在: ${id}`);
      return false;
    }
    
    // 清除超时定时器
    if (pending.timer) {
      clearTimeout(pending.timer);
    }
    
    const result: ApprovalResult = {
      id,
      status: 'approved',
      approvedBy,
      approvedAt: Date.now(),
      reason,
    };
    
    // 记录历史
    this.addToHistory(result);
    
    // 移除待处理
    this.pending.delete(id);
    
    // 解析 Promise
    pending.resolve(result);
    
    logger.info(`审批批准: ${id} by ${approvedBy || 'unknown'}`);
    return true;
  }
  
  /**
   * 拒绝请求
   */
  deny(id: string, reason?: string): boolean {
    const pending = this.pending.get(id);
    if (!pending) {
      logger.warn(`审批请求不存在: ${id}`);
      return false;
    }
    
    // 清除超时定时器
    if (pending.timer) {
      clearTimeout(pending.timer);
    }
    
    const result: ApprovalResult = {
      id,
      status: 'denied',
      reason,
    };
    
    // 记录历史
    this.addToHistory(result);
    
    // 移除待处理
    this.pending.delete(id);
    
    // 解析 Promise
    pending.resolve(result);
    
    logger.info(`审批拒绝: ${id} - ${reason || 'no reason'}`);
    return true;
  }
  
  /**
   * 获取待处理请求
   */
  getPendingRequests(): ApprovalRequest[] {
    return Array.from(this.pending.values()).map(p => p.request);
  }
  
  /**
   * 获取请求
   */
  getRequest(id: string): ApprovalRequest | null {
    return this.pending.get(id)?.request || null;
  }
  
  /**
   * 获取历史记录
   */
  getHistory(limit?: number): ApprovalResult[] {
    if (limit) {
      return this.history.slice(-limit);
    }
    return [...this.history];
  }
  
  /**
   * 清除所有待处理
   */
  clearAll(): void {
    for (const [id, pending] of this.pending) {
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      pending.reject(new Error('审批系统已清除'));
    }
    this.pending.clear();
  }
  
  /**
   * 检查是否应该自动批准
   */
  private shouldAutoApprove(request: Omit<ApprovalRequest, 'id' | 'timestamp'>): boolean {
    // 低风险自动批准
    if (this.config.autoApproveLowRisk && request.risk === 'low') {
      return true;
    }
    
    // 匹配自动批准模式
    if (this.config.autoApprovePatterns) {
      for (const pattern of this.config.autoApprovePatterns) {
        if (pattern.test(request.operation)) {
          return true;
        }
      }
    }
    
    return false;
  }
  
  /**
   * 使审批过期
   */
  private expireApproval(id: string): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    
    const result: ApprovalResult = {
      id,
      status: 'expired',
      reason: '审批超时',
    };
    
    this.addToHistory(result);
    this.pending.delete(id);
    pending.resolve(result);
    
    logger.warn(`审批过期: ${id}`);
  }
  
  /**
   * 添加到历史
   */
  private addToHistory(result: ApprovalResult): void {
    this.history.push(result);
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(-this.maxHistorySize);
    }
  }
  
  /**
   * 生成 ID
   */
  private generateId(): string {
    return `approval-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
  }
}

// ═══════════════════════════════════════════════════════════════
// 敏感操作检测
// ═══════════════════════════════════════════════════════════════

/**
 * 敏感操作规则
 */
interface SensitiveRule {
  pattern: RegExp;
  type: ApprovalType;
  risk: RiskLevel;
  message: string;
}

/**
 * 敏感操作规则库
 */
const SENSITIVE_RULES: SensitiveRule[] = [
  // 高风险命令
  { pattern: /rm\s+-rf/, type: 'exec', risk: 'critical', message: '递归强制删除' },
  { pattern: /sudo\s+/, type: 'exec', risk: 'high', message: '提权执行' },
  { pattern: /chmod\s+777/, type: 'exec', risk: 'high', message: '开放所有权限' },
  { pattern: />\s*\/dev\/sd/, type: 'exec', risk: 'critical', message: '直接写入磁盘' },
  { pattern: /mkfs/, type: 'exec', risk: 'critical', message: '格式化磁盘' },
  { pattern: /dd\s+if=/, type: 'exec', risk: 'high', message: '磁盘镜像操作' },
  
  // 中风险命令
  { pattern: /rm\s+/, type: 'exec', risk: 'medium', message: '删除文件' },
  { pattern: /mv\s+.*\//, type: 'exec', risk: 'low', message: '移动文件' },
  { pattern: /chmod\s+/, type: 'exec', risk: 'medium', message: '修改权限' },
  { pattern: /chown\s+/, type: 'exec', risk: 'medium', message: '修改所有者' },
  { pattern: /curl\s+.*\|\s*bash/, type: 'exec', risk: 'high', message: '远程脚本执行' },
  { pattern: /wget\s+.*\|\s*bash/, type: 'exec', risk: 'high', message: '远程脚本执行' },
  
  // 敏感路径
  { pattern: /\/etc\//, type: 'file', risk: 'high', message: '系统配置文件' },
  { pattern: /\/root\//, type: 'file', risk: 'high', message: 'Root 用户目录' },
  { pattern: /\.ssh\//, type: 'file', risk: 'critical', message: 'SSH 密钥' },
  { pattern: /\.env/, type: 'file', risk: 'high', message: '环境变量文件' },
  { pattern: /\.gnupg\//, type: 'file', risk: 'critical', message: 'GPG 密钥' },
  
  // 网络操作
  { pattern: /localhost|127\.0\.0\.1/, type: 'network', risk: 'medium', message: '本地网络访问' },
  { pattern: /10\.\d+\.\d+\.\d+/, type: 'network', risk: 'medium', message: '内网地址 (10.x)' },
  { pattern: /192\.168\.\d+\.\d+/, type: 'network', risk: 'medium', message: '内网地址 (192.168.x)' },
  { pattern: /172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+/, type: 'network', risk: 'medium', message: '内网地址 (172.16-31.x)' },
];

/**
 * 检测敏感操作
 */
export function detectSensitiveOperation(operation: string): ApprovalRequest | null {
  for (const rule of SENSITIVE_RULES) {
    if (rule.pattern.test(operation)) {
      return {
        id: '', // 将由 ApprovalManager 生成
        type: rule.type,
        operation,
        risk: rule.risk,
        message: rule.message,
        timestamp: Date.now(),
      };
    }
  }
  return null;
}

/**
 * 检查操作是否需要审批
 */
export function requiresApproval(operation: string, type: ApprovalType): boolean {
  for (const rule of SENSITIVE_RULES) {
    if (rule.type === type && rule.pattern.test(operation)) {
      return true;
    }
  }
  return false;
}

/**
 * 获取操作风险级别
 */
export function getOperationRisk(operation: string, type: ApprovalType): RiskLevel {
  for (const rule of SENSITIVE_RULES) {
    if (rule.type === type && rule.pattern.test(operation)) {
      return rule.risk;
    }
  }
  return 'low';
}

// ═══════════════════════════════════════════════════════════════
// 全局实例
// ═══════════════════════════════════════════════════════════════

let globalApprovalManager: ApprovalManager | null = null;

export function getApprovalManager(): ApprovalManager {
  if (!globalApprovalManager) {
    globalApprovalManager = new ApprovalManager();
  }
  return globalApprovalManager;
}

export function resetApproval(): void {
  if (globalApprovalManager) {
    globalApprovalManager.clearAll();
  }
  globalApprovalManager = null;
}

// ═══════════════════════════════════════════════════════════════
// 便捷函数
// ═══════════════════════════════════════════════════════════════

/**
 * 请求审批 (便捷函数)
 */
export async function requestApproval(
  operation: string,
  type: ApprovalType = 'exec',
  options?: { timeout?: number }
): Promise<ApprovalResult> {
  const risk = getOperationRisk(operation, type);
  
  return getApprovalManager().requestApproval({
    type,
    operation,
    risk,
    message: `需要审批: ${operation.slice(0, 100)}`,
  }, options);
}
