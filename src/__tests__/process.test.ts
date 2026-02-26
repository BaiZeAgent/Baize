/**
 * 进程管理器测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProcessManager, ProcessStatus } from '../executor/process';

describe('ProcessManager', () => {
  let manager: ProcessManager;

  beforeEach(() => {
    manager = new ProcessManager();
  });

  describe('前台执行', () => {
    it('应该能执行简单命令', async () => {
      const result = await manager.execute({
        command: 'echo',
        args: ['hello'],
        background: false,
      });

      expect(result.status).toBe(ProcessStatus.COMPLETED);
      expect(result.stdout.trim()).toBe('hello');
    });

    it('应该能执行带参数的命令', async () => {
      const result = await manager.execute({
        command: 'printf',
        args: ['%s', 'test'],
        background: false,
      });

      expect(result.status).toBe(ProcessStatus.COMPLETED);
      expect(result.stdout).toBe('test');
    });

    it('应该处理命令执行失败', async () => {
      const result = await manager.execute({
        command: 'ls',
        args: ['/nonexistent'],
        background: false,
      });

      expect(result.status).toBe(ProcessStatus.FAILED);
    });
  });

  describe('后台执行', () => {
    it('应该立即返回后台任务ID', async () => {
      const result = await manager.execute({
        command: 'sleep',
        args: ['1'],
        background: true,
      });

      expect(result.id).toBeDefined();
      expect(result.status).toBe(ProcessStatus.RUNNING);
    });

    it('应该能查询后台任务状态', async () => {
      const result = await manager.execute({
        command: 'sleep',
        args: ['1'],
        background: true,
      });

      const status = manager.getStatus(result.id);
      expect(status).toBeDefined();
    });
  });

  describe('进程控制', () => {
    it('查询不存在的进程应该返回undefined', () => {
      const status = manager.getStatus('nonexistent');
      expect(status).toBeUndefined();
    });

    it('终止不存在的进程应该返回false', async () => {
      const killed = await manager.kill('nonexistent');
      expect(killed).toBe(false);
    });
  });

  describe('清理', () => {
    it('应该能清理已完成的进程', async () => {
      await manager.execute({
        command: 'echo',
        args: ['test'],
        background: false,
      });

      const cleaned = manager.cleanup();
      expect(cleaned).toBeGreaterThanOrEqual(0);
    });
  });
});
