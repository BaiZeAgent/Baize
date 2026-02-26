/**
 * 执行器测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies
vi.mock('../skills/registry', () => ({
  getSkillRegistry: () => ({
    get: vi.fn().mockReturnValue(null),
    getAll: vi.fn().mockReturnValue([]),
  }),
}));

vi.mock('../scheduler/lock', () => ({
  getLockManager: () => ({
    tryAcquire: vi.fn().mockReturnValue(true),
    release: vi.fn(),
    isLocked: vi.fn().mockReturnValue(false),
    clear: vi.fn(),
  }),
  resetLockManager: vi.fn(),
}));

vi.mock('../observability/logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../memory', () => ({
  getMemory: () => ({
    recordEpisode: vi.fn(),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
  }),
}));

vi.mock('../core/cost', () => ({
  getCostManager: () => ({
    canProceed: vi.fn().mockReturnValue(true),
    recordUsage: vi.fn(),
  }),
}));

import { ParallelExecutor, getExecutor, resetExecutor } from '../executor';

describe('ParallelExecutor', () => {
  let executor: ParallelExecutor;

  beforeEach(() => {
    resetExecutor();
    executor = getExecutor();
  });

  describe('execute', () => {
    it('应该能执行空任务列表', async () => {
      const result = await executor.execute([], [], {});
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });
  });

  describe('单例模式', () => {
    it('应该返回同一个实例', () => {
      const instance1 = getExecutor();
      const instance2 = getExecutor();
      
      expect(instance1).toBe(instance2);
    });

    it('重置后应该返回新实例', () => {
      const instance1 = getExecutor();
      resetExecutor();
      const instance2 = getExecutor();
      
      expect(instance1).not.toBe(instance2);
    });
  });
});
