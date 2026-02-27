/**
 * 上下文管理系统
 */

import { getLogger } from '../observability/logger';

const logger = getLogger('context');

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
}

export interface Tokenizer {
  countTokens(text: string): number;
  countMessagesTokens(messages: Message[]): number;
}

export interface ContextWindowConfig {
  maxTokens: number;
  warnThreshold: number;
  compactThreshold: number;
  reserveTokens: number;
}

export interface ContextWindowStatus {
  currentTokens: number;
  maxTokens: number;
  usagePercent: number;
  shouldWarn: boolean;
  shouldCompact: boolean;
  availableTokens: number;
}

export type CompressionStrategy = 'summary' | 'truncate' | 'sliding' | 'hybrid';

export interface CompressionConfig {
  strategy: CompressionStrategy;
  targetRatio: number;
  preserveRecent: number;
  preserveSystem: boolean;
}

export const DEFAULT_CONTEXT_CONFIG: ContextWindowConfig = {
  maxTokens: 128000,
  warnThreshold: 0.8,
  compactThreshold: 0.9,
  reserveTokens: 4000,
};

export const DEFAULT_COMPRESSION_CONFIG: CompressionConfig = {
  strategy: 'hybrid',
  targetRatio: 0.5,
  preserveRecent: 4,
  preserveSystem: true,
};

export class SimpleTokenizer implements Tokenizer {
  private avgCharsPerToken: number;
  
  constructor(options?: { language?: 'en' | 'zh' | 'mixed' }) {
    this.avgCharsPerToken = options?.language === 'en' ? 4 : options?.language === 'zh' ? 1.5 : 2.5;
  }
  
  countTokens(text: string): number {
    if (!text) return 0;
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return Math.ceil(chineseChars / 1.5) + Math.ceil(otherChars / 4);
  }
  
  countMessagesTokens(messages: Message[]): number {
    let total = 3;
    for (const msg of messages) {
      total += 4 + this.countTokens(msg.role) + this.countTokens(msg.content);
      if (msg.name) total += this.countTokens(msg.name);
    }
    return total;
  }
}

export class ContextWindowGuard {
  constructor(
    private config: ContextWindowConfig = DEFAULT_CONTEXT_CONFIG,
    private tokenizer: Tokenizer = new SimpleTokenizer()
  ) {}
  
  check(messages: Message[]): ContextWindowStatus {
    const currentTokens = this.tokenizer.countMessagesTokens(messages);
    const availableTokens = this.config.maxTokens - currentTokens - this.config.reserveTokens;
    const usagePercent = currentTokens / this.config.maxTokens;
    return {
      currentTokens,
      maxTokens: this.config.maxTokens,
      usagePercent: Math.round(usagePercent * 100),
      shouldWarn: usagePercent >= this.config.warnThreshold,
      shouldCompact: usagePercent >= this.config.compactThreshold,
      availableTokens: Math.max(0, availableTokens),
    };
  }
}

export class ContextCompressor {
  constructor(
    private config: CompressionConfig = DEFAULT_COMPRESSION_CONFIG,
    private tokenizer: Tokenizer = new SimpleTokenizer()
  ) {}
  
  async compress(messages: Message[], targetTokens?: number): Promise<Message[]> {
    if (messages.length === 0) return messages;
    const target = targetTokens || Math.floor(this.tokenizer.countMessagesTokens(messages) * this.config.targetRatio);
    return this.compressByTruncate(messages, target);
  }
  
  private compressByTruncate(messages: Message[], targetTokens: number): Message[] {
    const result: Message[] = [];
    const systemMessages = messages.filter(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');
    result.push(...systemMessages);
    const recentMessages = otherMessages.slice(-this.config.preserveRecent);
    result.push(...recentMessages);
    return result;
  }
}

export class ContextManager {
  private guard: ContextWindowGuard;
  private compressor: ContextCompressor;
  private messages: Message[] = [];
  private tokenizer: Tokenizer;
  
  constructor() {
    this.tokenizer = new SimpleTokenizer();
    this.guard = new ContextWindowGuard(DEFAULT_CONTEXT_CONFIG, this.tokenizer);
    this.compressor = new ContextCompressor(DEFAULT_COMPRESSION_CONFIG, this.tokenizer);
  }
  
  async addMessage(message: Message): Promise<void> {
    this.messages.push(message);
    const status = this.guard.check(this.messages);
    if (status.shouldCompact) {
      await this.compact();
    }
  }
  
  getMessages(): Message[] { return [...this.messages]; }
  
  async compact(): Promise<void> {
    this.messages = await this.compressor.compress(this.messages);
  }
  
  getStatus(): ContextWindowStatus {
    return this.guard.check(this.messages);
  }
  
  clear(): void { this.messages = []; }
}

let globalTokenizer: Tokenizer | null = null;
let globalContextManager: ContextManager | null = null;

export function getTokenizer(): Tokenizer {
  if (!globalTokenizer) globalTokenizer = new SimpleTokenizer();
  return globalTokenizer;
}

export function getContextManager(): ContextManager {
  if (!globalContextManager) globalContextManager = new ContextManager();
  return globalContextManager;
}

export function resetContext(): void {
  globalTokenizer = null;
  globalContextManager = null;
}

export function countTokens(text: string): number {
  return getTokenizer().countTokens(text);
}

export function countMessagesTokens(messages: Message[]): number {
  return getTokenizer().countMessagesTokens(messages);
}
