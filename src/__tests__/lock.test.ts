/**
 * 锁管理器测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ResourceLockManager } from '../scheduler/lock';

describe('ResourceLockManager', () => {
  let manager: ResourceLockManager;

  beforeEach(() => {
    manager = new ResourceLockManager();
  });

  describe('tryAcquire', () => {
    it('应该能获取锁', () => {
      const acquired = manager.tryAcquire('resource-1', 'write', 'task-1');
      expect(acquired).toBe(true);
    });

    it('写锁应该互斥', () => {
      manager.tryAcquire('resource-1', 'write', 'task-1');
      const acquired = manager.tryAcquire('resource-1', 'write', 'task-2');
      expect(acquired).toBe(false);
    });

    it('读锁应该共享', () => {
      manager.tryAcquire('resource-1', 'read', 'task-1');
      const acquired = manager.tryAcquire('resource-1', 'read', 'task-2');
      expect(acquired).toBe(true);
    });

    it('写锁应该阻止读锁', () => {
      manager.tryAcquire('resource-1', 'write', 'task-1');
      const acquired = manager.tryAcquire('resource-1', 'read', 'task-2');
      expect(acquired).toBe(false);
    });

    it('读锁应该阻止写锁', () => {
      manager.tryAcquire('resource-1', 'read', 'task-1');
      const acquired = manager.tryAcquire('resource-1', 'write', 'task-2');
      expect(acquired).toBe(false);
    });
  });

  describe('release', () => {
    it('应该能释放锁', () => {
      manager.tryAcquire('resource-1', 'write', 'task-1');
      manager.release('resource-1', 'task-1');
      
      const acquired = manager.tryAcquire('resource-1', 'write', 'task-2');
      expect(acquired).toBe(true);
    });

    it('释放不存在的锁不应该报错', () => {
      expect(() => manager.release('nonexistent', 'task-1')).not.toThrow();
    });
  });

  describe('isLocked', () => {
    it('获取锁后应该返回true', () => {
      manager.tryAcquire('resource-1', 'write', 'task-1');
      expect(manager.isLocked('resource-1')).toBe(true);
    });

    it('未获取锁应该返回false', () => {
      expect(manager.isLocked('resource-1')).toBe(false);
    });

    it('释放锁后应该返回false', () => {
      manager.tryAcquire('resource-1', 'write', 'task-1');
      manager.release('resource-1', 'task-1');
      expect(manager.isLocked('resource-1')).toBe(false);
    });
  });

  describe('getLockInfo', () => {
    it('应该能获取锁信息', () => {
      manager.tryAcquire('resource-1', 'write', 'task-1');
      const info = manager.getLockInfo('resource-1');
      
      expect(info.length).toBe(1);
      expect(info[0].resource).toBe('resource-1');
      expect(info[0].type).toBe('write');
      expect(info[0].taskId).toBe('task-1');
    });

    it('不存在的锁应该返回空数组', () => {
      const info = manager.getLockInfo('nonexistent');
      expect(info).toEqual([]);
    });
  });

  describe('clear', () => {
    it('应该能清除所有锁', () => {
      manager.tryAcquire('resource-1', 'write', 'task-1');
      manager.tryAcquire('resource-2', 'write', 'task-2');
      
      manager.clear();
      
      expect(manager.isLocked('resource-1')).toBe(false);
      expect(manager.isLocked('resource-2')).toBe(false);
    });
  });

  describe('clearTaskLocks', () => {
    it('应该能清除指定任务的所有锁', () => {
      manager.tryAcquire('resource-1', 'write', 'task-1');
      manager.tryAcquire('resource-2', 'write', 'task-1');
      manager.tryAcquire('resource-3', 'write', 'task-2');
      
      manager.clearTaskLocks('task-1');
      
      expect(manager.isLocked('resource-1')).toBe(false);
      expect(manager.isLocked('resource-2')).toBe(false);
      expect(manager.isLocked('resource-3')).toBe(true);
    });
  });

  describe('并发安全', () => {
    it('多个读锁应该都能成功', () => {
      const results: boolean[] = [];
      
      for (let i = 0; i < 5; i++) {
        results.push(manager.tryAcquire('resource-1', 'read', `task-${i}`));
      }
      
      expect(results.every(r => r === true)).toBe(true);
    });

    it('多个写锁只有一个能成功', () => {
      const results: boolean[] = [];
      
      for (let i = 0; i < 5; i++) {
        results.push(manager.tryAcquire('resource-1', 'write', `task-${i}`));
      }
      
      const successCount = results.filter(r => r === true).length;
      expect(successCount).toBe(1);
    });
  });
});
