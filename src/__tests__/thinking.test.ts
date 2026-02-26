/**
 * 思考引擎测试
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { ThinkingEngine, getThinkingEngine, resetThinkingEngine } from '../core/thinking/engine';

describe('ThinkingEngine', () => {
  beforeEach(() => {
    resetThinkingEngine();
  });

  test('应该创建思考引擎实例', () => {
    const engine = getThinkingEngine();
    expect(engine).toBeInstanceOf(ThinkingEngine);
  });

  test('应该返回单例', () => {
    const instance1 = getThinkingEngine();
    const instance2 = getThinkingEngine();
    expect(instance1).toBe(instance2);
  });

  test('resetThinkingEngine 应该重置实例', () => {
    const instance1 = getThinkingEngine();
    resetThinkingEngine();
    const instance2 = getThinkingEngine();
    expect(instance1).not.toBe(instance2);
  });

  test('think 方法应该返回结果', async () => {
    const engine = getThinkingEngine();
    const result = await engine.think('你好');
    expect(result).toBeDefined();
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });
});
