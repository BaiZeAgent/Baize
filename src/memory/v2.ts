/**
 * 记忆系统 V2 - 向量搜索增强
 * 
 * 新增功能：
 * 1. 向量嵌入存储
 * 2. 语义相似度搜索
 * 3. 混合检索
 */

import { BaizeDatabase, getDatabase } from './database';
import { EpisodicMemory, DeclarativeMemory, ProceduralMemory, TrustRecord } from '../types';
import { getLogger } from '../observability/logger';
import { getEmbeddingManager, EmbeddingVector } from '../embeddings';
import { getVectorStore, VectorDocument, SearchResult } from '../vector';
import { getSearchEngine, HybridSearchResult } from '../search';

const logger = getLogger('memory');

// ═══════════════════════════════════════════════════════════════
// 学习维度
// ═══════════════════════════════════════════════════════════════

export enum LearningDimension {
  USER_PREFERENCE = 'user_preference',
  TASK_PATTERN = 'task_pattern',
  ERROR_RECOVERY = 'error_recovery',
  SKILL_EVOLUTION = 'skill_evolution',
  KNOWLEDGE_ACCUMULATION = 'knowledge',
}

// ═══════════════════════════════════════════════════════════════
// 记忆搜索选项
// ═══════════════════════════════════════════════════════════════

export interface MemorySearchOptions {
  topK?: number;
  minScore?: number;
  types?: string[];
  useVector?: boolean;
  useFTS?: boolean;
}

// ═══════════════════════════════════════════════════════════════
// 记忆系统 V2
// ═══════════════════════════════════════════════════════════════

export class MemorySystemV2 {
  private db: BaizeDatabase;
  private embeddingManager = getEmbeddingManager();
  private vectorStore = getVectorStore();
  private searchEngine = getSearchEngine();
  
  constructor() {
    this.db = getDatabase();
  }
  
  // ═══════════════════════════════════════════════════════════════
  // 情景记忆 (增强版)
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * 记录情景记忆 (带向量嵌入)
   */
  async recordEpisode(type: string, content: string, metadata?: Record<string, unknown>): Promise<number> {
    const timestamp = new Date().toISOString();
    
    this.db.run(
      'INSERT INTO episodic_memory (type, timestamp, content) VALUES (?, ?, ?)',
      [type, timestamp, content]
    );
    
    const result = this.db.get<{ id: number }>('SELECT last_insert_rowid() as id');
    const id = result?.id || 0;
    
    // 创建向量嵌入
    try {
      const embedding = await this.embeddingManager.embed(content);
      await this.vectorStore.add({
        id: `episode-${id}`,
        content,
        vector: embedding.vector,
        metadata: { type, ...metadata },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    } catch (error) {
      logger.warn(`创建嵌入失败: ${error}`);
    }
    
    logger.debug(`记录情景记忆: ${type} (id: ${id})`);
    return id;
  }
  
  /**
   * 获取情景记忆
   */
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
  
  /**
   * 搜索情景记忆 (语义搜索)
   */
  async searchEpisodes(query: string, options: MemorySearchOptions = {}): Promise<HybridSearchResult[]> {
    const { topK = 10, minScore = 0.3, types, useVector = true, useFTS = true } = options;
    
    const results = await this.searchEngine.search(query, {
      topK,
      minScore,
      strategy: useVector && useFTS ? 'hybrid' : useVector ? 'vector' : 'fts',
    });
    
    // 过滤类型
    if (types && types.length > 0) {
      return results.filter(r => types.includes(r.metadata?.type as string));
    }
    
    return results;
  }
  
  getRecentConversation(turns: number = 10): EpisodicMemory[] {
    return this.getEpisodes('conversation', turns);
  }
  
  // ═══════════════════════════════════════════════════════════════
  // 声明式记忆 (增强版)
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * 记住 (带向量嵌入)
   */
  async remember(key: string, value: string, confidence: number = 0.5): Promise<void> {
    const existing = this.db.get<DeclarativeMemory>(
      'SELECT * FROM declarative_memory WHERE key = ?',
      [key]
    );
    
    const now = new Date().toISOString();
    
    if (existing) {
      this.db.run(
        `UPDATE declarative_memory 
         SET value = ?, confidence = ?, times_reinforced = times_reinforced + 1, updated_at = ?
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
    
    // 创建向量嵌入
    try {
      const embedding = await this.embeddingManager.embed(`${key}: ${value}`);
      await this.vectorStore.add({
        id: `declarative-${key}`,
        content: `${key}: ${value}`,
        vector: embedding.vector,
        metadata: { type: 'declarative', key, confidence },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    } catch (error) {
      logger.warn(`创建嵌入失败: ${error}`);
    }
  }
  
  /**
   * 回忆
   */
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
  
  /**
   * 语义搜索记忆
   */
  async searchMemory(query: string, topK: number = 10): Promise<HybridSearchResult[]> {
    return this.searchEngine.search(query, { topK, minScore: 0.3 });
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
  
  async setPreference(name: string, value: string): Promise<void> {
    await this.remember(`preference.${name}`, value, 0.8);
  }
  
  getPreference(name: string): string | null {
    const result = this.recall(`preference.${name}`);
    return result?.value || null;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // 程序性记忆
  // ═══════════════════════════════════════════════════════════════
  
  async recordPattern(patternName: string, pattern: string): Promise<void> {
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
    
    // 创建向量嵌入
    try {
      const embedding = await this.embeddingManager.embed(pattern);
      await this.vectorStore.add({
        id: `procedural-${patternName}`,
        content: pattern,
        vector: embedding.vector,
        metadata: { type: 'procedural', key: patternName },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    } catch (error) {
      logger.warn(`创建嵌入失败: ${error}`);
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
  
  async learnPreference(context: string, preference: string): Promise<void> {
    await this.setPreference(context, preference);
    await this.recordEpisode('learning', `学习偏好: ${context} -> ${preference}`);
  }
  
  async learnTaskPattern(taskType: string, steps: string[]): Promise<void> {
    await this.recordPattern(`task.${taskType}`, JSON.stringify(steps));
    await this.recordEpisode('learning', `学习任务模式: ${taskType}`);
  }
  
  async learnErrorRecovery(errorType: string, solution: string): Promise<void> {
    await this.recordPattern(`error.${errorType}`, solution);
    await this.recordEpisode('learning', `学习错误恢复: ${errorType} -> ${solution}`);
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
        `UPDATE trust_records SET success_count = ?, last_success_at = ?, skip_confirm = ? WHERE operation = ?`,
        [newCount, now, skipConfirm ? 1 : 0, operation]
      );
    } else {
      this.db.run(
        `INSERT INTO trust_records (operation, success_count, last_success_at) VALUES (?, 1, ?)`,
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
        `UPDATE trust_records SET failure_count = failure_count + 1, skip_confirm = 0 WHERE operation = ?`,
        [operation]
      );
    } else {
      this.db.run(
        `INSERT INTO trust_records (operation, success_count, failure_count) VALUES (?, 0, 1)`,
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

// ═══════════════════════════════════════════════════════════════
// 全局实例
// ═══════════════════════════════════════════════════════════════

let memoryInstance: MemorySystemV2 | null = null;

export function getMemory(): MemorySystemV2 {
  if (!memoryInstance) {
    memoryInstance = new MemorySystemV2();
  }
  return memoryInstance;
}

export function resetMemory(): void {
  memoryInstance = null;
}

// 导出旧版兼容
export { MemorySystem } from './index';
