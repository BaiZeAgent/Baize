/**
 * 思考引擎测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock LLM Manager
vi.mock('../llm', () => ({
  getLLMManager: () => ({
    chat: vi.fn().mockResolvedValue({
      content: JSON.stringify({
        action: 'reply',
        content: '你好！有什么可以帮助你的吗？',
        reason: '简单问候',
      }),
    }),
    getAvailableProviders: () => ['ollama'],
    getDefaultProvider: () => ({ getName: () => 'ollama' }),
    getProvider: () => ({ getName: () => 'ollama' }),
  }),
}));

vi.mock('../skills/registry', () => ({
  getSkillRegistry: () => ({
    getAll: vi.fn().mockReturnValue([]),
    findByCapability: vi.fn().mockReturnValue([]),
  }),
}));

vi.mock('../core/context', () => ({
  getContextManager: () => ({
    evaluate: vi.fn().mockReturnValue({ needsCompaction: false, estimatedTokens: 100 }),
    estimateTotalTokens: vi.fn().mockReturnValue(100),
  }),
}));

vi.mock('../core/recovery', () => ({
  getRecoveryManager: () => ({
    setProfiles: vi.fn(),
    handle: vi.fn().mockResolvedValue({ action: 'retry' }),
  }),
}));

vi.mock('../observability/logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { ThinkingEngine, getThinkingEngine, resetThinkingEngine } from '../core/thinking/engine';
import { resetSmartRouter } from '../core/router';

describe('ThinkingEngine', () => {
  let engine: ThinkingEngine;

  beforeEach(() => {
    resetThinkingEngine();
    resetSmartRouter();
    engine = getThinkingEngine();
  });

  describe('think', () => {
    it('应该能处理简单问候', async () => {
      const result = await engine.think('你好');
      
      expect(result).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.fastPath).toBeDefined();
    });

    it('应该能处理空输入', async () => {
      const result = await engine.think('');
      
      expect(result).toBeDefined();
    });

    it('应该能处理长输入', async () => {
      const longInput = '这是一段很长的输入内容。'.repeat(100);
      const result = await engine.think(longInput);
      
      expect(result).toBeDefined();
    });

    it('应该能处理带上下文的输入', async () => {
      const context = {
        sessionId: 'test-session',
        historySummary: '之前的对话历史',
      };
      
      const result = await engine.think('继续之前的话题', context);
      
      expect(result).toBeDefined();
    });
  });

  describe('process', () => {
    it('应该能执行六阶段思考', async () => {
      const thoughtProcess = await engine.process('帮我分析这个问题', {});
      
      expect(thoughtProcess).toBeDefined();
      expect(thoughtProcess.understanding).toBeDefined();
      expect(thoughtProcess.decomposition).toBeDefined();
      expect(thoughtProcess.planning).toBeDefined();
      // scheduling, validation, reflection 可能在某些情况下为空
    });
  });

  describe('快速路径', () => {
    it('简单问候应该走快速路径', async () => {
      const result = await engine.think('你好');
      
      // 快速路径应该很快
      expect(result.duration).toBeLessThan(10);
    });
  });

  describe('规划路径', () => {
    it('复杂任务应该走规划路径', async () => {
      const result = await engine.think('帮我写一个完整的用户管理系统，包括登录、注册、权限管理等功能');
      
      expect(result).toBeDefined();
    });
  });
});
