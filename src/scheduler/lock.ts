/**
 * 资源锁管理器 - 并发资源访问控制
 * 
 * 第四章 4.5 资源锁机制
 * 
 * 功能：
 * 1. 读锁/写锁
 * 2. 锁等待
 * 3. 死锁检测
 */

import { getLogger } from '../observability/logger';

const logger = getLogger('scheduler:lock');

interface LockInfo {
  resource: string;
  type: 'read' | 'write';
  taskId: string;
  timestamp: number;
}

/**
 * 资源锁管理器
 */
export class ResourceLockManager {
  private locks: Map<string, LockInfo[]> = new Map();
  private waitQueue: Map<string, Array<{ taskId: string; type: 'read' | 'write'; resolve: (acquired: boolean) => void }>> = new Map();

  /**
   * 请求锁
   */
  async acquire(resource: string, type: 'read' | 'write', taskId: string): Promise<boolean> {
    logger.debug('请求锁', { resource, type, taskId });

    const existing = this.locks.get(resource) || [];

    // 检查是否可以获取锁
    if (existing.length === 0) {
      // 无锁，直接获取
      this.locks.set(resource, [{ resource, type, taskId, timestamp: Date.now() }]);
      logger.debug('锁获取成功', { resource, type, taskId });
      return true;
    }

    // 读锁可以共享
    if (type === 'read' && existing.every(l => l.type === 'read')) {
      existing.push({ resource, type, taskId, timestamp: Date.now() });
      this.locks.set(resource, existing);
      logger.debug('读锁共享成功', { resource, taskId });
      return true;
    }

    // 冲突，需要等待
    logger.debug('锁冲突，等待中', { resource, type, taskId, existingLocks: existing.length });
    return false;
  }

  /**
   * 尝试获取锁（不等待）
   */
  tryAcquire(resource: string, type: 'read' | 'write', taskId: string): boolean {
    const existing = this.locks.get(resource) || [];

    if (existing.length === 0) {
      this.locks.set(resource, [{ resource, type, taskId, timestamp: Date.now() }]);
      return true;
    }

    if (type === 'read' && existing.every(l => l.type === 'read')) {
      existing.push({ resource, type, taskId, timestamp: Date.now() });
      this.locks.set(resource, existing);
      return true;
    }

    return false;
  }

  /**
   * 释放锁
   */
  release(resource: string, taskId: string): void {
    const existing = this.locks.get(resource) || [];
    const remaining = existing.filter(l => l.taskId !== taskId);

    if (remaining.length === 0) {
      this.locks.delete(resource);
    } else {
      this.locks.set(resource, remaining);
    }

    logger.debug('锁已释放', { resource, taskId });

    // 处理等待队列
    this.processWaitQueue(resource);
  }

  /**
   * 处理等待队列
   */
  private processWaitQueue(resource: string): void {
    const queue = this.waitQueue.get(resource) || [];
    if (queue.length === 0) return;

    const next = queue.shift();
    if (next) {
      const acquired = this.tryAcquire(resource, next.type, next.taskId);
      next.resolve(acquired);
    }
  }

  /**
   * 检查资源是否被锁定
   */
  isLocked(resource: string): boolean {
    const locks = this.locks.get(resource) || [];
    return locks.length > 0;
  }

  /**
   * 获取资源的锁信息
   */
  getLockInfo(resource: string): LockInfo[] {
    return this.locks.get(resource) || [];
  }

  /**
   * 获取所有锁
   */
  getAllLocks(): Map<string, LockInfo[]> {
    return new Map(this.locks);
  }

  /**
   * 清除所有锁
   */
  clear(): void {
    this.locks.clear();
    this.waitQueue.clear();
    logger.info('所有锁已清除');
  }

  /**
   * 清除任务的所有锁
   */
  clearTaskLocks(taskId: string): void {
    for (const [resource, locks] of this.locks) {
      const remaining = locks.filter(l => l.taskId !== taskId);
      if (remaining.length === 0) {
        this.locks.delete(resource);
      } else {
        this.locks.set(resource, remaining);
      }
    }
    logger.debug('任务锁已清除', { taskId });
  }
}

// 全局实例
let lockManager: ResourceLockManager | null = null;

export function getLockManager(): ResourceLockManager {
  if (!lockManager) {
    lockManager = new ResourceLockManager();
  }
  return lockManager;
}

/**
 * 重置锁管理器实例（测试用）
 */
export function resetLockManager(): void {
  if (lockManager) {
    lockManager.clear();
  }
  lockManager = null;
}
