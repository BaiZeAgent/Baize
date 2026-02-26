/**
 * 执行器测试
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { Executor, getExecutor, resetExecutor } from '../executor';

describe('Executor', () => {
  beforeEach(() => {
    resetExecutor();
  });

  test('应该创建执行器实例', () => {
    const executor = getExecutor();
    expect(executor).toBeInstanceOf(Executor);
  });

  test('应该返回单例', () => {
    const instance1 = getExecutor();
    const instance2 = getExecutor();
    expect(instance1).toBe(instance2);
  });

  test('resetExecutor 应该重置实例', () => {
    const instance1 = getExecutor();
    resetExecutor();
    const instance2 = getExecutor();
    expect(instance1).not.toBe(instance2);
  });
});
