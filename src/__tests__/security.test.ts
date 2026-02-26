/**
 * 安全管理器测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SecurityManager, SecurityLevel } from '../security/manager';

describe('SecurityManager', () => {
  let manager: SecurityManager;

  beforeEach(() => {
    manager = new SecurityManager();
  });

  describe('路径检查', () => {
    it('应该禁止访问系统路径', () => {
      const result = manager.checkPath('/etc/passwd');
      expect(result.allowed).toBe(false);
      expect(result.level).toBe(SecurityLevel.CRITICAL);
    });

    it('应该禁止访问root目录', () => {
      const result = manager.checkPath('/root');
      expect(result.allowed).toBe(false);
    });

    it('应该禁止访问SSH目录', () => {
      const result = manager.checkPath('/root/.ssh');
      expect(result.allowed).toBe(false);
    });

    it('应该禁止访问Docker socket', () => {
      const result = manager.checkPath('/var/run/docker.sock');
      expect(result.allowed).toBe(false);
    });

    it('应该允许访问工作目录', () => {
      const result = manager.checkPath('/tmp/test', '/tmp');
      expect(result.allowed).toBe(true);
    });

    it('应该禁止访问工作目录外的路径', () => {
      const result = manager.checkPath('/etc/passwd', '/tmp');
      expect(result.allowed).toBe(false);
    });
  });

  describe('命令检查', () => {
    it('应该禁止删除根目录', () => {
      const result = manager.checkCommand('rm -rf /');
      expect(result.allowed).toBe(false);
      expect(result.level).toBe(SecurityLevel.CRITICAL);
    });

    it('应该禁止格式化命令', () => {
      const result = manager.checkCommand('mkfs.ext4 /dev/sda1');
      expect(result.allowed).toBe(false);
    });

    it('应该禁止修改权限为777', () => {
      const result = manager.checkCommand('chmod 777 /etc/passwd');
      expect(result.allowed).toBe(false);
    });

    it('应该禁止sudo命令', () => {
      const result = manager.checkCommand('sudo rm -rf /');
      expect(result.allowed).toBe(false);
    });

    it('应该允许普通命令', () => {
      const result = manager.checkCommand('ls -la');
      expect(result.allowed).toBe(true);
    });

    it('应该允许echo命令', () => {
      const result = manager.checkCommand('echo hello');
      expect(result.allowed).toBe(true);
    });
  });

  describe('敏感信息检测', () => {
    it('应该检测OpenAI API Key', () => {
      const text = 'My API key is sk-1234567890abcdefghijklmnop';
      const result = manager.detectSensitiveInfo(text);
      expect(result.found).toBe(true);
      expect(result.types).toContain('OpenAI API Key');
    });

    it('应该检测GitHub Token', () => {
      const text = 'Token: ghp_1234567890abcdefghijklmnopqrstuvwxyz';
      const result = manager.detectSensitiveInfo(text);
      expect(result.found).toBe(true);
      expect(result.types).toContain('GitHub Token');
    });

    it('应该检测私钥', () => {
      const text = '-----BEGIN RSA PRIVATE KEY-----';
      const result = manager.detectSensitiveInfo(text);
      expect(result.found).toBe(true);
      expect(result.types).toContain('Private Key');
    });

    it('应该检测密码', () => {
      const text = 'password = "secret123"';
      const result = manager.detectSensitiveInfo(text);
      expect(result.found).toBe(true);
      expect(result.types).toContain('Password');
    });

    it('应该对普通文本返回false', () => {
      const text = 'This is a normal text without sensitive info';
      const result = manager.detectSensitiveInfo(text);
      expect(result.found).toBe(false);
    });
  });

  describe('脱敏处理', () => {
    it('应该脱敏API Key', () => {
      const text = 'API key: sk-1234567890abcdefghijklmnop';
      const redacted = manager.redactSensitiveInfo(text);
      expect(redacted).toContain('[REDACTED:OpenAI API Key]');
      expect(redacted).not.toContain('sk-1234567890abcdefghijklmnop');
    });

    it('应该脱敏密码', () => {
      const text = 'password = "secret123"';
      const redacted = manager.redactSensitiveInfo(text);
      expect(redacted).toContain('[REDACTED:Password]');
      expect(redacted).not.toContain('secret123');
    });
  });

  describe('审计日志', () => {
    it('应该记录审计日志', () => {
      manager.checkPath('/etc/passwd');
      const log = manager.getAuditLog();
      expect(log.length).toBeGreaterThan(0);
    });

    it('应该能清除审计日志', () => {
      manager.checkPath('/etc/passwd');
      manager.clearAuditLog();
      const log = manager.getAuditLog();
      expect(log.length).toBe(0);
    });
  });
});
