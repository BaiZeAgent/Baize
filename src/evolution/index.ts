/**
 * 自进化系统 - 主入口
 * 
 * 整合角色团队、权限管理、审批流程和执行器
 */
import {
  Role,
  RoleThought,
  EvolutionRequest,
  EvolutionHistory,
  EvolutionPermission,
} from '../types';
import { getRoleTeamManager, RoleTeamManager } from './team';
import { getPermissionManager, PermissionManager } from './permission';
import { getApprovalManager, ApprovalManager } from './approval';
import { getEvolutionExecutor, EvolutionExecutor } from './executor';
import { getDatabase } from '../memory/database';
import { getLogger } from '../observability/logger';
import { v4 as uuidv4 } from 'uuid';

const logger = getLogger('evolution');

// 导出子模块
export { getRoleTeamManager, RoleTeamManager } from './team';
export { getPermissionManager, PermissionManager } from './permission';
export { getApprovalManager, ApprovalManager } from './approval';
export { getEvolutionExecutor, EvolutionExecutor } from './executor';

/**
 * 自进化管理器
 */
export class EvolutionManager {
  private db = getDatabase();
  private roleTeam: RoleTeamManager;
  private permission: PermissionManager;
  private approval: ApprovalManager;
  private executor: EvolutionExecutor;
  private maxIterations = 3;

  constructor() {
    this.roleTeam = getRoleTeamManager();
    this.permission = getPermissionManager();
    this.approval = getApprovalManager();
    this.executor = getEvolutionExecutor();
  }

  /**
   * 创建进化请求
   */
  createRequest(
    type: EvolutionRequest['type'],
    description: string,
    targetPath: string,
    changes: Record<string, unknown>
  ): EvolutionRequest {
    const rule = this.permission.checkPermission(targetPath);

    const request: EvolutionRequest = {
      id: uuidv4(),
      type,
      description,
      targetPath,
      changes,
      reason: '',
      riskAssessment: '',
      permission: rule.permission,
      status: 'pending',
      createdAt: new Date(),
    };

    logger.info(`创建进化请求: ${request.id}`, { type, targetPath, permission: rule.permission });
    return request;
  }

  /**
   * 执行进化流程
   */
  async evolve(request: EvolutionRequest): Promise<boolean> {
    logger.info(`开始进化流程: ${request.id}`);

    // 检查权限
    if (request.permission === EvolutionPermission.DENIED) {
      logger.error(`进化请求被拒绝: ${request.targetPath}`);
      return false;
    }

    // 执行
    const result = await this.executor.execute(request);

    if (result.success) {
      request.status = 'completed';
      logger.info(`进化完成: ${request.id}`);
      return true;
    }

    if (result.changes?.approvalId) {
      request.status = 'pending';
      logger.info(`进化等待审批: ${result.changes.approvalId}`);
      return false;
    }

    request.status = 'rejected';
    logger.error(`进化失败: ${result.message}`);
    return false;
  }

  /**
   * 处理审批
   */
  async handleApproval(approvalId: string, approved: boolean, reason?: string): Promise<boolean> {
    if (approved) {
      return this.approval.approve(approvalId, 'user');
    } else {
      return this.approval.reject(approvalId, reason || '用户拒绝');
    }
  }

  /**
   * 获取历史记录
   */
  getHistory(limit: number = 100): EvolutionHistory[] {
    const rows = this.db.all<{
      id: number;
      timestamp: string;
      request_id: string;
      type: string;
      target: string;
      description: string;
      result: string;
    }>('SELECT * FROM evolution_history ORDER BY timestamp DESC LIMIT ?', [limit]);

    return rows.map(row => ({
      id: row.id,
      timestamp: new Date(row.timestamp),
      requestId: row.request_id,
      type: row.type,
      target: row.target,
      description: row.description,
      result: row.result,
    }));
  }

  /**
   * 获取待审批列表
   */
  getPendingApprovals() {
    return this.approval.getPendingApprovals();
  }
}

// 全局实例
let evolutionManager: EvolutionManager | null = null;

export function getEvolutionManager(): EvolutionManager {
  if (!evolutionManager) {
    evolutionManager = new EvolutionManager();
  }
  return evolutionManager;
}
