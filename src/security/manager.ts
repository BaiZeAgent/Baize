/**
 * 安全管理器 - 增强版安全系统
 * 
 * 核心功能：
 * 1. 路径安全检查
 * 2. 命令安全检查
 * 3. 敏感信息检测
 * 4. 权限管理
 * 5. 审计日志
 */

import * as path from 'path';
import * as fs from 'fs';
import { getLogger } from '../observability/logger';

const logger = getLogger('security');

/**
 * 安全级别
 */
export enum SecurityLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/**
 * 安全检查结果
 */
export interface SecurityCheckResult {
  allowed: boolean;
  level: SecurityLevel;
  reason?: string;
  suggestions?: string[];
}

/**
 * 审计日志条目
 */
export interface AuditLogEntry {
  timestamp: Date;
  action: string;
  resource: string;
  userId?: string;
  sessionId?: string;
  allowed: boolean;
  reason?: string;
}

/**
 * 禁止访问的系统路径
 */
const FORBIDDEN_PATHS = [
  // 系统目录
  '/etc',
  '/root',
  '/boot',
  '/proc',
  '/sys',
  '/dev',
  
  // 敏感配置
  '/etc/passwd',
  '/etc/shadow',
  '/etc/sudoers',
  
  // SSH相关
  '/root/.ssh',
  '/home/*/.ssh',
  
  // Docker相关
  '/var/run/docker.sock',
  '/run/docker.sock',
  
  // 云服务凭证
  '/root/.aws',
  '/root/.gcp',
  '/root/.azure',
  '/home/*/.aws',
  '/home/*/.gcp',
  '/home/*/.azure',
];

/**
 * 危险命令列表
 */
const DANGEROUS_COMMANDS = [
  // 系统操作
  'rm -rf /',
  'rm -rf /*',
  'mkfs',
  'dd if=',
  'fdisk',
  'format',
  
  // 权限操作
  'chmod 777',
  'chown root',
  'sudo su',
  'passwd',
  
  // 网络操作
  'iptables',
  'ufw disable',
  'firewall-cmd --disable',
  
  // 进程操作
  'kill -9 -1',
  'killall',
  'pkill -9',
  
  // 系统控制
  'shutdown',
  'reboot',
  'init 0',
  'init 6',
  'systemctl stop',
  
  // 敏感文件操作
  'cat /etc/passwd',
  'cat /etc/shadow',
  'cat /root/.ssh',
];

/**
 * 敏感信息模式
 */
const SENSITIVE_PATTERNS = [
  // API Keys
  { pattern: /sk-[a-zA-Z0-9]{20,}/g, name: 'OpenAI API Key' },
  { pattern: /ghp_[a-zA-Z0-9]{36}/g, name: 'GitHub Token' },
  { pattern: /gho_[a-zA-Z0-9]{36}/g, name: 'GitHub OAuth Token' },
  { pattern: /ghu_[a-zA-Z0-9]{36}/g, name: 'GitHub User Token' },
  { pattern: /ghs_[a-zA-Z0-9]{36}/g, name: 'GitHub Server Token' },
  { pattern: /ghr_[a-zA-Z0-9]{36}/g, name: 'GitHub Refresh Token' },
  
  // AWS
  { pattern: /AKIA[0-9A-Z]{16}/g, name: 'AWS Access Key' },
  { pattern: /aws_secret_access_key\s*=\s*['"][^'"]+['"]/g, name: 'AWS Secret Key' },
  
  // 阿里云
  { pattern: /LTAI[a-zA-Z0-9]{12,}/g, name: '阿里云 AccessKey' },
  
  // 私钥
  { pattern: /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----/g, name: 'Private Key' },
  
  // 密码
  { pattern: /password\s*=\s*['"][^'"]+['"]/gi, name: 'Password' },
  { pattern: /passwd\s*=\s*['"][^'"]+['"]/gi, name: 'Password' },
];

/**
 * 安全管理器
 */
export class SecurityManager {
  private auditLog: AuditLogEntry[] = [];
  private maxAuditLogSize: number = 10000;

  /**
   * 检查路径是否安全
   */
  checkPath(targetPath: string, workdir?: string): SecurityCheckResult {
    // 规范化路径
    const normalizedPath = path.normalize(targetPath);
    const absolutePath = path.isAbsolute(normalizedPath) 
      ? normalizedPath 
      : path.resolve(workdir || process.cwd(), normalizedPath);

    // 检查是否在禁止列表中
    for (const forbidden of FORBIDDEN_PATHS) {
      if (this.matchPath(absolutePath, forbidden)) {
        this.logAudit('path_check', absolutePath, false, '路径在禁止列表中');
        return {
          allowed: false,
          level: SecurityLevel.CRITICAL,
          reason: `禁止访问系统路径: ${forbidden}`,
          suggestions: ['请使用工作目录内的路径'],
        };
      }
    }

    // 检查是否是符号链接（可能逃逸工作目录）
    try {
      if (fs.existsSync(absolutePath)) {
        const realPath = fs.realpathSync(absolutePath);
        if (realPath !== absolutePath) {
          // 递归检查真实路径
          const realCheck = this.checkPath(realPath, workdir);
          if (!realCheck.allowed) {
            return realCheck;
          }
        }
      }
    } catch (error) {
      // 文件不存在，继续检查
    }

    // 检查是否在工作目录外
    if (workdir) {
      const absoluteWorkdir = path.resolve(workdir);
      if (!absolutePath.startsWith(absoluteWorkdir)) {
        this.logAudit('path_check', absolutePath, false, '路径在工作目录外');
        return {
          allowed: false,
          level: SecurityLevel.HIGH,
          reason: '路径在工作目录外',
          suggestions: ['请使用工作目录内的相对路径'],
        };
      }
    }

    this.logAudit('path_check', absolutePath, true);
    return { allowed: true, level: SecurityLevel.LOW };
  }

  /**
   * 检查命令是否安全
   */
  checkCommand(command: string): SecurityCheckResult {
    const normalizedCommand = command.trim().toLowerCase();

    // 检查危险命令
    for (const dangerous of DANGEROUS_COMMANDS) {
      if (normalizedCommand.includes(dangerous.toLowerCase())) {
        this.logAudit('command_check', command, false, '危险命令');
        return {
          allowed: false,
          level: SecurityLevel.CRITICAL,
          reason: `禁止执行危险命令: ${dangerous}`,
          suggestions: ['请使用更安全的替代命令'],
        };
      }
    }

    // 检查管道和重定向中的危险操作
    const parts = normalizedCommand.split(/[|;&]/);
    for (const part of parts) {
      for (const dangerous of DANGEROUS_COMMANDS) {
        if (part.trim().includes(dangerous.toLowerCase())) {
          this.logAudit('command_check', command, false, '管道中的危险命令');
          return {
            allowed: false,
            level: SecurityLevel.CRITICAL,
            reason: `禁止执行危险命令: ${dangerous}`,
            suggestions: ['请移除管道中的危险操作'],
          };
        }
      }
    }

    // 检查sudo
    if (normalizedCommand.includes('sudo')) {
      this.logAudit('command_check', command, false, '需要sudo权限');
      return {
        allowed: false,
        level: SecurityLevel.HIGH,
        reason: '命令需要sudo权限',
        suggestions: ['请联系管理员执行此命令'],
      };
    }

    this.logAudit('command_check', command, true);
    return { allowed: true, level: SecurityLevel.LOW };
  }

  /**
   * 检测敏感信息
   */
  detectSensitiveInfo(text: string): { found: boolean; types: string[]; positions: Array<{ start: number; end: number; type: string }> } {
    const types: string[] = [];
    const positions: Array<{ start: number; end: number; type: string }> = [];

    for (const { pattern, name } of SENSITIVE_PATTERNS) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        if (!types.includes(name)) {
          types.push(name);
        }
        positions.push({
          start: match.index!,
          end: match.index! + match[0].length,
          type: name,
        });
      }
    }

    return {
      found: types.length > 0,
      types,
      positions,
    };
  }

  /**
   * 脱敏处理
   */
  redactSensitiveInfo(text: string): string {
    let result = text;

    for (const { pattern, name } of SENSITIVE_PATTERNS) {
      result = result.replace(pattern, `[REDACTED:${name}]`);
    }

    return result;
  }

  /**
   * 记录审计日志
   */
  private logAudit(action: string, resource: string, allowed: boolean, reason?: string): void {
    const entry: AuditLogEntry = {
      timestamp: new Date(),
      action,
      resource,
      allowed,
      reason,
    };

    this.auditLog.push(entry);

    // 限制日志大小
    if (this.auditLog.length > this.maxAuditLogSize) {
      this.auditLog.shift();
    }

    // 记录到日志
    if (allowed) {
      logger.debug(`[audit] ${action} ${resource} - allowed`);
    } else {
      logger.warn(`[audit] ${action} ${resource} - denied: ${reason}`);
    }
  }

  /**
   * 获取审计日志
   */
  getAuditLog(limit: number = 100): AuditLogEntry[] {
    return this.auditLog.slice(-limit);
  }

  /**
   * 清除审计日志
   */
  clearAuditLog(): void {
    this.auditLog = [];
    logger.info('[audit] 审计日志已清除');
  }

  /**
   * 路径匹配（支持通配符）
   */
  private matchPath(targetPath: string, pattern: string): boolean {
    // 简单的通配符匹配
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      return regex.test(targetPath);
    }
    return targetPath.startsWith(pattern) || targetPath === pattern;
  }
}

// 全局实例
let securityManagerInstance: SecurityManager | null = null;

/**
 * 获取安全管理器实例
 */
export function getSecurityManager(): SecurityManager {
  if (!securityManagerInstance) {
    securityManagerInstance = new SecurityManager();
  }
  return securityManagerInstance;
}

/**
 * 重置安全管理器实例（测试用）
 */
export function resetSecurityManager(): void {
  securityManagerInstance = null;
}
