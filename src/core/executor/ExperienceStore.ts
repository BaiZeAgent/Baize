/**
 * 经验存储器 - L2 经验驱动层
 * 
 * 负责：
 * 1. 存储执行经验
 * 2. 语义相似度匹配
 * 3. 失败模式提取
 */

import { getLogger } from '../../observability/logger';
import { getDatabase } from '../../memory/database';
import { getLLMManager } from '../../llm';
import {
  ExecutionExperience,
  ExperienceQueryOptions,
  ExperienceMatch,
  FailurePattern,
} from './types';

const logger = getLogger('executor:experience');

// ═══════════════════════════════════════════════════════════════
// 经验存储器
// ═══════════════════════════════════════════════════════════════

export class ExperienceStore {
  private db = getDatabase();
  private llm = getLLMManager();
  private experienceCounter = 0;
  
  constructor() {
    this.initialize();
  }
  
  private initialize(): void {
    try {
      // 创建经验表
      this.db.run(`
        CREATE TABLE IF NOT EXISTS execution_experiences (
          id TEXT PRIMARY KEY,
          user_input TEXT NOT NULL,
          intent TEXT,
          embedding BLOB,
          tool TEXT NOT NULL,
          params TEXT NOT NULL,
          result TEXT NOT NULL,
          output TEXT,
          error TEXT,
          success_criteria TEXT,
          validation_results TEXT,
          diagnosis TEXT,
          duration INTEGER,
          timestamp INTEGER,
          session_id TEXT,
          verified INTEGER DEFAULT 0,
          confidence REAL DEFAULT 0.5
        )
      `);
      
      // 创建索引
      this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_experiences_tool ON execution_experiences(tool)
      `);
      
      this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_experiences_result ON execution_experiences(result)
      `);
      
      this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_experiences_timestamp ON execution_experiences(timestamp)
      `);
      
      // 创建失败模式表
      this.db.run(`
        CREATE TABLE IF NOT EXISTS failure_patterns (
          id TEXT PRIMARY KEY,
          pattern TEXT NOT NULL,
          cause_type TEXT NOT NULL,
          occurrences INTEGER DEFAULT 1,
          last_occurrence INTEGER,
          suggested_avoidance TEXT
        )
      `);
      
      logger.info('[经验存储器] 初始化完成');
    } catch (error) {
      logger.error(`[经验存储器] 初始化失败: ${error}`);
    }
  }
  
  /**
   * 保存执行经验
   */
  async save(experience: ExecutionExperience): Promise<string> {
    try {
      // ═══════════════════════════════════════════════════════════════
      // 优化：跳过嵌入生成（因为不支持），直接存储
      // ═══════════════════════════════════════════════════════════════
      
      this.db.run(`
        INSERT OR REPLACE INTO execution_experiences (
          id, user_input, intent, embedding, tool, params, result,
          output, error, success_criteria, validation_results, diagnosis,
          duration, timestamp, session_id, verified, confidence
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        experience.id,
        experience.userInput,
        experience.intent || '',
        null, // 跳过嵌入
        experience.tool,
        JSON.stringify(experience.params),
        experience.result,
        experience.output || '',
        experience.error || '',
        experience.successCriteria ? JSON.stringify(experience.successCriteria) : null,
        experience.validationResults ? JSON.stringify(experience.validationResults) : null,
        experience.diagnosis ? JSON.stringify(experience.diagnosis) : null,
        experience.duration,
        experience.timestamp,
        experience.sessionId,
        experience.verified ? 1 : 0,
        experience.confidence,
      ]);
      
      logger.info(`[经验存储器] 保存经验: ${experience.id}, 工具: ${experience.tool}, 结果: ${experience.result}`);
      
      return experience.id;
    } catch (error) {
      logger.error(`[经验存储器] 保存失败: ${error}`);
      throw error;
    }
  }
  
  /**
   * 查找相似经验
   */
  async findSimilar(
    userInput: string,
    options: ExperienceQueryOptions = {}
  ): Promise<ExperienceMatch[]> {
    const {
      limit = 5,
      minSimilarity = 0.6,
      resultFilter,
      toolFilter,
    } = options;
    
    try {
      // ═══════════════════════════════════════════════════════════════
      // 优化：直接使用关键词搜索，跳过嵌入生成（因为不支持）
      // ═══════════════════════════════════════════════════════════════
      
      // 构建查询
      let sql = `SELECT * FROM execution_experiences WHERE 1=1`;
      const params: any[] = [];
      
      if (resultFilter) {
        sql += ` AND result = ?`;
        params.push(resultFilter);
      }
      
      if (toolFilter) {
        sql += ` AND tool = ?`;
        params.push(toolFilter);
      }
      
      sql += ` ORDER BY timestamp DESC LIMIT ?`;
      params.push(limit * 3); // 获取更多候选
      
      const rows = this.db.all(sql, params);
      
      if (!rows || rows.length === 0) {
        return [];
      }
      
      // 计算相似度
      const matches: ExperienceMatch[] = [];
      
      for (const row of rows) {
        const experience = this.rowToExperience(row);
        // 直接使用关键词相似度（跳过嵌入）
        const similarity = this.keywordSimilarity(userInput, experience.userInput);
        
        if (similarity >= minSimilarity) {
          matches.push({
            experience,
            similarity,
            relevanceReason: this.generateRelevanceReason(experience, similarity),
          });
        }
      }
      
      // 按相似度排序
      matches.sort((a, b) => b.similarity - a.similarity);
      
      return matches.slice(0, limit);
    } catch (error) {
      logger.error(`[经验存储器] 查询失败: ${error}`);
      return [];
    }
  }
  
  /**
   * 查找成功经验
   */
  async findSuccessfulExperiences(
    userInput: string,
    limit: number = 3
  ): Promise<ExperienceMatch[]> {
    return this.findSimilar(userInput, {
      limit,
      resultFilter: 'success',
      minSimilarity: 0.7,
    });
  }
  
  /**
   * 查找失败经验
   */
  async findFailedExperiences(
    userInput: string,
    limit: number = 3
  ): Promise<ExperienceMatch[]> {
    return this.findSimilar(userInput, {
      limit,
      resultFilter: 'failure',
      minSimilarity: 0.6,
    });
  }
  
  /**
   * 获取工具的成功率
   */
  getToolSuccessRate(toolName: string): { success: number; total: number; rate: number } {
    try {
      const totalResult = this.db.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM execution_experiences WHERE tool = ?`,
        [toolName]
      );
      
      const successResult = this.db.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM execution_experiences WHERE tool = ? AND result = 'success'`,
        [toolName]
      );
      
      const total = totalResult?.count || 0;
      const success = successResult?.count || 0;
      const rate = total > 0 ? success / total : 0.5;
      
      return { success, total, rate };
    } catch (error) {
      return { success: 0, total: 0, rate: 0.5 };
    }
  }
  
  /**
   * 提取失败模式
   */
  async extractFailurePatterns(): Promise<FailurePattern[]> {
    try {
      const rows = this.db.all(`
        SELECT diagnosis, COUNT(*) as count
        FROM execution_experiences
        WHERE result = 'failure' AND diagnosis IS NOT NULL
        GROUP BY diagnosis
        ORDER BY count DESC
        LIMIT 20
      `);
      
      const patterns: FailurePattern[] = [];
      
      for (const row of rows) {
        try {
          const diagnosis = JSON.parse(row.diagnosis as string);
          patterns.push({
            id: `pattern_${patterns.length}`,
            pattern: diagnosis.rootCause || '未知原因',
            causeType: diagnosis.causeType || 'unknown',
            occurrences: row.count as number,
            lastOccurrence: Date.now(),
            suggestedAvoidance: diagnosis.suggestedFix || '',
          });
        } catch (e) {
          // 忽略解析错误
        }
      }
      
      return patterns;
    } catch (error) {
      logger.error(`[经验存储器] 提取失败模式失败: ${error}`);
      return [];
    }
  }
  
  /**
   * 获取最近的经验
   */
  getRecentExperiences(limit: number = 10): ExecutionExperience[] {
    try {
      const rows = this.db.all(`
        SELECT * FROM execution_experiences
        ORDER BY timestamp DESC
        LIMIT ?
      `, [limit]);
      
      return rows.map(row => this.rowToExperience(row));
    } catch (error) {
      return [];
    }
  }
  
  /**
   * 获取统计信息
   */
  getStats(): {
    totalExperiences: number;
    successCount: number;
    failureCount: number;
    successRate: number;
    toolStats: Record<string, { total: number; success: number; rate: number }>;
  } {
    try {
      const totalResult = this.db.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM execution_experiences`
      );
      
      const successResult = this.db.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM execution_experiences WHERE result = 'success'`
      );
      
      const failureResult = this.db.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM execution_experiences WHERE result = 'failure'`
      );
      
      const toolRows = this.db.all(`
        SELECT tool, 
               COUNT(*) as total,
               SUM(CASE WHEN result = 'success' THEN 1 ELSE 0 END) as success
        FROM execution_experiences
        GROUP BY tool
      `);
      
      const toolStats: Record<string, { total: number; success: number; rate: number }> = {};
      
      for (const row of toolRows as any[]) {
        toolStats[row.tool] = {
          total: row.total,
          success: row.success,
          rate: row.total > 0 ? row.success / row.total : 0,
        };
      }
      
      const total = totalResult?.count || 0;
      const success = successResult?.count || 0;
      const failure = failureResult?.count || 0;
      
      return {
        totalExperiences: total,
        successCount: success,
        failureCount: failure,
        successRate: total > 0 ? success / total : 0,
        toolStats,
      };
    } catch (error) {
      return {
        totalExperiences: 0,
        successCount: 0,
        failureCount: 0,
        successRate: 0,
        toolStats: {},
      };
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // 私有方法
  // ═══════════════════════════════════════════════════════════════
  
  private rowToExperience(row: any): ExecutionExperience {
    return {
      id: row.id,
      userInput: row.user_input,
      intent: row.intent || '',
      embedding: row.embedding ? JSON.parse(row.embedding as string) : undefined,
      tool: row.tool,
      params: JSON.parse(row.params as string),
      result: row.result,
      output: row.output || undefined,
      error: row.error || undefined,
      successCriteria: row.success_criteria ? JSON.parse(row.success_criteria as string) : undefined,
      validationResults: row.validation_results ? JSON.parse(row.validation_results as string) : undefined,
      diagnosis: row.diagnosis ? JSON.parse(row.diagnosis as string) : undefined,
      duration: row.duration,
      timestamp: row.timestamp,
      sessionId: row.session_id,
      verified: row.verified === 1,
      confidence: row.confidence,
    };
  }
  
  private cosineSimilarity(a: number[], b: number[]): number {
    if (!a || !b || a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    if (normA === 0 || normB === 0) return 0;
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
  
  private keywordSimilarity(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
    const union = new Set([...wordsA, ...wordsB]);
    
    return union.size > 0 ? intersection.size / union.size : 0;
  }
  
  private generateRelevanceReason(experience: ExecutionExperience, similarity: number): string {
    if (similarity > 0.9) {
      return '非常相似的任务';
    } else if (similarity > 0.7) {
      return '相似的任务';
    } else {
      return '可能相关的任务';
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 全局实例
// ═══════════════════════════════════════════════════════════════

let experienceStoreInstance: ExperienceStore | null = null;

export function getExperienceStore(): ExperienceStore {
  if (!experienceStoreInstance) {
    experienceStoreInstance = new ExperienceStore();
  }
  return experienceStoreInstance;
}

export function resetExperienceStore(): void {
  experienceStoreInstance = null;
}
