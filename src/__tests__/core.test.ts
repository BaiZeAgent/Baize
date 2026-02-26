/**
 * 核心模块测试
 */
import { describe, test, expect, beforeEach } from 'vitest';
import * as baize from '../index';

describe('Core Module', () => {
  test('应该导出 Brain', () => {
    expect(baize.Brain).toBeDefined();
    expect(typeof baize.getBrain).toBe('function');
  });

  test('应该导出 Router', () => {
    expect(baize.SmartRouter).toBeDefined();
    expect(typeof baize.getSmartRouter).toBe('function');
  });

  test('应该导出 Executor', () => {
    expect(baize.Executor).toBeDefined();
    expect(typeof baize.getExecutor).toBe('function');
  });

  test('应该导出 LLMManager', () => {
    expect(baize.LLMManager).toBeDefined();
    expect(typeof baize.getLLMManager).toBe('function');
  });

  test('应该导出 SkillRegistry', () => {
    expect(baize.SkillRegistry).toBeDefined();
    expect(typeof baize.getSkillRegistry).toBe('function');
  });

  test('应该导出 Memory', () => {
    expect(typeof baize.getMemory).toBe('function');
  });

  test('应该导出 VectorSearch', () => {
    expect(baize.VectorSearchManager).toBeDefined();
    expect(typeof baize.getVectorSearch).toBe('function');
    expect(typeof baize.resetVectorSearch).toBe('function');
  });

  test('应该导出 LockManager', () => {
    expect(typeof baize.getLockManager).toBe('function');
    expect(typeof baize.resetLockManager).toBe('function');
  });

  test('应该导出 EvolutionManager', () => {
    expect(baize.EvolutionManager).toBeDefined();
    expect(typeof baize.getEvolutionManager).toBe('function');
  });

  test('应该导出 SecurityManager', () => {
    expect(typeof baize.getSecurityManager).toBe('function');
  });

  test('应该导出 SandboxManager', () => {
    expect(typeof baize.getSandboxManager).toBe('function');
  });

  test('应该导出 PluginManager', () => {
    expect(typeof baize.getPluginManager).toBe('function');
  });

  test('应该导出 HookManager', () => {
    expect(typeof baize.getHookManager).toBe('function');
  });
});
