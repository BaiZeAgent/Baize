/**
 * 权限管理 - 自进化权限控制
 */
import { EvolutionPermission, EvolutionScope } from '../../types';
import { getDatabase } from '../../memory/database';
import { getLogger } from '../../observability/logger';

const logger = getLogger('evolution:permission');

/**
 * 权限规则
 */
export interface PermissionRule {
  path: string;
  permission: EvolutionPermission;
  reason: string;
  reviewer?: string;
  autoBackup: boolean;
}

/**
 * 默认权限规则
 */
const DEFAULT_RULES: PermissionRule[] = [
  // 禁止区域
  { path: 'core/', permission: EvolutionPermission.DENIED, reason: '核心代码', autoBackup: false },
  { path: 'security/', permission: EvolutionPermission.DENIED, reason: '安全层', autoBackup: false },
  { path: 'config/system.yaml', permission: EvolutionPermission.DENIED, reason: '系统配置', autoBackup: false },
  { path: 'config/evolution.yaml', permission: EvolutionPermission.DENIED, reason: '进化配置', autoBackup: false },
  
  // 限制区域
  { path: 'skills/', permission: EvolutionPermission.CONFIRM, reason: '技能代码', autoBackup: true },
  { path: 'prompts/', permission: EvolutionPermission.CONFIRM, reason: '提示词', autoBackup: true },
  { path: 'memory/', permission: EvolutionPermission.CONFIRM, reason: '记忆系统', autoBackup: true },
  
  // 自由区域
  { path: 'skills/new/', permission: EvolutionPermission.AUTO, reason: '新技能', autoBackup: true },
  { path: 'data/', permission: EvolutionPermission.AUTO, reason: '数据文件', autoBackup: false },
];

/**
 * 权限管理器
 */
export class PermissionManager {
  private db = getDatabase();
  private rules: PermissionRule[] = [...DEFAULT_RULES];

  /**
   * 检查权限
   */
  checkPermission(targetPath: string): PermissionRule {
    // 按顺序匹配规则
    for (const rule of this.rules) {
      if (targetPath.startsWith(rule.path)) {
        logger.debug(`权限检查: ${targetPath} -> ${rule.permission}`);
        return rule;
      }
    }

    // 默认需要确认
    return {
      path: targetPath,
      permission: EvolutionPermission.CONFIRM,
      reason: '未知路径',
      autoBackup: true,
    };
  }

  /**
   * 添加规则
   */
  addRule(rule: PermissionRule): void {
    this.rules.unshift(rule); // 新规则优先
    logger.info(`添加权限规则: ${rule.path} -> ${rule.permission}`);
  }

  /**
   * 移除规则
   */
  removeRule(path: string): boolean {
    const index = this.rules.findIndex(r => r.path === path);
    if (index >= 0) {
      this.rules.splice(index, 1);
      logger.info(`移除权限规则: ${path}`);
      return true;
    }
    return false;
  }

  /**
   * 获取所有规则
   */
  getRules(): PermissionRule[] {
    return [...this.rules];
  }

  /**
   * 获取进化范围
   */
  getEvolutionScope(path: string): EvolutionScope {
    const rule = this.checkPermission(path);
    return {
      path: rule.path,
      permission: rule.permission,
      reason: rule.reason,
      reviewer: rule.reviewer,
    };
  }

  /**
   * 是否需要备份
   */
  needsBackup(targetPath: string): boolean {
    const rule = this.checkPermission(targetPath);
    return rule.autoBackup;
  }

  /**
   * 是否允许进化
   */
  isEvolutionAllowed(targetPath: string): boolean {
    const rule = this.checkPermission(targetPath);
    return rule.permission !== EvolutionPermission.DENIED;
  }
}

// 全局实例
let permissionManager: PermissionManager | null = null;

export function getPermissionManager(): PermissionManager {
  if (!permissionManager) {
    permissionManager = new PermissionManager();
  }
  return permissionManager;
}
