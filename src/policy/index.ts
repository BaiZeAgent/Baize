/**
 * 策略管道 - 工具调用安全控制
 * 
 * 提供多层策略验证：
 * 1. 工具白名单/黑名单
 * 2. 参数 Schema 验证
 * 3. 敏感操作检测
 * 4. 审批流程触发
 */

import { getLogger } from '../observability/logger';
import { ApprovalRequest } from '../hooks';

const logger = getLogger('policy');

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

/**
 * 策略上下文
 */
export interface PolicyContext {
  // 工具信息
  toolName: string;
  toolParams: Record<string, unknown>;
  
  // 会话信息
  sessionId: string;
  userId?: string;
  
  // 配置
  config: PolicyConfig;
  
  // 状态
  requiresApproval: boolean;
  approvalRequest?: ApprovalRequest;
  
  // 元数据
  metadata: Record<string, unknown>;
}

/**
 * 策略配置
 */
export interface PolicyConfig {
  // 工具白名单 (优先级高于黑名单)
  toolAllowlist?: string[];
  
  // 工具黑名单
  toolBlocklist?: string[];
  
  // 是否启用参数验证
  enableParamValidation: boolean;
  
  // 是否启用敏感操作检测
  enableSensitiveDetection: boolean;
  
  // 是否启用审批流程
  enableApproval: boolean;
  
  // 自动批准的信任级别
  autoApproveLevel: 'none' | 'low' | 'medium' | 'high';
  
  // 自定义规则
  customRules?: PolicyRule[];
}

/**
 * 策略结果
 */
export interface PolicyResult {
  // 是否允许
  allowed: boolean;
  
  // 原因
  reason?: string;
  
  // 修改后的参数
  modifiedParams?: Record<string, unknown>;
  
  // 需要审批
  requiresApproval?: boolean;
  
  // 审批请求
  approvalRequest?: ApprovalRequest;
  
  // 警告信息
  warnings?: string[];
}

/**
 * 策略阶段
 */
export interface PolicyStage {
  name: string;
  description?: string;
  check: (context: PolicyContext) => Promise<PolicyResult>;
}

/**
 * 策略规则
 */
export interface PolicyRule {
  name: string;
  condition: (context: PolicyContext) => boolean;
  action: 'allow' | 'block' | 'approve';
  message?: string;
}

// ═══════════════════════════════════════════════════════════════
// 内置策略阶段
// ═══════════════════════════════════════════════════════════════

/**
 * 工具白名单检查
 */
export const ToolAllowlistStage: PolicyStage = {
  name: 'tool_allowlist',
  description: '检查工具是否在白名单中',
  check: async (context) => {
    const { toolName, config } = context;
    
    if (config.toolAllowlist && config.toolAllowlist.length > 0) {
      // 支持通配符
      const allowed = config.toolAllowlist.some(pattern => {
        if (pattern.includes('*')) {
          const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
          return regex.test(toolName);
        }
        return pattern === toolName;
      });
      
      if (!allowed) {
        return {
          allowed: false,
          reason: `工具 "${toolName}" 不在白名单中`,
        };
      }
    }
    
    return { allowed: true };
  },
};

/**
 * 工具黑名单检查
 */
export const ToolBlocklistStage: PolicyStage = {
  name: 'tool_blocklist',
  description: '检查工具是否在黑名单中',
  check: async (context) => {
    const { toolName, config } = context;
    
    if (config.toolBlocklist && config.toolBlocklist.length > 0) {
      const blocked = config.toolBlocklist.some(pattern => {
        if (pattern.includes('*')) {
          const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
          return regex.test(toolName);
        }
        return pattern === toolName;
      });
      
      if (blocked) {
        return {
          allowed: false,
          reason: `工具 "${toolName}" 在黑名单中`,
        };
      }
    }
    
    return { allowed: true };
  },
};

/**
 * 参数验证阶段
 */
export const ParamValidationStage: PolicyStage = {
  name: 'param_validation',
  description: '验证工具参数',
  check: async (context) => {
    const { toolName, toolParams, config } = context;
    
    if (!config.enableParamValidation) {
      return { allowed: true };
    }
    
    const schema = getToolSchema(toolName);
    if (!schema) {
      return { allowed: true };
    }
    
    const result = validateParams(toolParams, schema);
    
    if (!result.valid) {
      return {
        allowed: false,
        reason: `参数验证失败: ${result.errors.join(', ')}`,
      };
    }
    
    return {
      allowed: true,
      modifiedParams: result.modifiedParams,
    };
  },
};

/**
 * 敏感操作检测阶段
 */
export const SensitiveOperationStage: PolicyStage = {
  name: 'sensitive_operation',
  description: '检测敏感操作',
  check: async (context) => {
    const { toolName, toolParams, config } = context;
    
    if (!config.enableSensitiveDetection) {
      return { allowed: true };
    }
    
    const detection = detectSensitiveOperation(toolName, toolParams);
    
    if (detection.sensitive) {
      if (config.enableApproval) {
        return {
          allowed: true,
          requiresApproval: true,
          approvalRequest: {
            id: `approval-${Date.now()}`,
            type: detection.type,
            operation: detection.operation,
            risk: detection.risk,
            message: detection.message,
            timestamp: Date.now(),
          },
        };
      }
      
      // 如果没有启用审批，根据风险级别决定
      if (detection.risk === 'high') {
        return {
          allowed: false,
          reason: `高风险操作被阻止: ${detection.message}`,
        };
      }
      
      return {
        allowed: true,
        warnings: [`警告: ${detection.message}`],
      };
    }
    
    return { allowed: true };
  },
};

/**
 * 自定义规则阶段
 */
export const CustomRulesStage: PolicyStage = {
  name: 'custom_rules',
  description: '应用自定义规则',
  check: async (context) => {
    const { config } = context;
    
    if (!config.customRules || config.customRules.length === 0) {
      return { allowed: true };
    }
    
    for (const rule of config.customRules) {
      if (rule.condition(context)) {
        switch (rule.action) {
          case 'allow':
            return { allowed: true };
          case 'block':
            return {
              allowed: false,
              reason: rule.message || `被规则 "${rule.name}" 阻止`,
            };
          case 'approve':
            return {
              allowed: true,
              requiresApproval: true,
              approvalRequest: {
                id: `approval-${Date.now()}`,
                type: 'tool',
                operation: context.toolName,
                risk: 'medium',
                message: rule.message || `需要审批: ${rule.name}`,
                timestamp: Date.now(),
              },
            };
        }
      }
    }
    
    return { allowed: true };
  },
};

// ═══════════════════════════════════════════════════════════════
// 策略管道
// ═══════════════════════════════════════════════════════════════

/**
 * 策略管道
 * 
 * 按顺序执行多个策略阶段
 */
export class PolicyPipeline {
  private stages: PolicyStage[] = [];
  
  constructor() {
    // 默认阶段
    this.addStage(ToolAllowlistStage);
    this.addStage(ToolBlocklistStage);
    this.addStage(ParamValidationStage);
    this.addStage(SensitiveOperationStage);
    this.addStage(CustomRulesStage);
  }
  
  /**
   * 添加阶段
   */
  addStage(stage: PolicyStage): this {
    this.stages.push(stage);
    return this;
  }
  
  /**
   * 移除阶段
   */
  removeStage(name: string): this {
    this.stages = this.stages.filter(s => s.name !== name);
    return this;
  }
  
  /**
   * 在指定阶段前插入
   */
  insertBefore(name: string, stage: PolicyStage): this {
    const index = this.stages.findIndex(s => s.name === name);
    if (index >= 0) {
      this.stages.splice(index, 0, stage);
    } else {
      this.stages.push(stage);
    }
    return this;
  }
  
  /**
   * 在指定阶段后插入
   */
  insertAfter(name: string, stage: PolicyStage): this {
    const index = this.stages.findIndex(s => s.name === name);
    if (index >= 0) {
      this.stages.splice(index + 1, 0, stage);
    } else {
      this.stages.push(stage);
    }
    return this;
  }
  
  /**
   * 执行管道
   */
  async execute(context: PolicyContext): Promise<PolicyResult> {
    const warnings: string[] = [];
    
    for (const stage of this.stages) {
      logger.debug(`执行策略阶段: ${stage.name}`);
      
      try {
        const result = await stage.check(context);
        
        // 收集警告
        if (result.warnings) {
          warnings.push(...result.warnings);
        }
        
        // 如果不允许，立即返回
        if (!result.allowed) {
          logger.info(`策略阻止: ${stage.name} -> ${result.reason}`);
          return result;
        }
        
        // 如果需要审批，设置标志
        if (result.requiresApproval) {
          context.requiresApproval = true;
          context.approvalRequest = result.approvalRequest;
        }
        
        // 应用参数修改
        if (result.modifiedParams) {
          context.toolParams = { ...context.toolParams, ...result.modifiedParams };
        }
        
      } catch (error) {
        logger.error(`策略阶段错误: ${stage.name} -> ${error}`);
        return {
          allowed: false,
          reason: `策略执行错误: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }
    
    return {
      allowed: true,
      warnings: warnings.length > 0 ? warnings : undefined,
      requiresApproval: context.requiresApproval,
      approvalRequest: context.approvalRequest,
    };
  }
  
  /**
   * 获取所有阶段名称
   */
  getStageNames(): string[] {
    return this.stages.map(s => s.name);
  }
}

// ═══════════════════════════════════════════════════════════════
// 辅助函数
// ═══════════════════════════════════════════════════════════════

/**
 * 工具 Schema 定义
 */
const TOOL_SCHEMAS: Record<string, ParamSchema> = {
  web_search: {
    query: { type: 'string', required: true, maxLength: 500 },
    count: { type: 'number', min: 1, max: 10 },
    provider: { type: 'string', enum: ['brave', 'duckduckgo', 'google'] },
  },
  web_fetch: {
    url: { type: 'string', required: true, format: 'uri' },
    timeout: { type: 'number', min: 1000, max: 60000 },
    maxBytes: { type: 'number', min: 1000, max: 10000000 },
  },
  memory_search: {
    query: { type: 'string', required: true, maxLength: 1000 },
    type: { type: 'string' },
    limit: { type: 'number', min: 1, max: 50 },
  },
  memory_set: {
    key: { type: 'string', required: true, maxLength: 100 },
    value: { type: 'string', required: true, maxLength: 10000 },
    confidence: { type: 'number', min: 0, max: 1 },
  },
  exec: {
    command: { type: 'string', required: true, maxLength: 10000 },
    timeout: { type: 'number', min: 1000, max: 300000 },
    cwd: { type: 'string' },
  },
  file_read: {
    path: { type: 'string', required: true },
    encoding: { type: 'string', enum: ['utf-8', 'binary'] },
  },
  file_write: {
    path: { type: 'string', required: true },
    content: { type: 'string', required: true },
    encoding: { type: 'string', enum: ['utf-8', 'binary'] },
  },
};

interface ParamSchema {
  [key: string]: {
    type: 'string' | 'number' | 'boolean' | 'object' | 'array';
    required?: boolean;
    enum?: string[];
    min?: number;
    max?: number;
    maxLength?: number;
    format?: string;
  };
}

/**
 * 获取工具 Schema
 */
function getToolSchema(toolName: string): ParamSchema | null {
  return TOOL_SCHEMAS[toolName] || null;
}

/**
 * 验证参数
 */
function validateParams(
  params: Record<string, unknown>,
  schema: ParamSchema
): { valid: boolean; errors: string[]; modifiedParams?: Record<string, unknown> } {
  const errors: string[] = [];
  const modifiedParams: Record<string, unknown> = { ...params };
  
  for (const [key, rules] of Object.entries(schema)) {
    const value = params[key];
    
    // 必填检查
    if (rules.required && (value === undefined || value === null)) {
      errors.push(`参数 "${key}" 是必需的`);
      continue;
    }
    
    if (value === undefined || value === null) {
      continue;
    }
    
    // 类型检查
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    if (actualType !== rules.type) {
      errors.push(`参数 "${key}" 类型错误: 期望 ${rules.type}, 实际 ${actualType}`);
      continue;
    }
    
    // 字符串验证
    if (rules.type === 'string' && typeof value === 'string') {
      if (rules.maxLength && value.length > rules.maxLength) {
        errors.push(`参数 "${key}" 超过最大长度 ${rules.maxLength}`);
      }
      if (rules.enum && !rules.enum.includes(value)) {
        errors.push(`参数 "${key}" 值无效: 必须是 ${rules.enum.join(', ')} 之一`);
      }
      if (rules.format === 'uri') {
        try {
          new URL(value);
        } catch {
          errors.push(`参数 "${key}" 不是有效的 URL`);
        }
      }
    }
    
    // 数字验证
    if (rules.type === 'number' && typeof value === 'number') {
      if (rules.min !== undefined && value < rules.min) {
        errors.push(`参数 "${key}" 小于最小值 ${rules.min}`);
      }
      if (rules.max !== undefined && value > rules.max) {
        errors.push(`参数 "${key}" 超过最大值 ${rules.max}`);
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors,
    modifiedParams: errors.length === 0 ? modifiedParams : undefined,
  };
}

/**
 * 敏感操作检测结果
 */
interface SensitiveDetectionResult {
  sensitive: boolean;
  type: 'exec' | 'tool' | 'file' | 'network';
  operation: string;
  risk: 'low' | 'medium' | 'high';
  message: string;
}

/**
 * 检测敏感操作
 */
function detectSensitiveOperation(
  toolName: string,
  params: Record<string, unknown>
): SensitiveDetectionResult {
  // 高风险命令模式
  const highRiskPatterns = [
    { pattern: /rm\s+-rf/, message: '递归强制删除' },
    { pattern: /sudo\s+/, message: '提权执行' },
    { pattern: /chmod\s+777/, message: '开放所有权限' },
    { pattern: />\s*\/dev\/sd/, message: '直接写入磁盘' },
    { pattern: /mkfs/, message: '格式化磁盘' },
    { pattern: /dd\s+if=/, message: '磁盘镜像操作' },
  ];
  
  // 中风险命令模式
  const mediumRiskPatterns = [
    { pattern: /rm\s+/, message: '删除文件' },
    { pattern: /mv\s+/, message: '移动文件' },
    { pattern: /chmod\s+/, message: '修改权限' },
    { pattern: /chown\s+/, message: '修改所有者' },
    { pattern: /curl\s+.*\|\s*bash/, message: '远程脚本执行' },
    { pattern: /wget\s+.*\|\s*bash/, message: '远程脚本执行' },
  ];
  
  // 检查 exec 工具
  if (toolName === 'exec' && params.command) {
    const command = params.command as string;
    
    // 检查高风险
    for (const { pattern, message } of highRiskPatterns) {
      if (pattern.test(command)) {
        return {
          sensitive: true,
          type: 'exec',
          operation: command.slice(0, 100),
          risk: 'high',
          message: `高风险操作: ${message}`,
        };
      }
    }
    
    // 检查中风险
    for (const { pattern, message } of mediumRiskPatterns) {
      if (pattern.test(command)) {
        return {
          sensitive: true,
          type: 'exec',
          operation: command.slice(0, 100),
          risk: 'medium',
          message: `中风险操作: ${message}`,
        };
      }
    }
  }
  
  // 检查文件操作
  if (['file_write', 'file_delete'].includes(toolName)) {
    const path = params.path as string;
    
    // 敏感路径
    const sensitivePaths = ['/etc/', '/root/', '~/.ssh/', '~/.gnupg/', '.env'];
    for (const sensitive of sensitivePaths) {
      if (path?.includes(sensitive)) {
        return {
          sensitive: true,
          type: 'file',
          operation: `${toolName}: ${path}`,
          risk: 'high',
          message: `敏感文件操作: ${path}`,
        };
      }
    }
  }
  
  // 检查网络操作
  if (toolName === 'web_fetch' && params.url) {
    const url = params.url as string;
    
    // 内网地址检测
    const internalPatterns = [
      /localhost/i,
      /127\./,
      /10\./,
      /172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /192\.168\./,
    ];
    
    for (const pattern of internalPatterns) {
      if (pattern.test(url)) {
        return {
          sensitive: true,
          type: 'network',
          operation: `web_fetch: ${url}`,
          risk: 'medium',
          message: `内网地址访问: ${url}`,
        };
      }
    }
  }
  
  return {
    sensitive: false,
    type: 'tool',
    operation: toolName,
    risk: 'low',
    message: '',
  };
}

// ═══════════════════════════════════════════════════════════════
// 全局实例
// ═══════════════════════════════════════════════════════════════

let globalPipeline: PolicyPipeline | null = null;

/**
 * 获取全局策略管道
 */
export function getPolicyPipeline(): PolicyPipeline {
  if (!globalPipeline) {
    globalPipeline = new PolicyPipeline();
  }
  return globalPipeline;
}

/**
 * 重置策略管道
 */
export function resetPolicyPipeline(): void {
  globalPipeline = null;
}

/**
 * 默认策略配置
 */
export const DEFAULT_POLICY_CONFIG: PolicyConfig = {
  enableParamValidation: true,
  enableSensitiveDetection: true,
  enableApproval: true,
  autoApproveLevel: 'none',
};

/**
 * 检查工具调用策略 (便捷函数)
 */
export async function checkToolPolicy(
  toolName: string,
  toolParams: Record<string, unknown>,
  config: PolicyConfig = DEFAULT_POLICY_CONFIG
): Promise<PolicyResult> {
  const context: PolicyContext = {
    toolName,
    toolParams,
    sessionId: 'default',
    config,
    requiresApproval: false,
    metadata: {},
  };
  
  return getPolicyPipeline().execute(context);
}
