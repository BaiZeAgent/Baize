/**
 * 确认策略 - 用户确认机制
 */
import { RiskLevel, ConfirmAction, ConfirmationRequest } from '../../types';
import { getMemory } from '../../memory';
import { getLogger } from '../../observability/logger';

const logger = getLogger('core:confirmation');

export class ConfirmationManager {
  private memory = getMemory();
  private pendingRequests: Map<string, ConfirmationRequest> = new Map();

  needConfirm(operation: string, riskLevel: RiskLevel): boolean {
    if (this.memory.canSkipConfirm(operation)) {
      logger.debug(`操作 ${operation} 已信任，跳过确认`);
      return false;
    }
    return riskLevel !== RiskLevel.LOW;
  }

  createRequest(
    operation: string,
    riskLevel: RiskLevel,
    message: string,
    options: string[] = ['确认', '取消']
  ): ConfirmationRequest {
    const request: ConfirmationRequest = {
      id: `confirm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      operation,
      riskLevel,
      message,
      options,
      timeout: 300000,
      createdAt: new Date(),
    };
    this.pendingRequests.set(request.id, request);
    logger.info(`创建确认请求: ${operation}`, { riskLevel });
    return request;
  }

  handleResponse(requestId: string, action: ConfirmAction): void {
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      logger.warn(`未找到确认请求: ${requestId}`);
      return;
    }
    this.memory.recordEpisode('confirmation', 
      `操作: ${request.operation}, 风险: ${request.riskLevel}, 动作: ${action}`);
    if (action === ConfirmAction.CONFIRM) {
      this.memory.recordSuccess(request.operation);
    } else if (action === ConfirmAction.CANCEL) {
      this.memory.recordFailure(request.operation);
    }
    if (action === ConfirmAction.SKIP_FUTURE) {
      this.memory.remember(`skip_confirm.${request.operation}`, 'true', 1.0);
    }
    this.pendingRequests.delete(requestId);
    logger.info(`确认请求处理完成: ${requestId}, 动作: ${action}`);
  }

  getPendingRequest(requestId: string): ConfirmationRequest | undefined {
    return this.pendingRequests.get(requestId);
  }

  formatMessage(request: ConfirmationRequest): string {
    const riskEmoji = {
      [RiskLevel.LOW]: '🟢',
      [RiskLevel.MEDIUM]: '🟡',
      [RiskLevel.HIGH]: '🟠',
      [RiskLevel.CRITICAL]: '🔴',
    };
    const lines = [
      `${riskEmoji[request.riskLevel]} 需要确认操作`,
      '',
      `操作: ${request.operation}`,
      `风险等级: ${request.riskLevel}`,
      '',
      request.message,
      '',
      '请选择:',
    ];
    request.options.forEach((opt: string, idx: number) => {
      lines.push(`  ${idx + 1}. ${opt}`);
    });
    return lines.join('\n');
  }
}

let confirmationManager: ConfirmationManager | null = null;

export function getConfirmationManager(): ConfirmationManager {
  if (!confirmationManager) {
    confirmationManager = new ConfirmationManager();
  }
  return confirmationManager;
}
