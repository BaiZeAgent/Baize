/**
 * 记忆回滚 - 记忆快照和恢复
 * 
 * 第七章 7.4 记忆回滚
 * 
 * 功能：
 * 1. 创建快照
 * 2. 恢复快照
 * 3. 快照管理
 */

import { getLogger } from '../observability/logger';
import { getDatabase } from './database';

const logger = getLogger('memory:rollback');

interface MemorySnapshot {
  id: string;
  timestamp: Date;
  trigger: string;
  episodic: any[];
  declarative: any[];
  procedural: any[];
}

/**
 * 记忆回滚管理器
 */
export class MemoryRollback {
  private db = getDatabase();

  constructor() {
    this.initTable();
    logger.info('记忆回滚管理器初始化');
  }

  /**
   * 初始化快照表
   */
  private initTable(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS memory_snapshots (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        trigger TEXT NOT NULL,
        episodic TEXT,
        declarative TEXT,
        procedural TEXT
      )
    `);
  }

  /**
   * 创建快照
   */
  createSnapshot(trigger: string): MemorySnapshot {
    const id = `snapshot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // 获取当前记忆
    const episodic = this.db.all('SELECT type, content, timestamp FROM episodic_memory ORDER BY timestamp DESC LIMIT 100');
    const declarative = this.db.all('SELECT key, value, confidence FROM declarative_memory');
    const procedural = this.db.all('SELECT key, value FROM procedural_memory');

    const snapshot: MemorySnapshot = {
      id,
      timestamp: new Date(),
      trigger,
      episodic,
      declarative,
      procedural,
    };

    // 保存快照
    this.db.run(
      `INSERT INTO memory_snapshots (id, timestamp, trigger, episodic, declarative, procedural) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        snapshot.timestamp.toISOString(),
        trigger,
        JSON.stringify(episodic),
        JSON.stringify(declarative),
        JSON.stringify(procedural),
      ]
    );

    logger.info('快照已创建', { id, trigger, episodicCount: episodic.length });
    return snapshot;
  }

  /**
   * 恢复快照
   */
  rollback(snapshotId: string): boolean {
    const row = this.db.get<{
      id: string;
      timestamp: string;
      trigger: string;
      episodic: string;
      declarative: string;
      procedural: string;
    }>('SELECT * FROM memory_snapshots WHERE id = ?', [snapshotId]);

    if (!row) {
      logger.error('快照不存在', { snapshotId });
      return false;
    }

    try {
      // 清空当前记忆
      this.db.run('DELETE FROM episodic_memory');
      this.db.run('DELETE FROM declarative_memory');
      this.db.run('DELETE FROM procedural_memory');

      // 恢复快照
      const episodic = JSON.parse(row.episodic || '[]');
      const declarative = JSON.parse(row.declarative || '[]');
      const procedural = JSON.parse(row.procedural || '[]');

      for (const e of episodic) {
        this.db.run(
          'INSERT INTO episodic_memory (type, content, timestamp) VALUES (?, ?, ?)',
          [e.type, e.content, e.timestamp]
        );
      }

      for (const d of declarative) {
        this.db.run(
          'INSERT INTO declarative_memory (key, value, confidence) VALUES (?, ?, ?)',
          [d.key, d.value, d.confidence]
        );
      }

      for (const p of procedural) {
        this.db.run(
          'INSERT INTO procedural_memory (key, value) VALUES (?, ?)',
          [p.key, p.value]
        );
      }

      logger.info('快照已恢复', { snapshotId, trigger: row.trigger });
      return true;
    } catch (error) {
      logger.error('快照恢复失败', { snapshotId, error });
      return false;
    }
  }

  /**
   * 列出快照
   */
  listSnapshots(limit: number = 20): MemorySnapshot[] {
    const rows = this.db.all<{
      id: string;
      timestamp: string;
      trigger: string;
      episodic: string;
      declarative: string;
      procedural: string;
    }>('SELECT * FROM memory_snapshots ORDER BY timestamp DESC LIMIT ?', [limit]);

    return rows.map(row => ({
      id: row.id,
      timestamp: new Date(row.timestamp),
      trigger: row.trigger,
      episodic: JSON.parse(row.episodic || '[]'),
      declarative: JSON.parse(row.declarative || '[]'),
      procedural: JSON.parse(row.procedural || '[]'),
    }));
  }

  /**
   * 删除快照
   */
  deleteSnapshot(snapshotId: string): void {
    this.db.run('DELETE FROM memory_snapshots WHERE id = ?', [snapshotId]);
    logger.info('快照已删除', { snapshotId });
  }

  /**
   * 清理旧快照
   */
  cleanupOldSnapshots(keepCount: number = 10): void {
    this.db.run(
      `DELETE FROM memory_snapshots WHERE id NOT IN (
        SELECT id FROM memory_snapshots ORDER BY timestamp DESC LIMIT ?
      )`,
      [keepCount]
    );
    logger.info('旧快照已清理', { keepCount });
  }
}

// 全局实例
let memoryRollback: MemoryRollback | null = null;

export function getMemoryRollback(): MemoryRollback {
  if (!memoryRollback) {
    memoryRollback = new MemoryRollback();
  }
  return memoryRollback;
}
