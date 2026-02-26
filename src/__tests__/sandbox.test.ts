/**
 * 沙箱管理器测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SandboxManager, SandboxConfig } from '../sandbox/manager';

describe('SandboxManager', () => {
  let manager: SandboxManager;

  beforeEach(() => {
    manager = new SandboxManager({ enabled: false });
  });

  describe('配置', () => {
    it('应该使用默认配置', () => {
      const defaultManager = new SandboxManager();
      expect(defaultManager).toBeDefined();
    });

    it('应该接受自定义配置', () => {
      const customConfig: Partial<SandboxConfig> = {
        enabled: false,
        image: 'custom-image',
        networkMode: 'bridge',
      };
      const customManager = new SandboxManager(customConfig);
      expect(customManager).toBeDefined();
    });

    it('禁用沙箱时应该能创建上下文', async () => {
      const disabledManager = new SandboxManager({ enabled: false });
      const ctx = await disabledManager.create({
        hostWorkdir: '/tmp/test',
        sessionId: 'test-session',
      });
      
      expect(ctx).toBeDefined();
      expect(ctx.containerId).toBe('');
      expect(ctx.containerWorkdir).toBe('/tmp/test');
    });
  });

  describe('执行命令', () => {
    it('禁用沙箱时应该在主机执行命令', async () => {
      const disabledManager = new SandboxManager({ enabled: false });
      const ctx = await disabledManager.create({
        hostWorkdir: '/tmp/test',
        sessionId: 'test-session',
      });
      
      const result = await disabledManager.exec(ctx, ['echo', 'hello']);
      
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('hello');
    });

    it('应该处理命令执行错误', async () => {
      const disabledManager = new SandboxManager({ enabled: false });
      const ctx = await disabledManager.create({
        hostWorkdir: '/tmp/test',
        sessionId: 'test-session',
      });
      
      const result = await disabledManager.exec(ctx, ['ls', '/nonexistent']);
      
      expect(result.exitCode).not.toBe(0);
    });
  });
});
