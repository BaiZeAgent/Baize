/**
 * 集成测试
 */
import { describe, test, expect, beforeEach } from 'vitest';
import { getBrain, resetBrain } from '../core/brain';
import { getExecutor, resetExecutor } from '../executor';
import { getSkillRegistry } from '../skills/registry';
import { getDatabase } from '../memory/database';

describe('Integration', () => {
  beforeEach(async () => {
    resetBrain();
    resetExecutor();
    // 初始化数据库
    const db = getDatabase();
    await db.initialize();
  });

  test('Brain 应该能处理简单输入', async () => {
    const brain = getBrain();
    const result = await brain.process('你好');
    expect(result).toBeDefined();
    expect(result.action).toBe('reply');
  });

  test('Executor 应该能执行技能', async () => {
    const executor = getExecutor();
    const result = await executor.executeSkill('nonexistent', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('不存在');
  });

  test('SkillRegistry 应该能注册和获取技能', () => {
    const registry = getSkillRegistry();
    expect(registry).toBeDefined();
    expect(typeof registry.getAll).toBe('function');
  });
});
