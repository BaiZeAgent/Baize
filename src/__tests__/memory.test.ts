/**
 * 记忆系统测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock Database
vi.mock('../memory/database', () => {
  const mockDb = {
    run: vi.fn(),
    get: vi.fn(),
    all: vi.fn().mockReturnValue([]),
    close: vi.fn(),
    initialize: vi.fn().mockResolvedValue(undefined),
  };
  
  return {
    getDatabase: () => mockDb,
    resetDatabase: vi.fn(),
  };
});

import { MemorySystem, getMemory } from '../memory';
import { getDatabase } from '../memory/database';

describe('MemorySystem', () => {
  let memory: MemorySystem;
  let mockDb: ReturnType<typeof getDatabase>;

  beforeEach(() => {
    memory = getMemory();
    mockDb = getDatabase();
    // 重置mock
    vi.clearAllMocks();
  });

  describe('情景记忆', () => {
    it('应该能记录情景记忆', () => {
      mockDb.get.mockReturnValue({ id: 1 });
      
      const id = memory.recordEpisode('test', '测试内容');
      expect(mockDb.run).toHaveBeenCalled();
    });

    it('应该能获取情景记忆', () => {
      mockDb.all.mockReturnValue([
        { id: 1, type: 'test', timestamp: '2024-01-01', content: '内容1', created_at: '2024-01-01' },
        { id: 2, type: 'test', timestamp: '2024-01-02', content: '内容2', created_at: '2024-01-02' },
      ]);
      
      const episodes = memory.getEpisodes('test');
      expect(episodes.length).toBe(2);
    });

    it('应该能限制返回数量', () => {
      mockDb.all.mockReturnValue([
        { id: 1, type: 'test', timestamp: '2024-01-01', content: '内容1', created_at: '2024-01-01' },
      ]);
      
      const episodes = memory.getEpisodes('test', 1);
      expect(episodes.length).toBe(1);
    });
  });

  describe('声明式记忆', () => {
    it('应该能记住和回忆', () => {
      mockDb.get.mockReturnValueOnce(null); // 不存在
      mockDb.get.mockReturnValueOnce({ value: 'test_value', confidence: 0.8 }); // recall
      
      memory.remember('test_key', 'test_value', 0.8);
      const result = memory.recall('test_key');
      
      expect(result).not.toBeNull();
      expect(result?.value).toBe('test_value');
    });

    it('应该能设置和获取偏好', () => {
      mockDb.get.mockReturnValue(null);
      
      memory.setPreference('theme', 'dark');
      expect(mockDb.run).toHaveBeenCalled();
    });
  });

  describe('程序性记忆', () => {
    it('应该能记录任务模式', () => {
      mockDb.get.mockReturnValue(null);
      
      memory.recordPattern('test_pattern', 'pattern_value');
      expect(mockDb.run).toHaveBeenCalled();
    });
  });

  describe('信任记录', () => {
    it('应该能记录成功', () => {
      mockDb.get.mockReturnValue(null);
      
      memory.recordSuccess('operation');
      expect(mockDb.run).toHaveBeenCalled();
    });

    it('应该能记录失败', () => {
      mockDb.get.mockReturnValue(null);
      
      memory.recordFailure('operation');
      expect(mockDb.run).toHaveBeenCalled();
    });
  });
});
