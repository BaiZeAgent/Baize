/**
 * 记忆系统 - 三层记忆结构 + 五维度学习 + 执行经验
 */
import { BaizeDatabase, getDatabase } from './database';
import { 
  EpisodicMemory, 
  DeclarativeMemory, 
  ProceduralMemory,
  TrustRecord,
} from '../types';
import { getLogger } from '../observability/logger';

const logger = getLogger('memory');

/**
 * 学习维度
 */
export enum LearningDimension {
  USER_PREFERENCE = 'user_preference',
  TASK_PATTERN = 'task_pattern',
  ERROR_RECOVERY = 'error_recovery',
  SKILL_EVOLUTION = 'skill_evolution',
  KNOWLEDGE_ACCUMULATION = 'knowledge',
}

/**
 * 执行经验
 */
export interface ExecutionExperience {
  id?: number;
  task: string;           // 任务描述
  tool: string;           // 使用的工具
  params: Record<string, unknown>; // 参数
  success: boolean;       // 是否成功
  context: string;        // 上下文关键词（B站、天气、文件等）
  errorMessage?: string;  // 失败原因
  timestamp: number;      // 时间戳
}

/**
 * 记忆系统
 */
export class MemorySystem {
  private db: BaizeDatabase;

  constructor() {
    this.db = getDatabase();
    this.initExperienceTable();
  }

  /**
   * 初始化经验表
   */
  private initExperienceTable(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS execution_experience (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task TEXT NOT NULL,
        tool TEXT NOT NULL,
        params TEXT,
        success INTEGER NOT NULL,
        context TEXT,
        error_message TEXT,
        timestamp INTEGER
      )
    `);
  }

  // ═══════════════════════════════════════════════════════════════
  // 执行经验
  // ═══════════════════════════════════════════════════════════════

  /**
   * 记录执行经验
   */
  recordExperience(exp: ExecutionExperience): void {
    const timestamp = exp.timestamp || Date.now();
    
    this.db.run(
      `INSERT INTO execution_experience (task, tool, params, success, context, error_message, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        exp.task,
        exp.tool,
        JSON.stringify(exp.params || {}),
        exp.success ? 1 : 0,
        exp.context || '',
        exp.errorMessage || '',
        timestamp
      ]
    );
    
    logger.debug(`记录执行经验: ${exp.task.slice(0, 30)} -> ${exp.tool} (${exp.success ? '成功' : '失败'})`);
  }

  /**
   * 查找相似任务的成功经验
   */
  findSuccessExperience(task: string, excludeTool?: string): ExecutionExperience | null {
    // 提取关键词
    const keywords = this.extractKeywords(task);
    
    // 查找成功的经验
    const rows = this.db.all(
      `SELECT * FROM execution_experience 
       WHERE success = 1 
       ORDER BY timestamp DESC 
       LIMIT 20`,
      []
    );

    for (const row of rows) {
      const exp: ExecutionExperience = {
        id: row.id as number,
        task: row.task as string,
        tool: row.tool as string,
        params: JSON.parse(row.params as string || '{}'),
        success: row.success === 1,
        context: row.context as string,
        timestamp: row.timestamp as number,
      };

      // 排除指定工具
      if (excludeTool && exp.tool === excludeTool) {
        continue;
      }

      // 检查关键词匹配
      const expKeywords = this.extractKeywords(exp.task + ' ' + exp.context);
      const matchScore = this.calculateMatchScore(keywords, expKeywords);
      
      if (matchScore > 0.3) {
        logger.info(`[经验] 找到相似成功经验: ${exp.task.slice(0, 30)} -> ${exp.tool}`);
        return exp;
      }
    }

    return null;
  }

  /**
   * 查找失败经验（避免重复失败）
   */
  findFailedTools(task: string): string[] {
    const keywords = this.extractKeywords(task);
    const failedTools: string[] = [];

    const rows = this.db.all(
      `SELECT DISTINCT tool FROM execution_experience 
       WHERE success = 0 AND timestamp > ?`,
      [Date.now() - 7 * 24 * 60 * 60 * 1000] // 最近7天
    );

    for (const row of rows) {
      failedTools.push(row.tool as string);
    }

    return failedTools;
  }

  /**
   * 获取工具的成功率
   */
  getToolSuccessRate(tool: string): { success: number; total: number; rate: number } {
    const result = this.db.get(
      `SELECT 
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as success,
        COUNT(*) as total
       FROM execution_experience 
       WHERE tool = ?`,
      [tool]
    );

    const success = (result?.success as number) || 0;
    const total = (result?.total as number) || 0;
    const rate = total > 0 ? success / total : 0;

    return { success, total, rate };
  }

  /**
   * 提取关键词
   */
  private extractKeywords(text: string): string[] {
    // 简单的关键词提取
    const stopWords = new Set(['的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这', '那', '什么', '怎么', '帮', '请', '能', '可以']);
    
    const words = text.toLowerCase()
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 1 && !stopWords.has(w));
    
    return [...new Set(words)];
  }

  /**
   * 计算关键词匹配分数
   */
  private calculateMatchScore(keywords1: string[], keywords2: string[]): number {
    if (keywords1.length === 0 || keywords2.length === 0) return 0;
    
    const set2 = new Set(keywords2);
    const matches = keywords1.filter(k => set2.has(k)).length;
    
    return matches / Math.max(keywords1.length, keywords2.length);
  }

  // ═══════════════════════════════════════════════════════════════
  // 情景记忆
  // ═══════════════════════════════════════════════════════════════

  recordEpisode(type: string, content: string): number {
    const timestamp = new Date().toISOString();
    this.db.run(
      'INSERT INTO episodic_memory (type, timestamp, content) VALUES (?, ?, ?)',
      [type, timestamp, content]
    );
    
    const result = this.db.get<{ id: number }>(
      'SELECT last_insert_rowid() as id'
    );
    
    logger.debug(`记录情景记忆: ${type}`);
    return result?.id || 0;
  }

  getEpisodes(type?: string, limit: number = 100): EpisodicMemory[] {
    let sql = 'SELECT * FROM episodic_memory';
    const params: (string | number)[] = [];
    
    if (type) {
      sql += ' WHERE type = ?';
      params.push(type);
    }
    
    sql += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);
    
    const rows = this.db.all(sql, params);
    return rows.map(row => ({
      id: row.id as number,
      type: row.type as string,
      timestamp: new Date(row.timestamp as string),
      content: row.content as string,
      createdAt: new Date(row.created_at as string),
    }));
  }

  getRecentConversation(turns: number = 10): EpisodicMemory[] {
    return this.getEpisodes('conversation', turns);
  }

  // ═══════════════════════════════════════════════════════════════
  // 声明式记忆
  // ═══════════════════════════════════════════════════════════════

  remember(key: string, value: string, confidence: number = 0.5): void {
    const existing = this.db.get<DeclarativeMemory>(
      'SELECT * FROM declarative_memory WHERE key = ?',
      [key]
    );

    const now = new Date().toISOString();
    
    if (existing) {
      this.db.run(
        `UPDATE declarative_memory 
         SET value = ?, 
             confidence = ?, 
             times_reinforced = times_reinforced + 1,
             updated_at = ?
         WHERE key = ?`,
        [value, confidence, now, key]
      );
      logger.debug(`强化记忆: ${key}`);
    } else {
      this.db.run(
        `INSERT INTO declarative_memory (key, value, confidence, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        [key, value, confidence, now, now]
      );
      logger.debug(`创建记忆: ${key}`);
    }
  }

  recall(key: string): { value: string; confidence: number } | null {
    const result = this.db.get<DeclarativeMemory>(
      'SELECT value, confidence FROM declarative_memory WHERE key = ?',
      [key]
    );
    
    if (result) {
      logger.debug(`回忆: ${key} = ${result.value}`);
      return { value: result.value as string, confidence: result.confidence as number };
    }
    
    return null;
  }

  getAllPreferences(): Record<string, string> {
    const rows = this.db.all<{ key: string; value: string }>(
      "SELECT key, value FROM declarative_memory WHERE key LIKE 'preference.%'"
    );
    
    const preferences: Record<string, string> = {};
    for (const row of rows) {
      preferences[row.key] = row.value;
    }
    return preferences;
  }

  setPreference(name: string, value: string): void {
    this.remember(`preference.${name}`, value, 0.8);
  }

  getPreference(name: string): string | null {
    const result = this.recall(`preference.${name}`);
    return result?.value || null;
  }

  // ═══════════════════════════════════════════════════════════════
  // 程序性记忆
  // ═══════════════════════════════════════════════════════════════

  recordPattern(patternName: string, pattern: string): void {
    const now = new Date().toISOString();
    const existing = this.db.get(
      'SELECT * FROM procedural_memory WHERE key = ?',
      [patternName]
    );

    if (existing) {
      this.db.run(
        'UPDATE procedural_memory SET value = ?, updated_at = ? WHERE key = ?',
        [pattern, now, patternName]
      );
    } else {
      this.db.run(
        'INSERT INTO procedural_memory (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)',
        [patternName, pattern, now, now]
      );
    }
    
    logger.debug(`记录任务模式: ${patternName}`);
  }

  getPattern(patternName: string): string | null {
    const result = this.db.get<{ value: string }>(
      'SELECT value FROM procedural_memory WHERE key = ?',
      [patternName]
    );
    return result?.value || null;
  }

  // ═══════════════════════════════════════════════════════════════
  // 学习机制
  // ═══════════════════════════════════════════════════════════════

  learnPreference(context: string, preference: string): void {
    this.setPreference(context, preference);
    this.recordEpisode('learning', `学习偏好: ${context} -> ${preference}`);
  }

  learnTaskPattern(taskType: string, steps: string[]): void {
    this.recordPattern(`task.${taskType}`, JSON.stringify(steps));
    this.recordEpisode('learning', `学习任务模式: ${taskType}`);
  }

  learnErrorRecovery(errorType: string, solution: string): void {
    this.recordPattern(`error.${errorType}`, solution);
    this.recordEpisode('learning', `学习错误恢复: ${errorType} -> ${solution}`);
  }

  getErrorRecovery(errorType: string): string | null {
    return this.getPattern(`error.${errorType}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // 信任记录
  // ═══════════════════════════════════════════════════════════════

  recordSuccess(operation: string): void {
    const now = new Date().toISOString();
    const existing = this.db.get<{ success_count: number; failure_count: number }>(
      'SELECT success_count, failure_count FROM trust_records WHERE operation = ?',
      [operation]
    );

    if (existing) {
      const newCount = (existing.success_count as number) + 1;
      const skipConfirm = newCount >= 3 && (existing.failure_count as number) === 0;
      
      this.db.run(
        `UPDATE trust_records 
         SET success_count = ?, last_success_at = ?, skip_confirm = ?
         WHERE operation = ?`,
        [newCount, now, skipConfirm ? 1 : 0, operation]
      );
    } else {
      this.db.run(
        `INSERT INTO trust_records (operation, success_count, last_success_at)
         VALUES (?, 1, ?)`,
        [operation, now]
      );
    }
  }

  recordFailure(operation: string): void {
    const existing = this.db.get<{ failure_count: number }>(
      'SELECT failure_count FROM trust_records WHERE operation = ?',
      [operation]
    );

    if (existing) {
      this.db.run(
        `UPDATE trust_records 
         SET failure_count = failure_count + 1, skip_confirm = 0
         WHERE operation = ?`,
        [operation]
      );
    } else {
      this.db.run(
        `INSERT INTO trust_records (operation, success_count, failure_count)
         VALUES (?, 0, 1)`,
        [operation]
      );
    }
  }

  canSkipConfirm(operation: string): boolean {
    const result = this.db.get<{ skip_confirm: number }>(
      'SELECT skip_confirm FROM trust_records WHERE operation = ?',
      [operation]
    );
    return result?.skip_confirm === 1;
  }

  getTrustRecord(operation: string): TrustRecord | null {
    const result = this.db.get(
      'SELECT * FROM trust_records WHERE operation = ?',
      [operation]
    );
    
    if (result) {
      return {
        operation: result.operation as string,
        successCount: result.success_count as number,
        failureCount: result.failure_count as number,
        lastSuccessAt: result.last_success_at ? new Date(result.last_success_at as string) : undefined,
        skipConfirm: result.skip_confirm === 1,
      };
    }
    
    return null;
  }
}

let memoryInstance: MemorySystem | null = null;

export function getMemory(): MemorySystem {
  if (!memoryInstance) {
    memoryInstance = new MemorySystem();
  }
  return memoryInstance;
}
