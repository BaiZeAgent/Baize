/**
 * 安全层 - 身份认证与权限控制
 * 
 * 支持：
 * 1. 用户认证
 * 2. 权限检查
 * 3. 角色管理
 * 4. 审计日志
 */
import { EvolutionPermission } from '../types';
import { getLogger } from '../observability/logger';
import { getDatabase } from '../memory/database';

const logger = getLogger('security');

/**
 * 用户信息
 */
export interface User {
  id: string;
  name: string;
  email?: string;
  roles: string[];
  permissions: string[];
  createdAt: Date;
  lastLoginAt?: Date;
}

/**
 * 权限类型
 */
export enum Permission {
  // 基础权限
  CHAT = 'chat',
  EXECUTE_SKILL = 'execute_skill',
  VIEW_MEMORY = 'view_memory',
  
  // 管理权限
  MANAGE_SKILLS = 'manage_skills',
  MANAGE_TASKS = 'manage_tasks',
  MANAGE_MEMORY = 'manage_memory',
  
  // 高级权限
  EVOLUTION = 'evolution',
  SYSTEM_CONFIG = 'system_config',
  SECURITY_CONFIG = 'security_config',
  ADMIN = 'admin',
}

/**
 * 角色定义
 */
export const ROLE_PERMISSIONS: Record<string, Permission[]> = {
  guest: [
    Permission.CHAT,
  ],
  user: [
    Permission.CHAT,
    Permission.EXECUTE_SKILL,
    Permission.VIEW_MEMORY,
  ],
  developer: [
    Permission.CHAT,
    Permission.EXECUTE_SKILL,
    Permission.VIEW_MEMORY,
    Permission.MANAGE_SKILLS,
    Permission.MANAGE_TASKS,
    Permission.MANAGE_MEMORY,
  ],
  admin: Object.values(Permission),
};

/**
 * 安全管理器
 */
export class SecurityManager {
  private currentUser: User | null = null;
  private sessionToken: string | null = null;
  private db = getDatabase();

  /**
   * 初始化安全系统
   */
  async initialize(): Promise<void> {
    // 创建用户表（如果不存在）
    this.db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT,
        roles TEXT,
        permissions TEXT,
        created_at TEXT,
        last_login_at TEXT
      )
    `);
    
    // 创建审计日志表
    this.db.run(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        action TEXT NOT NULL,
        resource TEXT,
        result TEXT,
        timestamp TEXT,
        details TEXT
      )
    `);
    
    logger.info('安全系统初始化完成');
  }

  /**
   * 用户登录
   */
  async login(userId: string, credentials: Record<string, unknown> = {}): Promise<User | null> {
    // 查找用户
    let user = this.db.get<User>(
      'SELECT * FROM users WHERE id = ?',
      [userId]
    );

    if (!user) {
      // 创建新用户（简化实现）
      const roles = ['user'];
      const permissions = ROLE_PERMISSIONS.user || [];
      
      this.db.run(
        `INSERT INTO users (id, name, roles, permissions, created_at) VALUES (?, ?, ?, ?, ?)`,
        [userId, userId, JSON.stringify(roles), JSON.stringify(permissions), new Date().toISOString()]
      );
      
      user = {
        id: userId,
        name: userId,
        roles,
        permissions,
        createdAt: new Date(),
      };
    } else {
      // 更新最后登录时间
      this.db.run(
        'UPDATE users SET last_login_at = ? WHERE id = ?',
        [new Date().toISOString(), userId]
      );
      
      // 解析JSON字段
      user.roles = JSON.parse(user.roles as unknown as string || '[]');
      user.permissions = JSON.parse(user.permissions as unknown as string || '[]');
    }

    this.currentUser = user;
    this.sessionToken = this.generateToken();
    
    this.audit('login', 'user', 'success', { userId });
    logger.info(`用户登录: ${userId}`);
    
    return user;
  }

  /**
   * 用户登出
   */
  async logout(): Promise<void> {
    if (this.currentUser) {
      this.audit('logout', 'user', 'success', { userId: this.currentUser.id });
      logger.info(`用户登出: ${this.currentUser.id}`);
    }
    this.currentUser = null;
    this.sessionToken = null;
  }

  /**
   * 获取当前用户
   */
  getCurrentUser(): User | null {
    return this.currentUser;
  }

  /**
   * 检查权限
   */
  hasPermission(permission: Permission): boolean {
    if (!this.currentUser) {
      return false;
    }
    
    // admin拥有所有权限
    if (this.currentUser.permissions.includes(Permission.ADMIN)) {
      return true;
    }
    
    return this.currentUser.permissions.includes(permission);
  }

  /**
   * 检查角色
   */
  hasRole(role: string): boolean {
    if (!this.currentUser) {
      return false;
    }
    return this.currentUser.roles.includes(role);
  }

  /**
   * 添加角色
   */
  addRole(role: string): void {
    if (!this.currentUser) return;
    
    if (!this.currentUser.roles.includes(role)) {
      this.currentUser.roles.push(role);
      
      // 添加角色对应的权限
      const rolePermissions = ROLE_PERMISSIONS[role] || [];
      for (const perm of rolePermissions) {
        if (!this.currentUser!.permissions.includes(perm)) {
          this.currentUser!.permissions.push(perm);
        }
      }
      
      // 更新数据库
      this.db.run(
        'UPDATE users SET roles = ?, permissions = ? WHERE id = ?',
        [JSON.stringify(this.currentUser.roles), JSON.stringify(this.currentUser.permissions), this.currentUser.id]
      );
      
      this.audit('add_role', 'user', 'success', { role });
    }
  }

  /**
   * 检查进化权限
   */
  checkEvolutionPermission(targetPath: string): EvolutionPermission {
    // 禁止区域
    const forbiddenPaths = [
      'core/',
      'security/',
      'config/system.yaml',
      'config/evolution.yaml',
    ];

    for (const forbidden of forbiddenPaths) {
      if (targetPath.startsWith(forbidden)) {
        logger.warn(`禁止访问: ${targetPath}`);
        return EvolutionPermission.DENIED;
      }
    }

    // 限制区域
    const restrictedPaths = [
      'skills/',
      'prompts/',
      'memory/',
    ];

    for (const restricted of restrictedPaths) {
      if (targetPath.startsWith(restricted)) {
        return EvolutionPermission.CONFIRM;
      }
    }

    // 自由区域
    return EvolutionPermission.AUTO;
  }

  /**
   * 验证会话
   */
  validateSession(token: string): boolean {
    return token === this.sessionToken;
  }

  /**
   * 获取会话令牌
   */
  getSessionToken(): string | null {
    return this.sessionToken;
  }

  /**
   * 生成令牌
   */
  private generateToken(): string {
    return `token_${Date.now()}_${Math.random().toString(36).substr(2, 16)}`;
  }

  /**
   * 审计日志
   */
  audit(action: string, resource: string, result: string, details: Record<string, unknown> = {}): void {
    this.db.run(
      `INSERT INTO audit_logs (user_id, action, resource, result, timestamp, details) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        this.currentUser?.id || 'anonymous',
        action,
        resource,
        result,
        new Date().toISOString(),
        JSON.stringify(details),
      ]
    );
    
    logger.info(`审计: ${action}`, {
      user: this.currentUser?.id || 'anonymous',
      resource,
      result,
      ...details,
    });
  }

  /**
   * 获取审计日志
   */
  getAuditLogs(limit: number = 100): Array<{
    id: number;
    userId: string;
    action: string;
    resource: string;
    result: string;
    timestamp: Date;
    details: Record<string, unknown>;
  }> {
    const rows = this.db.all(
      'SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT ?',
      [limit]
    );

    return rows.map((row: any) => ({
      id: row.id,
      userId: row.user_id,
      action: row.action,
      resource: row.resource,
      result: row.result,
      timestamp: new Date(row.timestamp),
      details: JSON.parse(row.details || '{}'),
    }));
  }
}

// 全局实例
let securityManager: SecurityManager | null = null;

export function getSecurityManager(): SecurityManager {
  if (!securityManager) {
    securityManager = new SecurityManager();
  }
  return securityManager;
}
