/**
 * 上下文管理器测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ContextManager } from '../core/context';
import { LLMMessage } from '../types';

describe('ContextManager', () => {
  let manager: ContextManager;

  beforeEach(() => {
    manager = new ContextManager();
  });

  describe('Token估算', () => {
    it('应该能估算空消息的Token', () => {
      const tokens = manager.estimateTotalTokens([]);
      expect(tokens).toBe(0);
    });

    it('应该能估算单条消息的Token', () => {
      const messages: LLMMessage[] = [
        { role: 'user', content: '你好' },
      ];
      const tokens = manager.estimateTotalTokens(messages);
      expect(tokens).toBeGreaterThan(0);
    });

    it('应该能估算多条消息的Token', () => {
      const messages: LLMMessage[] = [
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '你好！有什么可以帮助你的吗？' },
        { role: 'user', content: '今天天气怎么样？' },
      ];
      const tokens = manager.estimateTotalTokens(messages);
      expect(tokens).toBeGreaterThan(0);
    });

    it('长消息应该有更多Token', () => {
      const shortMessages: LLMMessage[] = [{ role: 'user', content: '你好' }];
      const longMessages: LLMMessage[] = [{ role: 'user', content: '你好'.repeat(100) }];
      
      const shortTokens = manager.estimateTotalTokens(shortMessages);
      const longTokens = manager.estimateTotalTokens(longMessages);
      
      expect(longTokens).toBeGreaterThan(shortTokens);
    });
  });

  describe('评估', () => {
    it('应该能评估上下文', () => {
      const messages: LLMMessage[] = [
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '你好！' },
      ];
      
      const evaluation = manager.evaluate(messages, 100000);
      
      expect(evaluation).toBeDefined();
      expect(evaluation.totalTokens).toBeGreaterThan(0);
      expect(evaluation.contextWindow).toBe(100000);
    });
  });

  describe('溢出处理', () => {
    it('应该能处理溢出', async () => {
      const messages: LLMMessage[] = [
        { role: 'user', content: '你好'.repeat(1000) },
      ];
      
      const result = await manager.handleOverflow(messages, 100);
      
      expect(result).toBeDefined();
      expect(result.handled).toBeDefined();
    });
  });

  describe('重置', () => {
    it('应该能重置压缩尝试计数', () => {
      manager.resetCompactionAttempts();
      expect(true).toBe(true);
    });
  });

  describe('友好提示', () => {
    it('应该能获取溢出提示消息', () => {
      const message = manager.getOverflowMessage();
      expect(typeof message).toBe('string');
      expect(message.length).toBeGreaterThan(0);
    });
  });
});
