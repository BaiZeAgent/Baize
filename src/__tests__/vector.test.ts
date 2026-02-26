/**
 * 向量搜索测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VectorSearchManager } from '../memory/vector';
import * as fs from 'fs';
import * as path from 'path';

describe('VectorSearchManager', () => {
  let manager: VectorSearchManager;
  const testStoragePath = './data/test-vectors';

  beforeEach(async () => {
    // 使用测试专用存储路径
    manager = new VectorSearchManager({
      storagePath: testStoragePath,
      persist: false, // 测试时不持久化
    });
    await manager.init();
  });

  afterEach(async () => {
    await manager.clear();
    // 清理测试目录
    if (fs.existsSync(testStoragePath)) {
      fs.rmSync(testStoragePath, { recursive: true, force: true });
    }
  });

  describe('嵌入', () => {
    it('应该能生成嵌入', async () => {
      const embedding = await manager.embed('测试文本');
      
      expect(Array.isArray(embedding)).toBe(true);
      expect(embedding.length).toBeGreaterThan(0);
    });

    it('不同文本应该生成不同的嵌入', async () => {
      const embedding1 = await manager.embed('文本一');
      const embedding2 = await manager.embed('文本二');
      
      // 两个嵌入应该不完全相同
      const different = embedding1.some((v, i) => v !== embedding2[i]);
      expect(different).toBe(true);
    });
  });

  describe('添加和搜索', () => {
    it('应该能添加向量', async () => {
      await manager.add('test-1', '这是测试文本');
      
      expect(manager.size()).toBe(1);
    });

    it('应该能批量添加向量', async () => {
      await manager.addBatch([
        { id: 'test-1', text: '文本一' },
        { id: 'test-2', text: '文本二' },
        { id: 'test-3', text: '文本三' },
      ]);
      
      expect(manager.size()).toBe(3);
    });

    it('应该能搜索向量', async () => {
      await manager.add('test-1', '苹果是一种水果');
      await manager.add('test-2', '香蕉是一种水果');
      await manager.add('test-3', '汽车是一种交通工具');
      
      const results = await manager.search('水果', { limit: 2 });
      
      expect(results.length).toBeLessThanOrEqual(2);
    });

    it('空搜索应该返回空数组', async () => {
      const results = await manager.search('测试', { limit: 5 });
      expect(results).toEqual([]);
    });
  });

  describe('删除', () => {
    it('应该能删除向量', async () => {
      await manager.add('test-1', '测试文本');
      
      const deleted = await manager.delete('test-1');
      expect(deleted).toBe(true);
      expect(manager.size()).toBe(0);
    });

    it('删除不存在的向量应该返回false', async () => {
      const deleted = await manager.delete('nonexistent');
      expect(deleted).toBe(false);
    });
  });

  describe('获取', () => {
    it('应该能获取向量记录', async () => {
      await manager.add('test-1', '测试文本');
      
      const record = manager.get('test-1');
      expect(record).toBeDefined();
      expect(record?.text).toBe('测试文本');
    });

    it('获取不存在的向量应该返回undefined', () => {
      const record = manager.get('nonexistent');
      expect(record).toBeUndefined();
    });
  });

  describe('清空', () => {
    it('应该能清空所有向量', async () => {
      await manager.add('test-1', '文本一');
      await manager.add('test-2', '文本二');
      
      await manager.clear();
      
      expect(manager.size()).toBe(0);
    });
  });
});
