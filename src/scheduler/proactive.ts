/**
 * 主动任务系统
 */
import { ProactiveTask, TaskStatus, TriggerType } from '../types';
import { getDatabase } from '../memory/database';
import { getLogger } from '../observability/logger';
import { v4 as uuidv4 } from 'uuid';

const logger = getLogger('proactive');

export interface TriggerConfig {
  type: TriggerType;
  cron?: string;
  interval?: number;
  eventType?: string;
  condition?: string;
}

export interface ActionConfig {
  skillName: string;
  params: Record<string, unknown>;
  notifyUser: boolean;
}

export class ProactiveTaskManager {
  private db = getDatabase();
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private eventHandlers: Map<string, Set<string>> = new Map();

  createTask(triggerConfig: TriggerConfig, actionConfig: ActionConfig): ProactiveTask {
    const task: ProactiveTask = {
      id: uuidv4(),
      type: triggerConfig.type,
      triggerConfig: triggerConfig as unknown as Record<string, unknown>,
      actionConfig: actionConfig as unknown as Record<string, unknown>,
      status: TaskStatus.PENDING,
      createdAt: new Date(),
    };
    this.db.run(
      `INSERT INTO proactive_tasks (id, type, trigger_config, action_config, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [task.id, task.type, JSON.stringify(task.triggerConfig), JSON.stringify(task.actionConfig), task.status, task.createdAt.toISOString()]
    );
    this.registerTrigger(task);
    logger.info(`创建主动任务: ${task.id}`, { type: task.type });
    return task;
  }

  private registerTrigger(task: ProactiveTask): void {
    const config = task.triggerConfig as unknown as TriggerConfig;
    switch (config.type) {
      case 'time': this.registerTimeTrigger(task, config); break;
      case 'event': this.registerEventTrigger(task, config); break;
      case 'condition': this.registerConditionTrigger(task, config); break;
    }
  }

  private registerTimeTrigger(task: ProactiveTask, config: TriggerConfig): void {
    if (config.interval) {
      const timer = setInterval(() => this.executeTask(task), config.interval * 1000);
      this.timers.set(task.id, timer);
      logger.debug(`注册时间触发器: ${task.id}, 间隔 ${config.interval}s`);
    }
  }

  private registerEventTrigger(task: ProactiveTask, config: TriggerConfig): void {
    if (config.eventType) {
      if (!this.eventHandlers.has(config.eventType)) this.eventHandlers.set(config.eventType, new Set());
      this.eventHandlers.get(config.eventType)!.add(task.id);
      logger.debug(`注册事件触发器: ${task.id}, 事件 ${config.eventType}`);
    }
  }

  private registerConditionTrigger(task: ProactiveTask, config: TriggerConfig): void {
    logger.debug(`注册条件触发器: ${task.id}, 条件 ${config.condition}`);
  }

  triggerEvent(eventType: string, data?: Record<string, unknown>): void {
    const taskIds = this.eventHandlers.get(eventType);
    if (taskIds) {
      for (const taskId of taskIds) {
        const task = this.getTask(taskId);
        if (task) this.executeTask(task);
      }
    }
  }

  checkConditions(context: Record<string, unknown>): void {
    const tasks = this.getTasksByType('condition');
    for (const task of tasks) {
      const config = task.triggerConfig as unknown as TriggerConfig;
      if (config.condition && this.evaluateCondition(config.condition, context)) {
        this.executeTask(task);
      }
    }
  }

  private evaluateCondition(condition: string, context: Record<string, unknown>): boolean {
    try {
      const fn = new Function('context', `return ${condition}`);
      return fn(context);
    } catch {
      logger.warn(`条件评估失败: ${condition}`);
      return false;
    }
  }

  private async executeTask(task: ProactiveTask, data?: Record<string, unknown>): Promise<void> {
    logger.info(`执行主动任务: ${task.id}`);
    this.db.run(`INSERT INTO task_history (task_id, started_at, status) VALUES (?, ?, ?)`, [task.id, new Date().toISOString(), TaskStatus.RUNNING]);
    try {
      this.db.run(`UPDATE proactive_tasks SET last_run_at = ?, status = ? WHERE id = ?`, [new Date().toISOString(), TaskStatus.COMPLETED, task.id]);
      logger.info(`主动任务执行完成: ${task.id}`);
    } catch (error) {
      logger.error(`主动任务执行失败: ${task.id}`, { error });
    }
  }

  getTask(taskId: string): ProactiveTask | undefined {
    const row = this.db.get<{
      id: string; type: string; trigger_config: string; action_config: string; status: string; created_at: string; last_run_at: string | null; next_run_at: string | null;
    }>('SELECT * FROM proactive_tasks WHERE id = ?', [taskId]);
    if (row) {
      return {
        id: row.id, type: row.type as TriggerType, triggerConfig: JSON.parse(row.trigger_config), actionConfig: JSON.parse(row.action_config),
        status: row.status as TaskStatus, createdAt: new Date(row.created_at),
        lastRunAt: row.last_run_at ? new Date(row.last_run_at) : undefined, nextRunAt: row.next_run_at ? new Date(row.next_run_at) : undefined,
      };
    }
    return undefined;
  }

  getTasksByType(type: TriggerType): ProactiveTask[] {
    const rows = this.db.all<{ id: string; type: string; trigger_config: string; action_config: string; status: string; created_at: string }>(
      'SELECT * FROM proactive_tasks WHERE type = ?', [type]
    );
    return rows.map((row: { id: string; type: string; trigger_config: string; action_config: string; status: string; created_at: string }) => ({
      id: row.id, type: row.type as TriggerType, triggerConfig: JSON.parse(row.trigger_config), actionConfig: JSON.parse(row.action_config),
      status: row.status as TaskStatus, createdAt: new Date(row.created_at),
    }));
  }

  deleteTask(taskId: string): boolean {
    const timer = this.timers.get(taskId);
    if (timer) { clearInterval(timer); this.timers.delete(taskId); }
    this.db.run('DELETE FROM proactive_tasks WHERE id = ?', [taskId]);
    logger.info(`删除主动任务: ${taskId}`);
    return true;
  }

  getAllTasks(): ProactiveTask[] {
    const rows = this.db.all<{ id: string; type: string; trigger_config: string; action_config: string; status: string; created_at: string }>('SELECT * FROM proactive_tasks');
    return rows.map((row: { id: string; type: string; trigger_config: string; action_config: string; status: string; created_at: string }) => ({
      id: row.id, type: row.type as TriggerType, triggerConfig: JSON.parse(row.trigger_config), actionConfig: JSON.parse(row.action_config),
      status: row.status as TaskStatus, createdAt: new Date(row.created_at),
    }));
  }
}

let proactiveManager: ProactiveTaskManager | null = null;

export function getProactiveManager(): ProactiveTaskManager {
  if (!proactiveManager) proactiveManager = new ProactiveTaskManager();
  return proactiveManager;
}
