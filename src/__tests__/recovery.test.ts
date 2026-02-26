/**
 * 错误恢复管理器测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ErrorRecoveryManager, ErrorKind } from '../core/recovery';

describe('ErrorRecoveryManager', () => {
  let manager: ErrorRecoveryManager;

  beforeEach(() => {
    manager = new ErrorRecoveryManager();
  });

  describe('Profile管理', () => {
    it('应该能设置Profile列表', () => {
      manager.setProfiles(['profile-1', 'profile-2']);
      // 无错误即成功
      expect(true).toBe(true);
    });

    it('应该能设置空Profile列表', () => {
      manager.setProfiles([]);
      expect(true).toBe(true);
    });

    it('应该能清除所有Profile', () => {
      manager.setProfiles(['profile-1', 'profile-2']);
      manager.clearAllProfiles();
      expect(true).toBe(true);
    });
  });

  describe('错误处理', () => {
    it('应该能处理空错误', async () => {
      const result = await manager.handle({ error: null, iterations: 0 });
      expect(result).toBeDefined();
    });

    it('应该能处理认证错误', async () => {
      const authError = new Error('Authentication failed');
      (authError as any).status = 401;
      
      const result = await manager.handle({ error: authError, iterations: 0 });
      expect(result).toBeDefined();
    });

    it('应该能处理速率限制错误', async () => {
      const rateLimitError = new Error('Rate limit exceeded');
      (rateLimitError as any).status = 429;
      
      const result = await manager.handle({ error: rateLimitError, iterations: 0 });
      expect(result).toBeDefined();
    });

    it('应该能处理网络错误', async () => {
      const networkError = new Error('Network error');
      networkError.name = 'NetworkError';
      
      const result = await manager.handle({ error: networkError, iterations: 0 });
      expect(result).toBeDefined();
    });
  });

  describe('退避计算', () => {
    it('应该能计算退避时间', () => {
      const backoff = manager.calculateBackoff(0);
      expect(backoff).toBeGreaterThanOrEqual(0);
    });

    it('重试次数越多退避时间越长', () => {
      const backoff1 = manager.calculateBackoff(1);
      const backoff2 = manager.calculateBackoff(2);
      const backoff3 = manager.calculateBackoff(3);
      
      expect(backoff2).toBeGreaterThan(backoff1);
      expect(backoff3).toBeGreaterThan(backoff2);
    });
  });
});
