/**
 * 状态管理器 - Agent状态持久化
 * 
 * 第十四章 状态管理
 */

import { getLogger } from '../../observability/logger';
import { AgentState, ThoughtProcess, TaskResult, Task } from '../../types';
import { getDatabase } from '../../memory/database';

const logger = getLogger('state:manager');

/**
 * 状态管理器
 */
export class StateManager {
  private db = getDatabase();

  constructor() {
    this.initTable();
    logger.info('状态管理器初始化');
  }

  /**
   * 初始化数据库表
   */
  private initTable(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS agent_states (
        conversation_id TEXT PRIMARY KEY,
        current_phase TEXT NOT NULL,
        thought_process TEXT,
        executed_tasks TEXT,
        pending_tasks TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  /**
   * 保存状态
   */
  save(state: AgentState): void {
    this.db.run(
      `INSERT OR REPLACE INTO agent_states 
       (conversation_id, current_phase, thought_process, executed_tasks, pending_tasks, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        state.conversationId,
        state.currentPhase,
        JSON.stringify(state.thoughtProcess),
        JSON.stringify(state.executedTasks),
        JSON.stringify(state.pendingTasks),
        new Date().toISOString(),
      ]
    );

    logger.debug(`状态已保存: ${state.conversationId}`, { phase: state.currentPhase });
  }

  /**
   * 恢复状态
   */
  restore(conversationId: string): AgentState | null {
    const row = this.db.get<{
      conversation_id: string;
      current_phase: string;
      thought_process: string;
      executed_tasks: string;
      pending_tasks: string;
      created_at: string;
      updated_at: string;
    }>(
      'SELECT * FROM agent_states WHERE conversation_id = ?',
      [conversationId]
    );

    if (!row) return null;

    return {
      conversationId: row.conversation_id,
      currentPhase: row.current_phase as AgentState['currentPhase'],
      thoughtProcess: JSON.parse(row.thought_process || '{}'),
      executedTasks: JSON.parse(row.executed_tasks || '[]'),
      pendingTasks: JSON.parse(row.pending_tasks || '[]'),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  /**
   * 获取未完成的状态列表
   */
  listIncomplete(): AgentState[] {
    const rows = this.db.all<{
      conversation_id: string;
      current_phase: string;
      thought_process: string;
      executed_tasks: string;
      pending_tasks: string;
      created_at: string;
      updated_at: string;
    }>(
      "SELECT * FROM agent_states WHERE current_phase != 'completed' ORDER BY updated_at DESC"
    );

    return rows.map(row => ({
      conversationId: row.conversation_id,
      currentPhase: row.current_phase as AgentState['currentPhase'],
      thoughtProcess: JSON.parse(row.thought_process || '{}'),
      executedTasks: JSON.parse(row.executed_tasks || '[]'),
      pendingTasks: JSON.parse(row.pending_tasks || '[]'),
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));
  }

  /**
   * 删除状态
   */
  delete(conversationId: string): void {
    this.db.run('DELETE FROM agent_states WHERE conversation_id = ?', [conversationId]);
    logger.debug(`状态已删除: ${conversationId}`);
  }

  /**
   * 标记完成
   */
  markComplete(conversationId: string): void {
    this.db.run(
      "UPDATE agent_states SET current_phase = 'completed', updated_at = ? WHERE conversation_id = ?",
      [new Date().toISOString(), conversationId]
    );
    logger.debug(`状态已标记完成: ${conversationId}`);
  }

  /**
   * 创建新状态
   */
  create(conversationId: string): AgentState {
    const state: AgentState = {
      conversationId,
      currentPhase: 'thinking',
      thoughtProcess: {} as ThoughtProcess,
      executedTasks: [],
      pendingTasks: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.save(state);
    return state;
  }

  /**
   * 更新阶段
   */
  updatePhase(conversationId: string, phase: AgentState['currentPhase']): void {
    this.db.run(
      'UPDATE agent_states SET current_phase = ?, updated_at = ? WHERE conversation_id = ?',
      [phase, new Date().toISOString(), conversationId]
    );
  }

  /**
   * 添加已执行任务
   */
  addExecutedTask(conversationId: string, task: TaskResult): void {
    const state = this.restore(conversationId);
    if (state) {
      state.executedTasks.push(task);
      state.updatedAt = new Date();
      this.save(state);
    }
  }

  /**
   * 设置待执行任务
   */
  setPendingTasks(conversationId: string, tasks: Task[]): void {
    const state = this.restore(conversationId);
    if (state) {
      state.pendingTasks = tasks;
      state.updatedAt = new Date();
      this.save(state);
    }
  }
}

// 全局实例
let stateManager: StateManager | null = null;

export function getStateManager(): StateManager {
  if (!stateManager) {
    stateManager = new StateManager();
  }
  return stateManager;
}
