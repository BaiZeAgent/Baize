/**
 * 上下文管理器 - Token预算管理
 * 
 * 第十二章 上下文管理
 * 
 * 功能：
 * 1. Token预算分配
 * 2. 上下文窗口管理
 * 3. 滑动窗口机制
 * 4. Token计数
 */

import { getLogger } from '../../observability/logger';
import { TokenBudget, ContextEntry, ContextWindow, ContextManagerConfig } from '../../types';

const logger = getLogger('context:manager');

/**
 * 默认配置
 */
const DEFAULT_CONFIG: ContextManagerConfig = {
  maxTokens: 4096,
  systemRatio: 0.15,      // 15% for system prompt
  contextRatio: 0.25,     // 25% for context history
  currentRatio: 0.50,     // 50% for current task
  reservedRatio: 0.10,    // 10% reserved
  compressionThreshold: 0.8,
  slidingWindowSize: 10,
};

/**
 * 上下文管理器
 */
export class ContextManager {
  private config: ContextManagerConfig;
  private budget: TokenBudget;
  private currentWindow: ContextWindow | null = null;
  private windows: Map<string, ContextWindow> = new Map();

  constructor(config: Partial<ContextManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.budget = this.calculateBudget();
    logger.info('上下文管理器初始化', { 
      maxTokens: this.config.maxTokens,
      budget: this.budget 
    });
  }

  /**
   * 计算Token预算
   */
  private calculateBudget(): TokenBudget {
    const { maxTokens, systemRatio, contextRatio, currentRatio, reservedRatio } = this.config;
    
    return {
      total: maxTokens,
      system: Math.floor(maxTokens * systemRatio),
      context: Math.floor(maxTokens * contextRatio),
      current: Math.floor(maxTokens * currentRatio),
      reserved: Math.floor(maxTokens * reservedRatio),
    };
  }

  /**
   * 获取当前预算
   */
  getBudget(): TokenBudget {
    return { ...this.budget };
  }

  /**
   * 创建新的上下文窗口
   */
  createWindow(conversationId: string): ContextWindow {
    const window: ContextWindow = {
      id: `window_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      entries: [],
      totalTokens: 0,
      budget: { ...this.budget },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.windows.set(conversationId, window);
    this.currentWindow = window;
    
    logger.debug(`创建上下文窗口: ${window.id}`);
    return window;
  }

  /**
   * 获取当前窗口
   */
  getCurrentWindow(): ContextWindow | null {
    return this.currentWindow;
  }

  /**
   * 获取指定会话的窗口
   */
  getWindow(conversationId: string): ContextWindow | null {
    return this.windows.get(conversationId) || null;
  }

  /**
   * 添加条目到上下文
   */
  addEntry(
    type: ContextEntry['type'],
    content: string,
    options: { importance?: number; compressible?: boolean } = {}
  ): ContextEntry {
    if (!this.currentWindow) {
      this.createWindow('default');
    }

    const tokens = this.countTokens(content);
    const entry: ContextEntry = {
      id: `entry_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      content,
      tokens,
      timestamp: new Date(),
      importance: options.importance ?? 0.5,
      compressible: options.compressible ?? true,
    };

    // 检查是否需要压缩
    if (this.shouldCompress()) {
      this.compress();
    }

    this.currentWindow!.entries.push(entry);
    this.currentWindow!.totalTokens += tokens;
    this.currentWindow!.updatedAt = new Date();

    logger.debug(`添加上下文条目: ${type}, ${tokens} tokens`);
    return entry;
  }

  /**
   * 检查是否需要压缩
   */
  private shouldCompress(): boolean {
    if (!this.currentWindow) return false;
    
    const usageRatio = this.currentWindow.totalTokens / this.budget.context;
    return usageRatio >= this.config.compressionThreshold;
  }

  /**
   * 压缩上下文
   */
  compress(): void {
    if (!this.currentWindow || this.currentWindow!.entries.length === 0) return;

    logger.info('开始压缩上下文', { 
      entries: this.currentWindow!.entries.length,
      tokens: this.currentWindow!.totalTokens 
    });

    // 滑动窗口：保留最近的N个条目
    const windowSize = this.config.slidingWindowSize;
    const entries = this.currentWindow!.entries;
    
    if (entries.length > windowSize) {
      // 计算需要移除的条目
      const toRemove = entries.length - windowSize;
      let removedTokens = 0;

      // 按重要性排序，移除低重要性且可压缩的条目
      const sortedEntries = [...entries]
        .map((e, i) => ({ ...e, index: i }))
        .filter(e => e.compressible)
        .sort((a, b) => a.importance - b.importance);

      const removeIndices = new Set<number>();
      for (let i = 0; i < Math.min(toRemove, sortedEntries.length); i++) {
        removeIndices.add(sortedEntries[i].index);
        removedTokens += sortedEntries[i].tokens;
      }

      // 过滤保留的条目
      this.currentWindow!.entries = entries.filter((_, i) => !removeIndices.has(i));
      this.currentWindow!.totalTokens -= removedTokens;
      this.currentWindow!.updatedAt = new Date();

      logger.info('上下文压缩完成', {
        removed: removeIndices.size,
        removedTokens,
        remaining: this.currentWindow!.entries.length,
        currentTokens: this.currentWindow!.totalTokens
      });
    }
  }

  /**
   * 构建LLM消息列表
   */
  buildMessages(systemPrompt: string): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];

    // 添加系统提示词
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    // 添加上下文条目
    if (this.currentWindow) {
      for (const entry of this.currentWindow.entries) {
        const role = this.mapTypeToRole(entry.type);
        messages.push({ role, content: entry.content });
      }
    }

    return messages;
  }

  /**
   * 映射条目类型到消息角色
   */
  private mapTypeToRole(type: ContextEntry['type']): string {
    switch (type) {
      case 'user': return 'user';
      case 'assistant': return 'assistant';
      case 'system': return 'system';
      case 'tool': return 'tool';
      case 'thought': return 'assistant';
      default: return 'user';
    }
  }

  /**
   * 计算Token数量
   * 简化实现：按字符数估算
   */
  countTokens(text: string): number {
    if (!text) return 0;
    
    // 简化估算：中文约1.5字符/token，英文约4字符/token
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;
    
    return Math.ceil(chineseChars / 1.5 + otherChars / 4);
  }

  /**
   * 检查是否超预算
   */
  isOverBudget(additionalTokens: number = 0): boolean {
    if (!this.currentWindow) return false;
    
    const total = this.currentWindow.totalTokens + additionalTokens;
    return total > this.budget.context;
  }

  /**
   * 获取剩余Token预算
   */
  getRemainingTokens(): number {
    if (!this.currentWindow) return this.budget.context;
    return Math.max(0, this.budget.context - this.currentWindow.totalTokens);
  }

  /**
   * 获取使用统计
   */
  getStats(): {
    totalEntries: number;
    totalTokens: number;
    budgetUsage: number;
    remainingTokens: number;
  } {
    const entries = this.currentWindow?.entries.length || 0;
    const tokens = this.currentWindow?.totalTokens || 0;
    const budget = this.budget.context;

    return {
      totalEntries: entries,
      totalTokens: tokens,
      budgetUsage: Math.round((tokens / budget) * 100),
      remainingTokens: Math.max(0, budget - tokens),
    };
  }

  /**
   * 清空当前窗口
   */
  clear(): void {
    if (this.currentWindow) {
      this.currentWindow.entries = [];
      this.currentWindow.totalTokens = 0;
      this.currentWindow.updatedAt = new Date();
      logger.debug('上下文窗口已清空');
    }
  }

  /**
   * 清空所有窗口
   */
  clearAll(): void {
    this.windows.clear();
    this.currentWindow = null;
    logger.debug('所有上下文窗口已清空');
  }
}

// 全局实例
let contextManager: ContextManager | null = null;

export function getContextManager(config?: Partial<ContextManagerConfig>): ContextManager {
  if (!contextManager) {
    contextManager = new ContextManager(config);
  }
  return contextManager;
}

export function resetContextManager(): void {
  contextManager = null;
}
