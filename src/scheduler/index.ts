/**
 * 任务调度器
 */
import { Task, TaskStatus, Scheduling, RetryPolicy } from '../types';
import { getLogger } from '../observability/logger';
import { v4 as uuidv4 } from 'uuid';

const logger = getLogger('scheduler');

/**
 * 调度任务
 */
export interface ScheduledTask {
  id: string;
  task: Task;
  status: TaskStatus;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  result?: unknown;
  error?: string;
  retryCount: number;
}

/**
 * 任务调度器
 */
export class TaskScheduler {
  private taskQueue: Map<string, ScheduledTask> = new Map();
  private maxConcurrent: number;
  private runningCount: number = 0;

  constructor(maxConcurrent: number = 10) {
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * 调度任务
   */
  schedule(task: Task): string {
    const scheduledTask: ScheduledTask = {
      id: uuidv4(),
      task,
      status: TaskStatus.PENDING,
      createdAt: new Date(),
      retryCount: 0,
    };

    this.taskQueue.set(scheduledTask.id, scheduledTask);
    logger.info(`任务已调度: ${task.id}`, { scheduledId: scheduledTask.id });
    
    return scheduledTask.id;
  }

  /**
   * 批量调度
   */
  scheduleBatch(tasks: Task[]): string[] {
    return tasks.map(task => this.schedule(task));
  }

  /**
   * 获取任务状态
   */
  getStatus(scheduledId: string): ScheduledTask | undefined {
    return this.taskQueue.get(scheduledId);
  }

  /**
   * 获取可执行的任务
   */
  getExecutableTasks(): ScheduledTask[] {
    const executable: ScheduledTask[] = [];
    
    for (const [, task] of this.taskQueue) {
      if (task.status === TaskStatus.PENDING && this.runningCount < this.maxConcurrent) {
        executable.push(task);
      }
    }
    
    return executable;
  }

  /**
   * 标记任务开始
   */
  markStarted(scheduledId: string): void {
    const task = this.taskQueue.get(scheduledId);
    if (task) {
      task.status = TaskStatus.RUNNING;
      task.startedAt = new Date();
      this.runningCount++;
      logger.debug(`任务开始: ${scheduledId}`);
    }
  }

  /**
   * 标记任务完成
   */
  markCompleted(scheduledId: string, result: unknown): void {
    const task = this.taskQueue.get(scheduledId);
    if (task) {
      task.status = TaskStatus.COMPLETED;
      task.completedAt = new Date();
      task.result = result;
      this.runningCount--;
      logger.info(`任务完成: ${scheduledId}`);
    }
  }

  /**
   * 标记任务失败
   */
  markFailed(scheduledId: string, error: string): void {
    const task = this.taskQueue.get(scheduledId);
    if (task) {
      task.status = TaskStatus.FAILED;
      task.completedAt = new Date();
      task.error = error;
      this.runningCount--;
      logger.error(`任务失败: ${scheduledId}`, { error });
    }
  }

  /**
   * 取消任务
   */
  cancel(scheduledId: string): boolean {
    const task = this.taskQueue.get(scheduledId);
    if (task && task.status === TaskStatus.PENDING) {
      task.status = TaskStatus.CANCELLED;
      logger.info(`任务已取消: ${scheduledId}`);
      return true;
    }
    return false;
  }

  /**
   * 重试任务
   */
  retry(scheduledId: string, maxRetries: number = 3): boolean {
    const task = this.taskQueue.get(scheduledId);
    if (task && task.status === TaskStatus.FAILED && task.retryCount < maxRetries) {
      task.status = TaskStatus.PENDING;
      task.retryCount++;
      task.error = undefined;
      logger.info(`任务重试: ${scheduledId}`, { retryCount: task.retryCount });
      return true;
    }
    return false;
  }

  /**
   * 获取所有任务
   */
  getAllTasks(): ScheduledTask[] {
    return Array.from(this.taskQueue.values());
  }

  /**
   * 清理已完成任务
   */
  cleanup(): void {
    for (const [id, task] of this.taskQueue) {
      if (task.status === TaskStatus.COMPLETED || 
          task.status === TaskStatus.CANCELLED) {
        this.taskQueue.delete(id);
      }
    }
    logger.debug('已清理完成任务');
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
  } {
    let pending = 0, running = 0, completed = 0, failed = 0;
    
    for (const task of this.taskQueue.values()) {
      switch (task.status) {
        case TaskStatus.PENDING: pending++; break;
        case TaskStatus.RUNNING: running++; break;
        case TaskStatus.COMPLETED: completed++; break;
        case TaskStatus.FAILED: failed++; break;
      }
    }
    
    return { total: this.taskQueue.size, pending, running, completed, failed };
  }
}

// 全局实例
let schedulerInstance: TaskScheduler | null = null;

export function getScheduler(): TaskScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new TaskScheduler();
  }
  return schedulerInstance;
}
