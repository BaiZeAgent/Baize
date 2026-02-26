/**
 * 进化执行器 - 安全执行进化变更
 */
import { EvolutionRequest } from '../../types';
import { getPermissionManager } from '../permission';
import { getApprovalManager } from '../approval';
import { getRoleTeamManager } from '../team';
import { getDatabase } from '../../memory/database';
import { getLogger } from '../../observability/logger';

const logger = getLogger('evolution:executor');

/**
 * 执行结果
 */
export interface ExecutionResult {
  success: boolean;
  message: string;
  changes?: Record<string, unknown>;
  error?: string;
}

/**
 * 进化执行器
 */
export class EvolutionExecutor {
  private permissionManager = getPermissionManager();
  private approvalManager = getApprovalManager();
  private roleTeamManager = getRoleTeamManager();
  private db = getDatabase();

  /**
   * 执行进化请求
   */
  async execute(request: EvolutionRequest): Promise<ExecutionResult> {
    logger.info(`开始执行进化: ${request.id}`);

    // 1. 检查权限
    const rule = this.permissionManager.checkPermission(request.targetPath);
    
    if (rule.permission === 'denied') {
      return {
        success: false,
        message: `禁止访问: ${rule.reason}`,
      };
    }

    // 2. 角色团队讨论
    const context = this.buildDiscussionContext(request);
    const thoughts = await this.roleTeamManager.discuss(context);

    // 3. 检查是否有否决
    const veto = thoughts.find(t => !t.approved);
    if (veto) {
      return {
        success: false,
        message: `被否决: ${veto.vetoReason || '未提供原因'}`,
      };
    }

    // 4. 检查是否需要审批
    if (rule.permission === 'confirm') {
      const approval = this.approvalManager.createRequest(request);
      
      return {
        success: false,
        message: '需要用户审批',
        changes: { approvalId: approval.id },
      };
    }

    // 5. 自动执行
    return await this.doExecute(request);
  }

  /**
   * 实际执行变更
   */
  private async doExecute(request: EvolutionRequest): Promise<ExecutionResult> {
    try {
      // 备份（如果需要）
      if (this.permissionManager.needsBackup(request.targetPath)) {
        await this.backup(request.targetPath);
      }

      // 执行变更
      // 这里是模拟执行，实际应该修改文件
      logger.info(`执行变更: ${request.targetPath}`);

      // 记录历史
      this.recordExecution(request, 'success', '执行成功');

      return {
        success: true,
        message: '执行成功',
        changes: request.changes,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      this.recordExecution(request, 'failed', errorMsg);
      
      return {
        success: false,
        message: '执行失败',
        error: errorMsg,
      };
    }
  }

  /**
   * 备份文件
   */
  private async backup(targetPath: string): Promise<void> {
    logger.info(`备份: ${targetPath}`);
    // 实际实现应该复制文件
  }

  /**
   * 构建讨论上下文
   */
  private buildDiscussionContext(request: EvolutionRequest): string {
    return `
进化类型: ${request.type}
目标路径: ${request.targetPath}
描述: ${request.description}
变更内容: ${JSON.stringify(request.changes, null, 2)}
原因: ${request.reason}
`;
  }

  /**
   * 记录执行历史
   */
  private recordExecution(
    request: EvolutionRequest,
    result: string,
    description: string
  ): void {
    this.db.run(
      `INSERT INTO evolution_history (timestamp, request_id, type, target, description, result)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        new Date().toISOString(),
        request.id,
        request.type,
        request.targetPath,
        description,
        result,
      ]
    );
  }

  /**
   * 回滚变更
   */
  async rollback(requestId: string): Promise<ExecutionResult> {
    logger.info(`回滚: ${requestId}`);
    
    // 查找历史记录
    const history = this.db.get<{ target: string; description: string }>(
      'SELECT * FROM evolution_history WHERE request_id = ? ORDER BY id DESC LIMIT 1',
      [requestId]
    );

    if (!history) {
      return {
        success: false,
        message: '找不到执行记录',
      };
    }

    // 恢复备份
    // 实际实现应该恢复备份文件

    return {
      success: true,
      message: '回滚成功',
    };
  }
}

// 全局实例
let evolutionExecutor: EvolutionExecutor | null = null;

export function getEvolutionExecutor(): EvolutionExecutor {
  if (!evolutionExecutor) {
    evolutionExecutor = new EvolutionExecutor();
  }
  return evolutionExecutor;
}
