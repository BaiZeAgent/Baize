/**
 * 上下文管理器 - 自动压缩与溢出处理
 *
 * 核心功能：
 * 1. Token计数与监控
 * 2. 自动压缩历史消息
 * 3. 工具结果截断
 * 4. 溢出降级处理
 *
 * 三层防御机制：
 * - 第一层：自动压缩（保留关键信息）
 * - 第二层：工具结果截断（保留首尾）
 * - 第三层：友好降级（提示用户）
 */

import { LLMMessage } from '../../types';
import { getLLMManager } from '../../llm';
import { getLogger } from '../../observability/logger';

const logger = getLogger('core:context');

/**
 * 上下文管理器运行时配置
 * 注意：与types中的ContextManagerConfig不同，这是运行时使用的简化配置
 */
export interface ContextRuntimeConfig {
  /** 硬性最小Token限制 */
  hardMinTokens: number;
  /** 警告阈值 */
  warnBelowTokens: number;
  /** 自动压缩阈值 */
  compactThreshold: number;
  /** 最大压缩尝试次数 */
  maxCompactionAttempts: number;
  /** 工具结果截断阈值 */
  toolResultTruncateThreshold: number;
  /** 保留最近对话轮数 */
  keepRecentTurns: number;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: ContextRuntimeConfig = {
  hardMinTokens: 4000,
  warnBelowTokens: 10000,
  compactThreshold: 150000,
  maxCompactionAttempts: 3,
  toolResultTruncateThreshold: 50000,
  keepRecentTurns: 4,
};

/**
 * 压缩结果
 */
export interface CompactionResult {
  /** 是否成功压缩 */
  compacted: boolean;
  /** 压缩前Token数 */
  beforeTokens: number;
  /** 压缩后Token数 */
  afterTokens: number;
  /** 压缩原因 */
  reason?: string;
}

/**
 * 溢出处理结果
 */
export interface OverflowHandleResult {
  /** 是否成功处理 */
  handled: boolean;
  /** 处理方式 */
  method: 'compaction' | 'truncation' | 'none';
  /** 处理详情 */
  details?: string;
}

/**
 * 上下文评估结果
 */
export interface ContextEvaluation {
  /** 总Token数 */
  totalTokens: number;
  /** 上下文窗口大小 */
  contextWindow: number;
  /** 利用率 */
  utilizationRatio: number;
  /** 是否需要警告 */
  shouldWarn: boolean;
  /** 是否需要压缩 */
  shouldCompact: boolean;
  /** 是否需要阻止 */
  shouldBlock: boolean;
}

/**
 * 上下文管理器
 */
export class ContextManager {
  private config: ContextRuntimeConfig;
  private llm = getLLMManager();
  private compactionAttempts: number = 0;

  constructor(config: Partial<ContextRuntimeConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 评估上下文状态
   */
  evaluate(messages: LLMMessage[], contextWindow: number): ContextEvaluation {
    const totalTokens = this.estimateTotalTokens(messages);

    return {
      totalTokens,
      contextWindow,
      utilizationRatio: totalTokens / contextWindow,
      shouldWarn: totalTokens > contextWindow - this.config.warnBelowTokens,
      shouldCompact: totalTokens > this.config.compactThreshold,
      shouldBlock: totalTokens > contextWindow - this.config.hardMinTokens,
    };
  }

  /**
   * 处理上下文溢出
   */
  async handleOverflow(
    messages: LLMMessage[],
    contextWindow: number
  ): Promise<OverflowHandleResult> {
    const evaluation = this.evaluate(messages, contextWindow);

    if (!evaluation.shouldCompact) {
      return { handled: false, method: 'none' };
    }

    logger.warn(`[context-overflow] tokens=${evaluation.totalTokens} max=${contextWindow}`);

    // 第一层：尝试自动压缩
    if (this.compactionAttempts < this.config.maxCompactionAttempts) {
      const result = await this.compact(messages);
      if (result.compacted) {
        this.compactionAttempts++;
        logger.info(`[context-compacted] before=${result.beforeTokens} after=${result.afterTokens}`);
        return {
          handled: true,
          method: 'compaction',
          details: `压缩 ${result.beforeTokens} → ${result.afterTokens} tokens`,
        };
      }
    }

    // 第二层：尝试工具结果截断
    const truncated = this.truncateToolResults(messages);
    if (truncated.truncated) {
      logger.info(`[context-truncated] count=${truncated.count}`);
      return {
        handled: true,
        method: 'truncation',
        details: `截断 ${truncated.count} 个工具结果`,
      };
    }

    // 第三层：无法处理
    return { handled: false, method: 'none' };
  }

  /**
   * 压缩历史消息
   */
  async compact(messages: LLMMessage[]): Promise<CompactionResult> {
    const beforeTokens = this.estimateTotalTokens(messages);

    // 保留最近N轮对话
    const recentMessages = messages.slice(-this.config.keepRecentTurns * 2);
    const oldMessages = messages.slice(0, -this.config.keepRecentTurns * 2);

    if (oldMessages.length === 0) {
      return { compacted: false, beforeTokens, afterTokens: beforeTokens };
    }

    // 生成摘要
    const summary = await this.generateSummary(oldMessages);

    // 构建压缩后的消息
    const compacted: LLMMessage[] = [
      {
        role: 'system',
        content: `[历史摘要] ${summary}`,
      },
      ...recentMessages,
    ];

    const afterTokens = this.estimateTotalTokens(compacted);

    // 替换原数组内容
    messages.length = 0;
    messages.push(...compacted);

    return {
      compacted: afterTokens < beforeTokens,
      beforeTokens,
      afterTokens,
      reason: `压缩 ${oldMessages.length} 条消息为摘要`,
    };
  }

  /**
   * 生成历史摘要
   */
  private async generateSummary(messages: LLMMessage[]): Promise<string> {
    const content = messages
      .map((m) => `[${m.role}]: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
      .join('\n');

    try {
      const response = await this.llm.chat([
        {
          role: 'system',
          content: '请将以下对话历史压缩为简洁的摘要，保留关键决策和结果。',
        },
        { role: 'user', content },
      ], { temperature: 0.3, maxTokens: 500 });

      return response.content;
    } catch (error) {
      logger.error(`[summary-error] ${error}`);
      return '历史对话摘要生成失败';
    }
  }

  /**
   * 截断工具结果
   */
  private truncateToolResults(messages: LLMMessage[]): { truncated: boolean; count: number } {
    let count = 0;
    const threshold = this.config.toolResultTruncateThreshold;

    for (const message of messages) {
      if (message.role === 'user' && typeof message.content === 'string') {
        // 检测是否是工具结果
        if (message.content.includes('tool_result') || message.content.length > threshold * 4) {
          const tokens = this.estimateTokens(message.content);
          if (tokens > threshold) {
            // 截断：保留开头40% + 结尾40%
            const content = message.content;
            const headLength = Math.floor(content.length * 0.4);
            const tailLength = Math.floor(content.length * 0.4);
            const head = content.slice(0, headLength);
            const tail = content.slice(-tailLength);
            message.content = `${head}\n\n... [已截断 ${content.length - headLength - tailLength} 字符] ...\n\n${tail}`;
            count++;
          }
        }
      }
    }

    return { truncated: count > 0, count };
  }

  /**
   * 估算总Token数
   */
  estimateTotalTokens(messages: LLMMessage[]): number {
    return messages.reduce((sum, msg) => sum + this.estimateMessageTokens(msg), 0);
  }

  /**
   * 估算单条消息Token数
   * 简化算法：中文约1.5字符/token，英文约4字符/token
   */
  private estimateMessageTokens(message: LLMMessage): number {
    const content = typeof message.content === 'string' 
      ? message.content 
      : JSON.stringify(message.content);
    return this.estimateTokens(content);
  }

  /**
   * 估算Token数
   */
  private estimateTokens(text: string): number {
    // 简化算法：平均3字符/token
    return Math.ceil(text.length / 3);
  }

  /**
   * 重置压缩尝试计数
   */
  resetCompactionAttempts(): void {
    this.compactionAttempts = 0;
  }

  /**
   * 获取友好提示消息
   */
  getOverflowMessage(): string {
    return '对话内容过长，建议使用 /reset 开始新会话，或使用 /compact 压缩历史。';
  }
}

// 全局实例
let contextManagerInstance: ContextManager | null = null;

/**
 * 获取上下文管理器实例
 */
export function getContextManager(): ContextManager {
  if (!contextManagerInstance) {
    contextManagerInstance = new ContextManager();
  }
  return contextManagerInstance;
}

/**
 * 重置上下文管理器实例（测试用）
 */
export function resetContextManager(): void {
  contextManagerInstance = null;
}
