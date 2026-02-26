/**
 * 子Agent管理器 - 并行任务处理
 *
 * 核心功能：
 * 1. 创建子Agent
 * 2. 任务分发
 * 3. 结果收集
 * 4. 状态监控
 * 5. 资源隔离
 *
 * 子Agent类型：
 * - 同步子Agent：等待完成后继续
 * - 异步子Agent：并行执行，主进程继续
 * - 独立子Agent：完全独立，可跨会话
 */

import { v4 as uuidv4 } from 'uuid';
import { getLogger } from '../observability/logger';
import { getExecutor, ExecutionResult } from '../executor';
import { getSandboxManager, SandboxContext } from '../sandbox';
import { Task, TaskResult, SkillContext } from '../types';

const logger = getLogger('executor:subagent');

/**
 * 子Agent状态
 */
export enum SubAgentStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  TIMEOUT = 'timeout',
  CANCELLED = 'cancelled',
}

/**
 * 子Agent类型
 */
export enum SubAgentType {
  /** 同步：等待完成 */
  SYNC = 'sync',
  /** 异步：并行执行 */
  ASYNC = 'async',
  /** 独立：完全独立 */
  INDEPENDENT = 'independent',
}

/**
 * 子Agent配置
 */
export interface SubAgentConfig {
  /** 子Agent类型 */
  type: SubAgentType;
  /** 名称 */
  name: string;
  /** 描述 */
  description?: string;
  /** 任务列表 */
  tasks: Task[];
  /** 并行组 */
  parallelGroups: string[][];
  /** 技能上下文 */
  context: SkillContext;
  /** 超时（毫秒） */
  timeout?: number;
  /** 是否使用沙箱 */
  useSandbox?: boolean;
  /** 父会话ID */
  parentSessionId?: string;
}

/**
 * 子Agent信息
 */
export interface SubAgentInfo {
  /** 子Agent ID */
  id: string;
  /** 配置 */
  config: SubAgentConfig;
  /** 状态 */
  status: SubAgentStatus;
  /** 执行结果 */
  result?: ExecutionResult;
  /** 沙箱上下文 */
  sandbox?: SandboxContext;
  /** 创建时间 */
  createdAt: Date;
  /** 开始时间 */
  startedAt?: Date;
  /** 完成时间 */
  completedAt?: Date;
  /** 错误信息 */
  error?: string;
}

/**
 * 子Agent管理器
 */
export class SubAgentManager {
  private subAgents: Map<string, SubAgentInfo> = new Map();
  private executor = getExecutor();
  private sandboxManager = getSandboxManager();

  /**
   * 创建子Agent
   */
  async create(config: SubAgentConfig): Promise<SubAgentInfo> {
    const id = `subagent-${uuidv4().slice(0, 8)}`;

    const info: SubAgentInfo = {
      id,
      config,
      status: SubAgentStatus.PENDING,
      createdAt: new Date(),
    };

    // 创建沙箱（如果需要）
    if (config.useSandbox && config.parentSessionId) {
      try {
        info.sandbox = await this.sandboxManager.create({
          hostWorkdir: `./data/sandbox/${id}`,
          sessionId: id,
        });
        logger.debug(`[subagent-sandbox] id=${id}`);
      } catch (error) {
        logger.warn(`[subagent-sandbox-error] id=${id} error=${error}`);
      }
    }

    this.subAgents.set(id, info);

    logger.info(`[subagent-create] id=${id} type=${config.type} tasks=${config.tasks.length}`);

    return info;
  }

  /**
   * 执行子Agent
   */
  async execute(id: string): Promise<SubAgentInfo> {
    const info = this.subAgents.get(id);
    if (!info) {
      throw new Error(`子Agent不存在: ${id}`);
    }

    info.status = SubAgentStatus.RUNNING;
    info.startedAt = new Date();

    logger.info(`[subagent-execute] id=${id}`);

    try {
      // 根据类型执行
      switch (info.config.type) {
        case SubAgentType.SYNC:
          return await this.executeSync(info);
        case SubAgentType.ASYNC:
          return this.executeAsync(info);
        case SubAgentType.INDEPENDENT:
          return this.executeIndependent(info);
        default:
          throw new Error(`未知子Agent类型: ${info.config.type}`);
      }
    } catch (error) {
      info.status = SubAgentStatus.FAILED;
      info.error = String(error);
      info.completedAt = new Date();
      return info;
    }
  }

  /**
   * 同步执行
   */
  private async executeSync(info: SubAgentInfo): Promise<SubAgentInfo> {
    const { config } = info;

    const result = await this.executor.execute(
      config.tasks,
      config.parallelGroups,
      config.context
    );

    info.result = result;
    info.status = result.success ? SubAgentStatus.COMPLETED : SubAgentStatus.FAILED;
    info.completedAt = new Date();

    logger.info(`[subagent-sync-done] id=${info.id} success=${result.success}`);

    return info;
  }

  /**
   * 异步执行
   */
  private executeAsync(info: SubAgentInfo): SubAgentInfo {
    const { config } = info;

    // 异步执行，不等待
    this.executor.execute(
      config.tasks,
      config.parallelGroups,
      config.context
    ).then(result => {
      info.result = result;
      info.status = result.success ? SubAgentStatus.COMPLETED : SubAgentStatus.FAILED;
      info.completedAt = new Date();
      logger.info(`[subagent-async-done] id=${info.id} success=${result.success}`);
    }).catch(error => {
      info.status = SubAgentStatus.FAILED;
      info.error = String(error);
      info.completedAt = new Date();
    });

    return info;
  }

  /**
   * 独立执行
   */
  private async executeIndependent(info: SubAgentInfo): Promise<SubAgentInfo> {
    // 独立执行与同步执行类似，但使用独立的沙箱
    return this.executeSync(info);
  }

  /**
   * 获取子Agent状态
   */
  getStatus(id: string): SubAgentInfo | undefined {
    return this.subAgents.get(id);
  }

  /**
   * 等待子Agent完成
   */
  async wait(id: string, timeout?: number): Promise<SubAgentInfo> {
    const info = this.subAgents.get(id);
    if (!info) {
      throw new Error(`子Agent不存在: ${id}`);
    }

    const startTime = Date.now();
    const maxWait = timeout || info.config.timeout || 300000;

    while (info.status === SubAgentStatus.PENDING || info.status === SubAgentStatus.RUNNING) {
      if (Date.now() - startTime > maxWait) {
        info.status = SubAgentStatus.TIMEOUT;
        info.completedAt = new Date();
        break;
      }
      await this.sleep(100);
    }

    return info;
  }

  /**
   * 取消子Agent
   */
  async cancel(id: string): Promise<boolean> {
    const info = this.subAgents.get(id);
    if (!info) {
      return false;
    }

    if (info.status !== SubAgentStatus.RUNNING && info.status !== SubAgentStatus.PENDING) {
      return false;
    }

    logger.info(`[subagent-cancel] id=${id}`);

    // 销毁沙箱
    if (info.sandbox) {
      await this.sandboxManager.destroy(info.sandbox);
    }

    info.status = SubAgentStatus.CANCELLED;
    info.completedAt = new Date();

    return true;
  }

  /**
   * 获取所有子Agent
   */
  getAll(): SubAgentInfo[] {
    return Array.from(this.subAgents.values());
  }

  /**
   * 获取运行中的子Agent
   */
  getRunning(): SubAgentInfo[] {
    return this.getAll().filter(
      info => info.status === SubAgentStatus.RUNNING || info.status === SubAgentStatus.PENDING
    );
  }

  /**
   * 清理已完成的子Agent
   */
  cleanup(): number {
    let cleaned = 0;

    for (const [id, info] of this.subAgents) {
      if (info.status !== SubAgentStatus.RUNNING && info.status !== SubAgentStatus.PENDING) {
        // 销毁沙箱
        if (info.sandbox) {
          this.sandboxManager.destroy(info.sandbox).catch(() => {});
        }
        this.subAgents.delete(id);
        cleaned++;
      }
    }

    logger.info(`[subagent-cleanup] cleaned=${cleaned}`);
    return cleaned;
  }

  /**
   * 休眠
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 全局实例
let subAgentManagerInstance: SubAgentManager | null = null;

/**
 * 获取子Agent管理器实例
 */
export function getSubAgentManager(): SubAgentManager {
  if (!subAgentManagerInstance) {
    subAgentManagerInstance = new SubAgentManager();
  }
  return subAgentManagerInstance;
}

/**
 * 重置子Agent管理器实例（测试用）
 */
export function resetSubAgentManager(): void {
  subAgentManagerInstance = null;
}
