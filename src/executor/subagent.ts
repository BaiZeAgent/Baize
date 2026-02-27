/**
 * 子Agent管理器 - 并行任务处理
 */

import { v4 as uuidv4 } from 'uuid';
import { getLogger } from '../observability/logger';
import { getExecutor } from './parallel-executor';
import type { ExecutionResult } from './parallel-executor';
import { getSandboxManager, SandboxInstance } from '../sandbox';
import { Task, TaskResult, SkillContext } from '../types';

const logger = getLogger('executor:subagent');

export enum SubAgentStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  TIMEOUT = 'timeout',
  CANCELLED = 'cancelled',
}

export enum SubAgentType {
  SYNC = 'sync',
  ASYNC = 'async',
  INDEPENDENT = 'independent',
}

export interface SubAgentConfig {
  type: SubAgentType;
  name: string;
  description?: string;
  tasks: Task[];
  parallelGroups: string[][];
  context: SkillContext;
  timeout?: number;
  useSandbox?: boolean;
  parentSessionId?: string;
}

export interface SubAgentInfo {
  id: string;
  config: SubAgentConfig;
  status: SubAgentStatus;
  result?: ExecutionResult;
  sandbox?: SandboxInstance;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

export class SubAgentManager {
  private subAgents: Map<string, SubAgentInfo> = new Map();
  private executor = getExecutor();
  private sandboxManager = getSandboxManager();

  async create(config: SubAgentConfig): Promise<SubAgentInfo> {
    const id = `subagent-${uuidv4().slice(0, 8)}`;
    const info: SubAgentInfo = {
      id, config, status: SubAgentStatus.PENDING, createdAt: new Date(),
    };

    if (config.useSandbox && config.parentSessionId) {
      try {
        info.sandbox = await this.sandboxManager.create({
          mounts: [{ host: `./data/sandbox/${id}`, container: '/workspace', mode: 'rw' }],
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

  async execute(id: string): Promise<SubAgentInfo> {
    const info = this.subAgents.get(id);
    if (!info) throw new Error(`子Agent不存在: ${id}`);
    
    info.status = SubAgentStatus.RUNNING;
    info.startedAt = new Date();
    logger.info(`[subagent-execute] id=${id}`);

    try {
      switch (info.config.type) {
        case SubAgentType.SYNC: return await this.executeSync(info);
        case SubAgentType.ASYNC: return this.executeAsync(info);
        case SubAgentType.INDEPENDENT: return await this.executeIndependent(info);
        default: throw new Error(`未知子Agent类型: ${info.config.type}`);
      }
    } catch (error) {
      info.status = SubAgentStatus.FAILED;
      info.error = String(error);
      info.completedAt = new Date();
      return info;
    }
  }

  private async executeSync(info: SubAgentInfo): Promise<SubAgentInfo> {
    const { config } = info;
    const result = await this.executor.execute(config.tasks, config.parallelGroups, config.context);
    info.result = result;
    info.status = result.success ? SubAgentStatus.COMPLETED : SubAgentStatus.FAILED;
    info.completedAt = new Date();
    logger.info(`[subagent-sync-done] id=${info.id} success=${result.success}`);
    return info;
  }

  private executeAsync(info: SubAgentInfo): SubAgentInfo {
    const { config } = info;
    this.executor.execute(config.tasks, config.parallelGroups, config.context)
      .then(result => {
        info.result = result;
        info.status = result.success ? SubAgentStatus.COMPLETED : SubAgentStatus.FAILED;
        info.completedAt = new Date();
        logger.info(`[subagent-async-done] id=${info.id} success=${result.success}`);
      })
      .catch(error => {
        info.status = SubAgentStatus.FAILED;
        info.error = String(error);
        info.completedAt = new Date();
      });
    return info;
  }

  private async executeIndependent(info: SubAgentInfo): Promise<SubAgentInfo> {
    return this.executeSync(info);
  }

  getStatus(id: string): SubAgentInfo | undefined { return this.subAgents.get(id); }

  async wait(id: string, timeout?: number): Promise<SubAgentInfo> {
    const info = this.subAgents.get(id);
    if (!info) throw new Error(`子Agent不存在: ${id}`);
    
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

  async cancel(id: string): Promise<boolean> {
    const info = this.subAgents.get(id);
    if (!info) return false;
    if (info.status !== SubAgentStatus.RUNNING && info.status !== SubAgentStatus.PENDING) return false;
    
    logger.info(`[subagent-cancel] id=${id}`);
    
    if (info.sandbox) {
      await info.sandbox.destroy();
    }
    
    info.status = SubAgentStatus.CANCELLED;
    info.completedAt = new Date();
    return true;
  }

  getAll(): SubAgentInfo[] { return Array.from(this.subAgents.values()); }

  getRunning(): SubAgentInfo[] {
    return this.getAll().filter(info => info.status === SubAgentStatus.RUNNING || info.status === SubAgentStatus.PENDING);
  }

  cleanup(): number {
    let cleaned = 0;
    for (const [id, info] of this.subAgents) {
      if (info.status !== SubAgentStatus.RUNNING && info.status !== SubAgentStatus.PENDING) {
        if (info.sandbox) info.sandbox.destroy().catch(() => {});
        this.subAgents.delete(id);
        cleaned++;
      }
    }
    logger.info(`[subagent-cleanup] cleaned=${cleaned}`);
    return cleaned;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

let subAgentManagerInstance: SubAgentManager | null = null;

export function getSubAgentManager(): SubAgentManager {
  if (!subAgentManagerInstance) subAgentManagerInstance = new SubAgentManager();
  return subAgentManagerInstance;
}

export function resetSubAgentManager(): void { subAgentManagerInstance = null; }
