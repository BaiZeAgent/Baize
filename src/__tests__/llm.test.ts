/**
 * LLM管理器测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock LLM Manager
vi.mock('../llm', () => ({
  getLLMManager: () => ({
    getAvailableProviders: () => ['ollama'],
    getDefaultProvider: () => ({ getName: () => 'ollama', getModel: () => 'llama2' }),
    getProvider: (name: string) => name === 'ollama' ? { getName: () => 'ollama' } : undefined,
    getProviderForTask: () => 'ollama',
    checkAvailability: async () => true,
    chat: vi.fn().mockResolvedValue({
      content: '测试响应',
      usage: { promptTokens: 10, completionTokens: 5 },
    }),
  }),
  initLLMManager: vi.fn(),
}));

import { LLMManager, getLLMManager } from '../llm';

describe('LLMManager', () => {
  let llm: ReturnType<typeof getLLMManager>;

  beforeEach(() => {
    llm = getLLMManager();
  });

  describe('getAvailableProviders', () => {
    it('应该能获取可用提供商列表', () => {
      const providers = llm.getAvailableProviders();
      expect(Array.isArray(providers)).toBe(true);
      expect(providers).toContain('ollama');
    });
  });

  describe('getDefaultProvider', () => {
    it('应该能获取默认提供商', () => {
      const provider = llm.getDefaultProvider();
      expect(provider).toBeDefined();
      expect(provider?.getName()).toBe('ollama');
    });
  });

  describe('getProvider', () => {
    it('应该能获取指定提供商', () => {
      const provider = llm.getProvider('ollama');
      expect(provider).toBeDefined();
    });

    it('不存在的提供商应该返回undefined', () => {
      const provider = llm.getProvider('non-existent');
      expect(provider).toBeUndefined();
    });
  });

  describe('getProviderForTask', () => {
    it('应该能根据任务类型选择提供商', () => {
      const provider = llm.getProviderForTask('chat');
      expect(typeof provider).toBe('string');
    });
  });

  describe('checkAvailability', () => {
    it('应该能检查提供商可用性', async () => {
      const available = await llm.checkAvailability('ollama');
      expect(available).toBe(true);
    });
  });

  describe('chat', () => {
    it('应该能发送聊天请求', async () => {
      const response = await llm.chat([
        { role: 'user', content: '你好' }
      ]);
      
      expect(response).toBeDefined();
      expect(response.content).toBe('测试响应');
    });
  });
});
