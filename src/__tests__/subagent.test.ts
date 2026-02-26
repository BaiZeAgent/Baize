/**
 * 子Agent管理器测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SubAgentManager, SubAgentStatus, SubAgentType } from '../executor/subagent';

describe('SubAgentManager', () => {
  let manager: SubAgentManager;

  beforeEach(() => {
    manager = new SubAgentManager();
  });

  afterEach(() => {
    manager.cleanup();
  });

  describe('创建子Agent', () => {
    it('应该能创建同步子Agent', async () => {
      const info = await manager.create({
        type: SubAgentType.SYNC,
        name: 'test-agent',
        tasks: [],
        parallelGroups: [],
        context: {},
      });

      expect(info.id).toBeDefined();
      expect(info.status).toBe(SubAgentStatus.PENDING);
    });

    it('应该能创建异步子Agent', async () => {
      const info = await manager.create({
        type: SubAgentType.ASYNC,
        name: 'test-agent',
        tasks: [],
        parallelGroups: [],
        context: {},
      });

      expect(info.id).toBeDefined();
      expect(info.status).toBe(SubAgentStatus.PENDING);
    });

    it('应该能创建独立子Agent', async () => {
      const info = await manager.create({
        type: SubAgentType.INDEPENDENT,
        name: 'test-agent',
        tasks: [],
        parallelGroups: [],
        context: {},
      });

      expect(info.id).toBeDefined();
      expect(info.status).toBe(SubAgentStatus.PENDING);
    });
  });

  describe('状态查询', () => {
    it('应该能查询子Agent状态', async () => {
      const info = await manager.create({
        type: SubAgentType.SYNC,
        name: 'test-agent',
        tasks: [],
        parallelGroups: [],
        context: {},
      });

      const status = manager.getStatus(info.id);
      expect(status).toBeDefined();
      expect(status?.id).toBe(info.id);
    });

    it('查询不存在的子Agent应该返回undefined', () => {
      const status = manager.getStatus('nonexistent');
      expect(status).toBeUndefined();
    });
  });

  describe('取消', () => {
    it('应该能取消子Agent', async () => {
      const info = await manager.create({
        type: SubAgentType.SYNC,
        name: 'test-agent',
        tasks: [],
        parallelGroups: [],
        context: {},
      });

      const cancelled = await manager.cancel(info.id);
      expect(cancelled).toBe(true);
      
      const status = manager.getStatus(info.id);
      expect(status?.status).toBe(SubAgentStatus.CANCELLED);
    });

    it('取消不存在的子Agent应该返回false', async () => {
      const cancelled = await manager.cancel('nonexistent');
      expect(cancelled).toBe(false);
    });
  });

  describe('获取列表', () => {
    it('应该能获取所有子Agent', async () => {
      await manager.create({
        type: SubAgentType.SYNC,
        name: 'agent-1',
        tasks: [],
        parallelGroups: [],
        context: {},
      });
      await manager.create({
        type: SubAgentType.SYNC,
        name: 'agent-2',
        tasks: [],
        parallelGroups: [],
        context: {},
      });

      const all = manager.getAll();
      expect(all.length).toBe(2);
    });

    it('应该能获取运行中的子Agent', async () => {
      await manager.create({
        type: SubAgentType.SYNC,
        name: 'agent-1',
        tasks: [],
        parallelGroups: [],
        context: {},
      });

      const running = manager.getRunning();
      expect(running.length).toBe(1);
    });
  });

  describe('清理', () => {
    it('应该能清理已完成的子Agent', async () => {
      const info = await manager.create({
        type: SubAgentType.SYNC,
        name: 'agent-1',
        tasks: [],
        parallelGroups: [],
        context: {},
      });
      
      await manager.cancel(info.id);
      const cleaned = manager.cleanup();
      
      expect(cleaned).toBeGreaterThanOrEqual(1);
    });
  });
});
