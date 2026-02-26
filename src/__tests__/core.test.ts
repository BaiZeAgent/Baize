/**
 * 白泽核心模块测试
 * 
 * 测试内容：
 * 1. 模块加载测试
 * 2. 实例化测试
 * 3. 基础功能测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 模拟环境变量
vi.mock('process.env', () => ({
  ALIYUN_API_KEY: 'test-key',
  ZHIPU_API_KEY: 'test-key',
}));

describe('白泽核心模块', () => {
  describe('模块加载', () => {
    it('应该能加载主模块', async () => {
      const baize = await import('../index');
      expect(baize).toBeDefined();
      expect(Object.keys(baize).length).toBeGreaterThan(50);
    });

    it('应该导出所有核心类', async () => {
      const baize = await import('../index');
      
      // 核心类
      expect(baize.SandboxManager).toBeDefined();
      expect(baize.ProcessManager).toBeDefined();
      expect(baize.VectorSearchManager).toBeDefined();
      expect(baize.SubAgentManager).toBeDefined();
      expect(baize.SmartRouter).toBeDefined();
      expect(baize.ContextManager).toBeDefined();
      expect(baize.ErrorRecoveryManager).toBeDefined();
      expect(baize.ThinkingEngine).toBeDefined();
      expect(baize.ParallelExecutor).toBeDefined();
      expect(baize.ResourceLockManager).toBeDefined();
    });

    it('应该导出所有获取函数', async () => {
      const baize = await import('../index');
      
      // 获取函数
      expect(typeof baize.getSandboxManager).toBe('function');
      expect(typeof baize.getProcessManager).toBe('function');
      expect(typeof baize.getVectorSearch).toBe('function');
      expect(typeof baize.getSubAgentManager).toBe('function');
      expect(typeof baize.getSmartRouter).toBe('function');
      expect(typeof baize.getContextManager).toBe('function');
      expect(typeof baize.getRecoveryManager).toBe('function');
      expect(typeof baize.getThinkingEngine).toBe('function');
      expect(typeof baize.getExecutor).toBe('function');
      expect(typeof baize.getLockManager).toBe('function');
      expect(typeof baize.getMemory).toBe('function');
      expect(typeof baize.getSkillRegistry).toBe('function');
      expect(typeof baize.getLLMManager).toBe('function');
      expect(typeof baize.getScheduler).toBe('function');
    });

    it('应该导出所有枚举', async () => {
      const baize = await import('../index');
      
      // 枚举
      expect(baize.TaskStatus).toBeDefined();
      expect(baize.RiskLevel).toBeDefined();
      expect(baize.SubAgentStatus).toBeDefined();
      expect(baize.SubAgentType).toBeDefined();
      expect(baize.ErrorCategory).toBeDefined();
      expect(baize.ErrorSeverity).toBeDefined();
      expect(baize.ErrorKind).toBeDefined();
    });
  });

  describe('单例模式', () => {
    it('getSandboxManager 应该返回单例', async () => {
      const baize = await import('../index');
      const instance1 = baize.getSandboxManager();
      const instance2 = baize.getSandboxManager();
      expect(instance1).toBe(instance2);
    });

    it('getProcessManager 应该返回单例', async () => {
      const baize = await import('../index');
      const instance1 = baize.getProcessManager();
      const instance2 = baize.getProcessManager();
      expect(instance1).toBe(instance2);
    });

    it('getVectorSearch 应该返回单例', async () => {
      const baize = await import('../index');
      const instance1 = baize.getVectorSearch();
      const instance2 = baize.getVectorSearch();
      expect(instance1).toBe(instance2);
    });

    it('getLockManager 应该返回单例', async () => {
      const baize = await import('../index');
      const instance1 = baize.getLockManager();
      const instance2 = baize.getLockManager();
      expect(instance1).toBe(instance2);
    });
  });

  describe('重置函数', () => {
    it('应该有 resetSandboxManager', async () => {
      const baize = await import('../index');
      expect(typeof baize.resetSandboxManager).toBe('function');
    });

    it('应该有 resetProcessManager', async () => {
      const baize = await import('../index');
      expect(typeof baize.resetProcessManager).toBe('function');
    });

    it('应该有 resetVectorSearch', async () => {
      const baize = await import('../index');
      expect(typeof baize.resetVectorSearch).toBe('function');
    });

    it('应该有 resetLockManager', async () => {
      const baize = await import('../index');
      expect(typeof baize.resetLockManager).toBe('function');
    });
  });
});
