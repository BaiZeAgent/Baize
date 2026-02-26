/**
 * 调度器测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies
vi.mock('../executor', () => ({
  getExecutor: () => ({
    execute: vi.fn().mockResolvedValue({ success: true, results: [] }),
    getStats: () => ({ totalExecutions: 0, successfulExecutions: 0, failedExecutions: 0 }),
    clear: vi.fn(),
  }),
  resetExecutor: vi.fn(),
}));

vi.mock('../memory', () => ({
  getMemory: () => ({
    recordEpisode: vi.fn(),
    getEpisodes: vi.fn().mockReturnValue([]),
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

import { Scheduler, getScheduler, resetScheduler } from '../scheduler';
import { TaskStatus, RiskLevel } from '../types';

describe('Scheduler', () => {
  let scheduler: Scheduler;

  beforeEach(() => {
    resetScheduler();
    scheduler = getScheduler();
  });

  describe('schedule', () => {
    it('应该能调度任务', () => {
      const task = {
        id: 'test-task',
        description: '测试任务',
        type: 'test',
        params: {},
        riskLevel: RiskLevel.LOW,
        dependencies: [],
      };

      const scheduledId = scheduler.schedule(task);
      expect(scheduledId).toBeDefined();
    });

    it('应该能获取任务状态', () => {
      const task = {
        id: 'test-task',
        description: '测试任务',
        type: 'test',
        params: {},
        riskLevel: RiskLevel.LOW,
        dependencies: [],
      };

      const scheduledId = scheduler.schedule(task);
      const status = scheduler.getStatus(scheduledId);
      
      expect(status).toBeDefined();
      expect(status?.status).toBe(TaskStatus.PENDING);
    });

    it('应该能调度多个任务', () => {
      for (let i = 0; i < 5; i++) {
        scheduler.schedule({
          id: `task-${i}`,
          description: `任务${i}`,
          type: 'test',
          params: {},
          riskLevel: RiskLevel.LOW,
          dependencies: [],
        });
      }

      const stats = scheduler.getStats();
      expect(stats.total).toBe(5);
    });
  });

  describe('cancel', () => {
    it('应该能取消任务', () => {
      const scheduledId = scheduler.schedule({
        id: 'test-task',
        description: '测试任务',
        type: 'test',
        params: {},
        riskLevel: RiskLevel.LOW,
        dependencies: [],
      });

      const cancelled = scheduler.cancel(scheduledId);
      expect(cancelled).toBe(true);

      const status = scheduler.getStatus(scheduledId);
      expect(status?.status).toBe(TaskStatus.CANCELLED);
    });

    it('取消不存在的任务应该返回false', () => {
      const cancelled = scheduler.cancel('non-existent');
      expect(cancelled).toBe(false);
    });
  });

  describe('getStats', () => {
    it('应该能返回统计信息', () => {
      scheduler.schedule({
        id: 'task-1',
        description: '任务1',
        type: 'test',
        params: {},
        riskLevel: RiskLevel.LOW,
        dependencies: [],
      });

      const stats = scheduler.getStats();
      
      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('pending');
      expect(stats).toHaveProperty('running');
      expect(stats).toHaveProperty('completed');
      expect(stats).toHaveProperty('failed');
      expect(stats).toHaveProperty('cancelled');
    });
  });

  describe('clear', () => {
    it('应该能清除所有任务', () => {
      for (let i = 0; i < 5; i++) {
        scheduler.schedule({
          id: `task-${i}`,
          description: `任务${i}`,
          type: 'test',
          params: {},
          riskLevel: RiskLevel.LOW,
          dependencies: [],
        });
      }

      scheduler.clear();
      
      const stats = scheduler.getStats();
      expect(stats.total).toBe(0);
    });
  });
});
