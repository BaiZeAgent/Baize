/**
 * 恢复层 - 智能错误恢复系统
 * 
 * 核心能力：
 * 1. 根因分析 - 深度分析错误根本原因
 * 2. 策略生成 - 生成多种恢复策略
 * 3. 经验学习 - 从失败中学习，避免重复错误
 * 4. 预测性恢复 - 预测可能的失败并提前准备
 */

import { getLLMManager } from '../../llm';
import { getSkillRegistry } from '../../skills/registry';
import { getMemory } from '../../memory';
import { getLogger } from '../../observability/logger';
import { LLMMessage } from '../../types';

const logger = getLogger('core:recovery');

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

/** 错误根因 */
export interface ErrorRootCause {
  type: ErrorType;
  category: ErrorCategory;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  rootCause: string;
  contributingFactors: string[];
  isRecoverable: boolean;
  suggestedActions: string[];
}

/** 错误类型 */
export type ErrorType = 
  | 'param_mismatch'      // 参数不匹配
  | 'resource_missing'     // 资源缺失
  | 'permission_denied'    // 权限拒绝
  | 'tool_unavailable'     // 工具不可用
  | 'network_error'        // 网络错误
  | 'timeout'              // 超时
  | 'logic_error'          // 逻辑错误
  | 'unexpected_result'    // 意外结果
  | 'user_cancelled'       // 用户取消
  | 'unknown';             // 未知

/** 错误类别 */
export type ErrorCategory = 
  | 'transient'    // 暂时性错误，可重试
  | 'permanent'    // 永久性错误，需要改变策略
  | 'user'         // 用户相关错误，需要用户介入
  | 'system';      // 系统错误，需要管理员介入

/** 恢复策略 */
export interface RecoveryStrategy {
  type: StrategyType;
  priority: number;
  description: string;
  estimatedSuccessRate: number;
  estimatedTime: number;
  params?: Record<string, unknown>;
}

export type StrategyType = 
  | 'retry'              // 简单重试
  | 'retry_with_delay'   // 延迟重试
  | 'correct_params'     // 修正参数
  | 'use_alternative'    // 使用替代工具
  | 'decompose'          // 分解任务
  | 'simplify'           // 简化任务
  | 'ask_user'           // 询问用户
  | 'skip'               // 跳过任务
  | 'abort';             // 中止执行

/** 恢复结果 */
export interface RecoveryResult {
  shouldRetry: boolean;
  strategy: StrategyType;
  rootCause: ErrorRootCause;
  correctedParams?: Record<string, unknown>;
  alternativeTool?: string;
  userQuestion?: string;
  decomposedTasks?: Array<{ skillName: string; params: Record<string, unknown> }>;
  confidence: number;
}

/** 恢复经验 */
export interface RecoveryExperience {
  errorSignature: string;
  errorType: ErrorType;
  successfulStrategy: StrategyType;
  failedStrategies: StrategyType[];
  context: string;
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// 恢复引擎
// ═══════════════════════════════════════════════════════════════

export class RecoveryEngine {
  private llm = getLLMManager();
  private skillRegistry = getSkillRegistry();
  private memory = getMemory();
  
  // 经验存储
  private experiences: RecoveryExperience[] = [];
  private maxExperiences = 1000;
  
  // 错误模式库
  private errorPatterns: Map<string, ErrorRootCause> = new Map();

  constructor() {
    this.initializeErrorPatterns();
  }

  /**
   * 恢复入口
   */
  async recover(
    error: Error,
    context: {
      task?: { skillName: string; params: Record<string, unknown> };
      userInput?: string;
      previousAttempts?: number;
      history?: Array<{ success: boolean; error?: string }>;
    }
  ): Promise<RecoveryResult> {
    logger.info(`[恢复] 开始分析错误: ${error.message.slice(0, 100)}...`);

    // 1. 根因分析
    const rootCause = await this.analyzeRootCause(error, context);
    
    logger.info(`[恢复] 根因类型: ${rootCause.type}, 可恢复: ${rootCause.isRecoverable}`);

    // 2. 查找历史经验
    const experience = this.findExperience(error, rootCause);
    
    if (experience) {
      logger.info(`[恢复] 找到历史经验: ${experience.successfulStrategy}`);
      // 使用历史成功的策略
      return this.applyExperience(experience, error, context);
    }

    // 3. 生成恢复策略
    const strategies = await this.generateStrategies(rootCause, error, context);
    
    if (strategies.length === 0) {
      return this.createAbortResult(rootCause, '无法生成恢复策略');
    }

    // 4. 选择最佳策略
    const bestStrategy = this.selectBestStrategy(strategies, context);
    
    logger.info(`[恢复] 选择策略: ${bestStrategy.type}, 预估成功率: ${bestStrategy.estimatedSuccessRate}`);

    // 5. 构建恢复结果
    return this.buildRecoveryResult(bestStrategy, rootCause, error, context);
  }

  /**
   * 根因分析
   */
  private async analyzeRootCause(
    error: Error,
    context: any
  ): Promise<ErrorRootCause> {
    // 1. 快速模式匹配
    const quickMatch = this.quickMatchError(error.message);
    if (quickMatch) {
      return quickMatch;
    }

    // 2. 深度分析
    const deepAnalysis = await this.deepAnalyzeError(error, context);
    return deepAnalysis;
  }

  /**
   * 快速错误匹配
   */
  private quickMatchError(errorMessage: string): ErrorRootCause | null {
    const patterns = [
      {
        regex: /参数值错误|缺少必填参数|未知操作/i,
        type: 'param_mismatch' as ErrorType,
        category: 'permanent' as ErrorCategory,
        severity: 'medium' as const,
        isRecoverable: true,
      },
      {
        regex: /技能不存在|工具不存在|not found/i,
        type: 'tool_unavailable' as ErrorType,
        category: 'permanent' as ErrorCategory,
        severity: 'high' as const,
        isRecoverable: true,
      },
      {
        regex: /网络|network|ECONNREFUSED|ETIMEDOUT/i,
        type: 'network_error' as ErrorType,
        category: 'transient' as ErrorCategory,
        severity: 'medium' as const,
        isRecoverable: true,
      },
      {
        regex: /超时|timeout|timed out/i,
        type: 'timeout' as ErrorType,
        category: 'transient' as ErrorCategory,
        severity: 'low' as const,
        isRecoverable: true,
      },
      {
        regex: /权限|permission|denied|forbidden/i,
        type: 'permission_denied' as ErrorType,
        category: 'user' as ErrorCategory,
        severity: 'high' as const,
        isRecoverable: false,
      },
    ];

    for (const pattern of patterns) {
      if (pattern.regex.test(errorMessage)) {
        return {
          ...pattern,
          description: errorMessage,
          rootCause: this.inferRootCause(pattern.type, errorMessage),
          contributingFactors: [],
          suggestedActions: this.suggestActions(pattern.type),
        };
      }
    }

    return null;
  }

  /**
   * 深度错误分析
   */
  private async deepAnalyzeError(
    error: Error,
    context: any
  ): Promise<ErrorRootCause> {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个错误分析专家。深入分析错误的根本原因。

## 分析维度
1. 错误类型: param_mismatch/resource_missing/permission_denied/tool_unavailable/network_error/timeout/logic_error/unexpected_result/user_cancelled/unknown
2. 错误类别: transient(暂时性)/permanent(永久性)/user(用户相关)/system(系统相关)
3. 严重程度: low/medium/high/critical
4. 是否可恢复
5. 根本原因
6. 建议行动

## 输出格式
{
  "type": "错误类型",
  "category": "错误类别",
  "severity": "严重程度",
  "description": "错误描述",
  "rootCause": "根本原因",
  "contributingFactors": ["因素1", "因素2"],
  "isRecoverable": true/false,
  "suggestedActions": ["行动1", "行动2"]
}`,
      },
      {
        role: 'user',
        content: `## 错误信息
${error.message}

## 错误堆栈
${error.stack || '(无堆栈)'}

## 执行上下文
- 任务: ${context.task?.skillName || '(未知)'}
- 参数: ${JSON.stringify(context.task?.params || {})}
- 用户输入: ${context.userInput || '(无)'}
- 之前尝试次数: ${context.previousAttempts || 0}

请分析这个错误的根本原因。`,
      },
    ];

    try {
      const response = await this.llm.chat(messages, { temperature: 0.2 });
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          type: parsed.type || 'unknown',
          category: parsed.category || 'permanent',
          severity: parsed.severity || 'medium',
          description: parsed.description || error.message,
          rootCause: parsed.rootCause || '未知原因',
          contributingFactors: parsed.contributingFactors || [],
          isRecoverable: parsed.isRecoverable ?? true,
          suggestedActions: parsed.suggestedActions || [],
        };
      }
    } catch (e) {
      logger.error('深度分析失败', { error: e });
    }

    // 默认返回
    return {
      type: 'unknown',
      category: 'permanent',
      severity: 'medium',
      description: error.message,
      rootCause: '无法确定根本原因',
      contributingFactors: [],
      isRecoverable: true,
      suggestedActions: ['重试任务', '询问用户'],
    };
  }

  /**
   * 推断根因
   */
  private inferRootCause(type: ErrorType, message: string): string {
    const causes: Record<ErrorType, string> = {
      param_mismatch: '参数与工具期望的格式或值不匹配',
      resource_missing: '所需的资源或文件不存在',
      permission_denied: '当前用户或进程没有足够的权限',
      tool_unavailable: '请求的工具或技能未安装或不可用',
      network_error: '网络连接问题导致请求失败',
      timeout: '操作耗时超过限制',
      logic_error: '工具内部逻辑处理错误',
      unexpected_result: '工具返回了意外的结果格式',
      user_cancelled: '用户主动取消了操作',
      unknown: '无法确定具体原因',
    };
    return causes[type] || causes.unknown;
  }

  /**
   * 建议行动
   */
  private suggestActions(type: ErrorType): string[] {
    const actions: Record<ErrorType, string[]> = {
      param_mismatch: ['检查参数格式', '使用默认值', '询问用户'],
      resource_missing: ['创建资源', '使用替代资源', '询问用户路径'],
      permission_denied: ['请求权限', '使用替代方案', '通知用户'],
      tool_unavailable: ['安装工具', '使用替代工具', '简化任务'],
      network_error: ['延迟后重试', '检查网络', '使用缓存结果'],
      timeout: ['增加超时时间', '简化任务', '分批处理'],
      logic_error: ['报告问题', '使用替代方案', '跳过任务'],
      unexpected_result: ['解析结果', '重试', '通知用户'],
      user_cancelled: ['确认取消', '保存进度', '清理资源'],
      unknown: ['重试', '简化任务', '询问用户'],
    };
    return actions[type] || actions.unknown;
  }

  /**
   * 生成恢复策略
   */
  private async generateStrategies(
    rootCause: ErrorRootCause,
    error: Error,
    context: any
  ): Promise<RecoveryStrategy[]> {
    const strategies: RecoveryStrategy[] = [];

    // 根据错误类型生成策略
    switch (rootCause.type) {
      case 'param_mismatch':
        strategies.push(...await this.generateParamStrategies(error, context));
        break;
      
      case 'tool_unavailable':
        strategies.push(...await this.generateToolStrategies(error, context));
        break;
      
      case 'network_error':
      case 'timeout':
        strategies.push(...this.generateRetryStrategies());
        break;
      
      case 'permission_denied':
        strategies.push(...this.generatePermissionStrategies(context));
        break;
      
      default:
        strategies.push(...await this.generateGenericStrategies(error, context));
    }

    // 按优先级排序
    return strategies.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 生成参数修正策略
   */
  private async generateParamStrategies(
    error: Error,
    context: any
  ): Promise<RecoveryStrategy[]> {
    const strategies: RecoveryStrategy[] = [];

    // 1. 自动修正参数
    const correctedParams = await this.tryCorrectParams(error, context);
    if (correctedParams) {
      strategies.push({
        type: 'correct_params',
        priority: 10,
        description: '自动修正参数后重试',
        estimatedSuccessRate: 0.8,
        estimatedTime: 5,
        params: correctedParams,
      });
    }

    // 2. 使用默认参数
    strategies.push({
      type: 'correct_params',
      priority: 8,
      description: '使用默认参数重试',
      estimatedSuccessRate: 0.6,
      estimatedTime: 3,
    });

    // 3. 询问用户
    strategies.push({
      type: 'ask_user',
      priority: 5,
      description: '询问用户正确的参数',
      estimatedSuccessRate: 0.9,
      estimatedTime: 30,
    });

    return strategies;
  }

  /**
   * 生成工具替代策略
   */
  private async generateToolStrategies(
    error: Error,
    context: any
  ): Promise<RecoveryStrategy[]> {
    const strategies: RecoveryStrategy[] = [];
    const skillName = context.task?.skillName;

    // 1. 查找替代工具
    const alternatives = await this.findAlternativeTools(skillName, context);
    for (const alt of alternatives) {
      strategies.push({
        type: 'use_alternative',
        priority: 9,
        description: `使用替代工具: ${alt.name}`,
        estimatedSuccessRate: alt.confidence,
        estimatedTime: 10,
        params: { alternativeTool: alt.name },
      });
    }

    // 2. 分解任务
    strategies.push({
      type: 'decompose',
      priority: 7,
      description: '分解为更小的任务',
      estimatedSuccessRate: 0.7,
      estimatedTime: 20,
    });

    // 3. 简化任务
    strategies.push({
      type: 'simplify',
      priority: 6,
      description: '简化任务要求',
      estimatedSuccessRate: 0.5,
      estimatedTime: 15,
    });

    return strategies;
  }

  /**
   * 生成重试策略
   */
  private generateRetryStrategies(): RecoveryStrategy[] {
    return [
      {
        type: 'retry_with_delay',
        priority: 10,
        description: '延迟后重试',
        estimatedSuccessRate: 0.7,
        estimatedTime: 10,
      },
      {
        type: 'retry',
        priority: 8,
        description: '立即重试',
        estimatedSuccessRate: 0.5,
        estimatedTime: 2,
      },
      {
        type: 'simplify',
        priority: 5,
        description: '简化请求后重试',
        estimatedSuccessRate: 0.6,
        estimatedTime: 15,
      },
    ];
  }

  /**
   * 生成权限策略
   */
  private generatePermissionStrategies(context: any): RecoveryStrategy[] {
    return [
      {
        type: 'ask_user',
        priority: 10,
        description: '请求用户授权',
        estimatedSuccessRate: 0.8,
        estimatedTime: 60,
      },
      {
        type: 'use_alternative',
        priority: 7,
        description: '使用不需要权限的替代方案',
        estimatedSuccessRate: 0.5,
        estimatedTime: 10,
      },
      {
        type: 'skip',
        priority: 3,
        description: '跳过此任务',
        estimatedSuccessRate: 1.0,
        estimatedTime: 1,
      },
    ];
  }

  /**
   * 生成通用策略
   */
  private async generateGenericStrategies(
    error: Error,
    context: any
  ): Promise<RecoveryStrategy[]> {
    return [
      {
        type: 'retry',
        priority: 8,
        description: '重试任务',
        estimatedSuccessRate: 0.4,
        estimatedTime: 5,
      },
      {
        type: 'decompose',
        priority: 6,
        description: '分解任务',
        estimatedSuccessRate: 0.6,
        estimatedTime: 20,
      },
      {
        type: 'ask_user',
        priority: 5,
        description: '询问用户',
        estimatedSuccessRate: 0.8,
        estimatedTime: 30,
      },
      {
        type: 'abort',
        priority: 1,
        description: '中止执行',
        estimatedSuccessRate: 1.0,
        estimatedTime: 1,
      },
    ];
  }

  /**
   * 尝试修正参数
   */
  private async tryCorrectParams(
    error: Error,
    context: any
  ): Promise<Record<string, unknown> | null> {
    const skillName = context.task?.skillName;
    const currentParams = context.task?.params || {};
    
    if (!skillName) return null;

    const skill = this.skillRegistry.get(skillName);
    if (!skill) return null;

    const schema = skill.inputSchema as {
      properties?: Record<string, { enum?: string[]; type?: string; default?: any }>;
    };

    if (!schema?.properties) return null;

    const correctedParams = { ...currentParams };
    let hasCorrection = false;

    // 尝试从错误消息中提取正确值
    const enumMatch = error.message.match(/\[可选值:\s*([^\]]+)\]/);
    const paramMatch = error.message.match(/参数值错误:\s*(\w+)/);

    if (enumMatch && paramMatch) {
      const validOptions = enumMatch[1].split(',').map(s => s.trim());
      const paramName = paramMatch[1];
      if (validOptions.length > 0) {
        correctedParams[paramName] = validOptions[0];
        hasCorrection = true;
      }
    }

    // 使用默认值
    if (!hasCorrection) {
      for (const [name, prop] of Object.entries(schema.properties)) {
        if (prop.default !== undefined && correctedParams[name] === undefined) {
          correctedParams[name] = prop.default;
          hasCorrection = true;
        }
      }
    }

    return hasCorrection ? correctedParams : null;
  }

  /**
   * 查找替代工具
   */
  private async findAlternativeTools(
    skillName: string | undefined,
    context: any
  ): Promise<Array<{ name: string; confidence: number }>> {
    if (!skillName) return [];

    const skill = this.skillRegistry.get(skillName);
    if (!skill) return [];

    const alternatives: Array<{ name: string; confidence: number }> = [];
    const capabilities = skill.capabilities || [];

    // 查找具有相同能力的其他工具
    const allSkills = this.skillRegistry.getAll();
    for (const s of allSkills) {
      if (s.name === skillName) continue;
      
      const matchCount = s.capabilities?.filter(c => capabilities.includes(c)).length || 0;
      if (matchCount > 0) {
        alternatives.push({
          name: s.name,
          confidence: matchCount / capabilities.length,
        });
      }
    }

    return alternatives.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
  }

  /**
   * 选择最佳策略
   */
  private selectBestStrategy(
    strategies: RecoveryStrategy[],
    context: any
  ): RecoveryStrategy {
    // 考虑历史成功率
    for (const strategy of strategies) {
      const historyRate = this.getStrategySuccessRate(strategy.type);
      strategy.estimatedSuccessRate = strategy.estimatedSuccessRate * 0.7 + historyRate * 0.3;
    }

    // 按调整后的成功率排序
    strategies.sort((a, b) => b.estimatedSuccessRate - a.estimatedSuccessRate);

    return strategies[0];
  }

  /**
   * 获取策略历史成功率
   */
  private getStrategySuccessRate(strategyType: StrategyType): number {
    const relevant = this.experiences.filter(e => 
      e.successfulStrategy === strategyType || e.failedStrategies.includes(strategyType)
    );
    
    if (relevant.length === 0) return 0.5;
    
    const successCount = relevant.filter(e => e.successfulStrategy === strategyType).length;
    return successCount / relevant.length;
  }

  /**
   * 构建恢复结果
   */
  private buildRecoveryResult(
    strategy: RecoveryStrategy,
    rootCause: ErrorRootCause,
    error: Error,
    context: any
  ): RecoveryResult {
    const result: RecoveryResult = {
      shouldRetry: strategy.type !== 'abort' && strategy.type !== 'skip',
      strategy: strategy.type,
      rootCause,
      confidence: strategy.estimatedSuccessRate,
    };

    // 根据策略类型填充具体信息
    switch (strategy.type) {
      case 'correct_params':
        result.correctedParams = strategy.params || {};
        break;
      
      case 'use_alternative':
        result.alternativeTool = strategy.params?.alternativeTool as string;
        break;
      
      case 'ask_user':
        result.userQuestion = this.generateUserQuestion(rootCause, error);
        break;
      
      case 'decompose':
        // 分解任务由上层处理
        break;
    }

    return result;
  }

  /**
   * 生成用户问题
   */
  private generateUserQuestion(rootCause: ErrorRootCause, error: Error): string {
    const questions: Record<ErrorType, string> = {
      param_mismatch: `参数有误: ${error.message}。请提供正确的参数值。`,
      resource_missing: `缺少所需资源: ${rootCause.description}。请提供资源位置或创建资源。`,
      permission_denied: `权限不足: ${rootCause.description}。是否授权执行此操作？`,
      tool_unavailable: `所需工具不可用。是否使用替代方案？`,
      network_error: `网络问题导致失败。是否重试？`,
      timeout: `操作超时。是否增加等待时间重试？`,
      logic_error: `处理逻辑出现问题。是否尝试其他方式？`,
      unexpected_result: `结果不符合预期。是否继续？`,
      user_cancelled: '操作已取消。',
      unknown: `遇到未知错误: ${error.message}。是否重试？`,
    };
    return questions[rootCause.type] || questions.unknown;
  }

  /**
   * 查找历史经验
   */
  private findExperience(error: Error, rootCause: ErrorRootCause): RecoveryExperience | null {
    const signature = this.generateErrorSignature(error, rootCause);
    
    // 查找成功恢复的经验
    const successful = this.experiences.find(e => 
      e.errorSignature === signature && e.successfulStrategy
    );
    
    return successful || null;
  }

  /**
   * 生成错误签名
   */
  private generateErrorSignature(error: Error, rootCause: ErrorRootCause): string {
    return `${rootCause.type}:${error.message.slice(0, 50)}`;
  }

  /**
   * 应用历史经验
   */
  private applyExperience(
    experience: RecoveryExperience,
    error: Error,
    context: any
  ): RecoveryResult {
    return {
      shouldRetry: experience.successfulStrategy !== 'abort',
      strategy: experience.successfulStrategy,
      rootCause: {
        type: experience.errorType,
        category: 'permanent',
        severity: 'medium',
        description: error.message,
        rootCause: '历史错误',
        contributingFactors: [],
        isRecoverable: true,
        suggestedActions: [],
      },
      confidence: 0.9,
    };
  }

  /**
   * 记录恢复经验
   */
  recordExperience(
    error: Error,
    rootCause: ErrorRootCause,
    strategy: StrategyType,
    success: boolean
  ): void {
    const signature = this.generateErrorSignature(error, rootCause);
    
    const existing = this.experiences.find(e => e.errorSignature === signature);
    
    if (existing) {
      if (success) {
        existing.successfulStrategy = strategy;
      } else {
        existing.failedStrategies.push(strategy);
      }
    } else {
      this.experiences.push({
        errorSignature: signature,
        errorType: rootCause.type,
        successfulStrategy: success ? strategy : '' as StrategyType,
        failedStrategies: success ? [] : [strategy],
        context: '',
        timestamp: Date.now(),
      });
      
      // 限制大小
      if (this.experiences.length > this.maxExperiences) {
        this.experiences = this.experiences.slice(-this.maxExperiences);
      }
    }
    
    // 持久化到记忆系统
    this.memory.learnErrorRecovery(
      rootCause.type,
      success ? strategy : `failed:${strategy}`
    );
  }

  /**
   * 初始化错误模式
   */
  private initializeErrorPatterns(): void {
    // 可以从配置或数据库加载
  }

  /**
   * 创建中止结果
   */
  private createAbortResult(rootCause: ErrorRootCause, reason: string): RecoveryResult {
    return {
      shouldRetry: false,
      strategy: 'abort',
      rootCause,
      confidence: 1.0,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// 全局实例
// ═══════════════════════════════════════════════════════════════

let recoveryEngineInstance: RecoveryEngine | null = null;

export function getRecoveryEngine(): RecoveryEngine {
  if (!recoveryEngineInstance) {
    recoveryEngineInstance = new RecoveryEngine();
  }
  return recoveryEngineInstance;
}

export function resetRecoveryEngine(): void {
  recoveryEngineInstance = null;
}
