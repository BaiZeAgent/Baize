/**
 * 增强记忆系统 V2 - 真正的智能记忆
 * 
 * 核心能力：
 * 1. 语义记忆：概念和事实的长期存储
 * 2. 情景记忆：具体事件和对话历史
 * 3. 程序记忆：技能和流程的学习
 * 4. 工作记忆：当前上下文的动态管理
 * 5. 元记忆：关于记忆的记忆（学习如何学习）
 */

import { getLogger } from '../observability/logger';
import { getLLMManager } from '../llm';
import { getDatabase } from './database';

const logger = getLogger('memory:v2');

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

/** 记忆类型 */
export type MemoryType = 'semantic' | 'episodic' | 'procedural' | 'working' | 'meta';

/** 记忆项 */
export interface MemoryItem {
  /** 唯一ID */
  id: string;
  /** 记忆类型 */
  type: MemoryType;
  /** 内容 */
  content: string;
  /** 向量表示（用于语义搜索） */
  embedding?: number[];
  /** 元数据 */
  metadata: {
    /** 创建时间 */
    createdAt: number;
    /** 最后访问时间 */
    lastAccessedAt: number;
    /** 访问次数 */
    accessCount: number;
    /** 重要性 0-1 */
    importance: number;
    /** 来源 */
    source: string;
    /** 关联的记忆ID */
    relatedIds?: string[];
    /** 标签 */
    tags?: string[];
  };
  /** 过期时间（可选） */
  expiresAt?: number;
}

/** 用户偏好 */
export interface UserPreference {
  /** 偏好键 */
  key: string;
  /** 偏好值 */
  value: unknown;
  /** 置信度 */
  confidence: number;
  /** 来源 */
  source: 'explicit' | 'inferred' | 'learned';
  /** 更新时间 */
  updatedAt: number;
}

/** 上下文状态 */
export interface ContextState {
  /** 当前任务 */
  currentTask?: string;
  /** 当前意图 */
  currentIntent?: string;
  /** 活跃的实体 */
  activeEntities: Map<string, unknown>;
  /** 临时变量 */
  variables: Map<string, unknown>;
  /** 注意力焦点 */
  attentionFocus: string[];
  /** 时间戳 */
  timestamp: number;
}

/** 学习记录 */
export interface LearningRecord {
  /** 场景 */
  scenario: string;
  /** 行动 */
  action: string;
  /** 结果 */
  result: 'success' | 'failure' | 'partial';
  /** 教训 */
  lesson: string;
  /** 时间 */
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// 增强记忆系统
// ═══════════════════════════════════════════════════════════════

export class EnhancedMemory {
  private llm = getLLMManager();
  private db = getDatabase();
  
  /** 工作记忆（当前上下文） */
  private workingMemory: ContextState = {
    activeEntities: new Map(),
    variables: new Map(),
    attentionFocus: [],
    timestamp: Date.now(),
  };
  
  /** 用户偏好 */
  private preferences: Map<string, UserPreference> = new Map();
  
  /** 学习记录 */
  private learningRecords: LearningRecord[] = [];
  
  /** 记忆缓存 */
  private memoryCache: Map<string, MemoryItem> = new Map();
  
  /** 最大工作记忆容量 */
  private readonly MAX_WORKING_MEMORY = 10;
  
  /** 记忆项计数器 */
  private memoryCounter = 0;
  
  constructor() {
    this.initialize();
  }
  
  private initialize(): void {
    // 创建记忆表
    try {
      this.db.run(`
        CREATE TABLE IF NOT EXISTS memories_v2 (
          id TEXT PRIMARY KEY,
          type TEXT NOT NULL,
          content TEXT NOT NULL,
          embedding BLOB,
          metadata TEXT NOT NULL,
          expires_at INTEGER,
          created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
        )
      `);
      
      this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_memories_type ON memories_v2(type)
      `);
      
      this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_memories_created ON memories_v2(created_at)
      `);
      
      // 用户偏好表
      this.db.run(`
        CREATE TABLE IF NOT EXISTS user_preferences (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          confidence REAL DEFAULT 0.5,
          source TEXT DEFAULT 'inferred',
          updated_at INTEGER
        )
      `);
      
      // 学习记录表
      this.db.run(`
        CREATE TABLE IF NOT EXISTS learning_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          scenario TEXT NOT NULL,
          action TEXT NOT NULL,
          result TEXT NOT NULL,
          lesson TEXT,
          timestamp INTEGER
        )
      `);
      
      logger.info('[记忆系统] 初始化完成');
    } catch (error) {
      logger.error(`[记忆系统] 初始化失败: ${error}`);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // 语义记忆
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * 存储语义记忆（概念和事实）
   */
  async rememberFact(
    content: string,
    metadata: Partial<MemoryItem['metadata']> = {}
  ): Promise<string> {
    const id = `sem_${++this.memoryCounter}_${Date.now()}`;
    
    // 尝试生成嵌入向量
    let embedding: number[] | undefined;
    try {
      embedding = await this.llm.embed(content);
    } catch {
      // 嵌入生成失败，继续存储
    }
    
    const item: MemoryItem = {
      id,
      type: 'semantic',
      content,
      embedding,
      metadata: {
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        accessCount: 0,
        importance: metadata.importance ?? 0.5,
        source: metadata.source ?? 'user',
        relatedIds: metadata.relatedIds,
        tags: metadata.tags,
      },
    };
    
    // 存储到数据库
    this.db.run(
      `INSERT INTO memories_v2 (id, type, content, embedding, metadata) VALUES (?, ?, ?, ?, ?)`,
      [id, 'semantic', content, embedding ? JSON.stringify(embedding) : null, JSON.stringify(item.metadata)]
    );
    
    // 缓存
    this.memoryCache.set(id, item);
    
    logger.debug(`[语义记忆] 存储: ${content.slice(0, 50)}...`);
    
    return id;
  }
  
  /**
   * 查询语义记忆
   */
  async queryFacts(query: string, limit: number = 5): Promise<MemoryItem[]> {
    // 尝试语义搜索
    try {
      const queryEmbedding = await this.llm.embed(query);
      return this.semanticSearch(queryEmbedding, 'semantic', limit);
    } catch {
      // 回退到关键词搜索
      return this.keywordSearch(query, 'semantic', limit);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // 情景记忆
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * 记录事件（情景记忆）
   */
  async recordEvent(
    eventType: string,
    content: string,
    metadata: Partial<MemoryItem['metadata']> = {}
  ): Promise<string> {
    const id = `epi_${++this.memoryCounter}_${Date.now()}`;
    
    const item: MemoryItem = {
      id,
      type: 'episodic',
      content: `[${eventType}] ${content}`,
      metadata: {
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        accessCount: 0,
        importance: metadata.importance ?? 0.3,
        source: metadata.source ?? 'system',
        tags: [eventType, ...(metadata.tags || [])],
      },
    };
    
    this.db.run(
      `INSERT INTO memories_v2 (id, type, content, metadata) VALUES (?, ?, ?, ?)`,
      [id, 'episodic', item.content, JSON.stringify(item.metadata)]
    );
    
    this.memoryCache.set(id, item);
    
    // 更新工作记忆
    this.updateWorkingMemory(eventType, content);
    
    return id;
  }
  
  /**
   * 回忆事件
   */
  async recallEvents(
    eventType?: string,
    timeRange?: { start: number; end: number },
    limit: number = 10
  ): Promise<MemoryItem[]> {
    let sql = `SELECT id, type, content, metadata FROM memories_v2 WHERE type = 'episodic'`;
    const params: any[] = [];
    
    if (eventType) {
      sql += ` AND content LIKE ?`;
      params.push(`%[${eventType}]%`);
    }
    
    if (timeRange) {
      sql += ` AND created_at BETWEEN ? AND ?`;
      params.push(timeRange.start, timeRange.end);
    }
    
    sql += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);
    
    const rows = this.db.all(sql, params);
    
    return rows.map((row: any) => ({
      id: row.id,
      type: row.type,
      content: row.content,
      metadata: JSON.parse(row.metadata),
    }));
  }
  
  // ═══════════════════════════════════════════════════════════════
  // 程序记忆
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * 学习技能/流程
   */
  async learnProcedure(
    name: string,
    steps: string[],
    context: string
  ): Promise<string> {
    const id = `proc_${++this.memoryCounter}_${Date.now()}`;
    
    const content = JSON.stringify({
      name,
      steps,
      context,
      successCount: 0,
      failureCount: 0,
    });
    
    const item: MemoryItem = {
      id,
      type: 'procedural',
      content,
      metadata: {
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        accessCount: 0,
        importance: 0.7,
        source: 'learned',
        tags: ['procedure', name],
      },
    };
    
    this.db.run(
      `INSERT INTO memories_v2 (id, type, content, metadata) VALUES (?, ?, ?, ?)`,
      [id, 'procedural', content, JSON.stringify(item.metadata)]
    );
    
    logger.info(`[程序记忆] 学习: ${name}`);
    
    return id;
  }
  
  /**
   * 获取程序
   */
  async getProcedure(name: string): Promise<{ steps: string[]; context: string } | null> {
    const rows = this.db.all(
      `SELECT content FROM memories_v2 WHERE type = 'procedural' AND content LIKE ? LIMIT 1`,
      [`%"name":"${name}"%`]
    );
    
    if (rows.length > 0) {
      try {
        const data = JSON.parse((rows[0] as any).content);
        return {
          steps: data.steps,
          context: data.context,
        };
      } catch {
        return null;
      }
    }
    
    return null;
  }
  
  /**
   * 更新程序执行结果
   */
  async updateProcedureResult(name: string, success: boolean): Promise<void> {
    const rows = this.db.all(
      `SELECT id, content FROM memories_v2 WHERE type = 'procedural' AND content LIKE ? LIMIT 1`,
      [`%"name":"${name}"%`]
    );
    
    if (rows.length > 0) {
      const row = rows[0] as any;
      const data = JSON.parse(row.content);
      
      if (success) {
        data.successCount = (data.successCount || 0) + 1;
      } else {
        data.failureCount = (data.failureCount || 0) + 1;
      }
      
      this.db.run(
        `UPDATE memories_v2 SET content = ? WHERE id = ?`,
        [JSON.stringify(data), row.id]
      );
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // 工作记忆
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * 更新工作记忆
   */
  private updateWorkingMemory(eventType: string, content: string): void {
    // 添加到注意力焦点
    this.workingMemory.attentionFocus.unshift(content.slice(0, 100));
    
    // 限制容量
    if (this.workingMemory.attentionFocus.length > this.MAX_WORKING_MEMORY) {
      this.workingMemory.attentionFocus = this.workingMemory.attentionFocus.slice(0, this.MAX_WORKING_MEMORY);
    }
    
    this.workingMemory.timestamp = Date.now();
  }
  
  /**
   * 设置当前上下文
   */
  setContext(task?: string, intent?: string): void {
    this.workingMemory.currentTask = task;
    this.workingMemory.currentIntent = intent;
    this.workingMemory.timestamp = Date.now();
  }
  
  /**
   * 获取当前上下文
   */
  getContext(): ContextState {
    return { ...this.workingMemory };
  }
  
  /**
   * 设置临时变量
   */
  setVariable(key: string, value: unknown): void {
    this.workingMemory.variables.set(key, value);
  }
  
  /**
   * 获取临时变量
   */
  getVariable(key: string): unknown {
    return this.workingMemory.variables.get(key);
  }
  
  /**
   * 清空工作记忆
   */
  clearWorkingMemory(): void {
    this.workingMemory = {
      activeEntities: new Map(),
      variables: new Map(),
      attentionFocus: [],
      timestamp: Date.now(),
    };
  }
  
  // ═══════════════════════════════════════════════════════════════
  // 用户偏好
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * 设置用户偏好
   */
  setPreference(
    key: string,
    value: unknown,
    source: UserPreference['source'] = 'inferred',
    confidence: number = 0.5
  ): void {
    const pref: UserPreference = {
      key,
      value,
      confidence,
      source,
      updatedAt: Date.now(),
    };
    
    this.preferences.set(key, pref);
    
    this.db.run(
      `INSERT OR REPLACE INTO user_preferences (key, value, confidence, source, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [key, JSON.stringify(value), confidence, source, pref.updatedAt]
    );
    
    logger.debug(`[用户偏好] 设置: ${key} = ${JSON.stringify(value)}`);
  }
  
  /**
   * 获取用户偏好
   */
  getPreference(key: string): unknown | undefined {
    // 先从内存获取
    const pref = this.preferences.get(key);
    if (pref) return pref.value;
    
    // 从数据库获取
    const rows = this.db.all(`SELECT value FROM user_preferences WHERE key = ?`, [key]);
    if (rows.length > 0) {
      return JSON.parse((rows[0] as any).value);
    }
    
    return undefined;
  }
  
  /**
   * 学习用户偏好
   */
  async learnPreference(context: string, action: string): Promise<void> {
    // 使用 LLM 分析用户偏好
    const messages = [
      {
        role: 'system' as const,
        content: `分析用户行为，推断用户偏好。

上下文: ${context}
用户行为: ${action}

输出JSON格式：
{
  "preferences": [
    {"key": "偏好名", "value": "偏好值", "confidence": 0.0-1.0}
  ]
}

只输出确定的偏好，不要猜测。`
      }
    ];
    
    try {
      const response = await this.llm.chat(messages, { temperature: 0.2 });
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        
        for (const pref of result.preferences || []) {
          this.setPreference(pref.key, pref.value, 'learned', pref.confidence);
        }
      }
    } catch (error) {
      logger.error(`[偏好学习] 错误: ${error}`);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // 学习和反思
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * 记录学习
   */
  recordLearning(
    scenario: string,
    action: string,
    result: 'success' | 'failure' | 'partial',
    lesson?: string
  ): void {
    const record: LearningRecord = {
      scenario,
      action,
      result,
      lesson: lesson || '',
      timestamp: Date.now(),
    };
    
    this.learningRecords.push(record);
    
    // 限制记录数量
    if (this.learningRecords.length > 100) {
      this.learningRecords = this.learningRecords.slice(-100);
    }
    
    // 存储到数据库
    this.db.run(
      `INSERT INTO learning_records (scenario, action, result, lesson, timestamp) VALUES (?, ?, ?, ?, ?)`,
      [scenario, action, result, lesson || '', record.timestamp]
    );
    
    logger.info(`[学习记录] ${scenario}: ${result}`);
  }
  
  /**
   * 获取相关学习
   */
  getRelevantLearning(scenario: string): LearningRecord[] {
    return this.learningRecords.filter(r => 
      r.scenario.toLowerCase().includes(scenario.toLowerCase())
    );
  }
  
  /**
   * 反思和总结
   */
  async reflect(): Promise<string> {
    const recentEvents = await this.recallEvents(undefined, undefined, 10);
    const recentLearning = this.learningRecords.slice(-5);
    
    const messages = [
      {
        role: 'system' as const,
        content: `你是一个自我反思系统。根据最近的记忆和学习，生成反思总结。

## 最近事件
${recentEvents.map(e => `- ${e.content}`).join('\n')}

## 最近学习
${recentLearning.map(l => `- ${l.scenario}: ${l.result} - ${l.lesson}`).join('\n')}

## 用户偏好
${Array.from(this.preferences.entries()).map(([k, v]) => `- ${k}: ${JSON.stringify(v.value)}`).join('\n')}

输出：
1. 总结最近的模式
2. 发现的问题
3. 改进建议`
      }
    ];
    
    try {
      const response = await this.llm.chat(messages, { temperature: 0.5 });
      return response.content;
    } catch {
      return '反思失败';
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // 搜索方法
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * 语义搜索
   */
  private semanticSearch(
    queryEmbedding: number[],
    type: MemoryType,
    limit: number
  ): MemoryItem[] {
    // 简化实现：从缓存中搜索
    // 完整实现需要向量数据库
    const items = Array.from(this.memoryCache.values())
      .filter(item => item.type === type && item.embedding);
    
    // 计算相似度
    const scored = items.map(item => ({
      item,
      score: this.cosineSimilarity(queryEmbedding, item.embedding!),
    }));
    
    // 排序并返回
    scored.sort((a, b) => b.score - a.score);
    
    return scored.slice(0, limit).map(s => s.item);
  }
  
  /**
   * 关键词搜索
   */
  private keywordSearch(query: string, type: MemoryType, limit: number): MemoryItem[] {
    const rows = this.db.all(
      `SELECT id, type, content, metadata FROM memories_v2 WHERE type = ? AND content LIKE ? ORDER BY created_at DESC LIMIT ?`,
      [type, `%${query}%`, limit]
    );
    
    return rows.map((row: any) => ({
      id: row.id,
      type: row.type,
      content: row.content,
      metadata: JSON.parse(row.metadata),
    }));
  }
  
  /**
   * 计算余弦相似度
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    
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
  
  // ═══════════════════════════════════════════════════════════════
  // 统计和维护
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * 获取记忆统计
   */
  getStats(): {
    totalMemories: number;
    byType: Record<MemoryType, number>;
    preferences: number;
    learningRecords: number;
  } {
    const rows = this.db.all(`SELECT type, COUNT(*) as count FROM memories_v2 GROUP BY type`);
    
    const byType: Record<string, number> = {
      semantic: 0,
      episodic: 0,
      procedural: 0,
      working: 0,
      meta: 0,
    };
    
    for (const row of rows as any[]) {
      byType[row.type] = row.count;
    }
    
    const total = Object.values(byType).reduce((a, b) => a + b, 0);
    
    return {
      totalMemories: total,
      byType: byType as Record<MemoryType, number>,
      preferences: this.preferences.size,
      learningRecords: this.learningRecords.length,
    };
  }
  
  /**
   * 清理过期记忆
   */
  cleanup(): number {
    const now = Date.now();
    
    // 先获取要删除的记录数
    const countResult = this.db.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM memories_v2 WHERE expires_at IS NOT NULL AND expires_at < ?`,
      [now]
    );
    
    const count = countResult?.count || 0;
    
    if (count > 0) {
      this.db.run(
        `DELETE FROM memories_v2 WHERE expires_at IS NOT NULL AND expires_at < ?`,
        [now]
      );
    }
    
    logger.info(`[记忆清理] 删除 ${count} 条过期记忆`);
    
    return count;
  }
  
  /**
   * 遗忘（降低不重要记忆的优先级）
   */
  async forget(): Promise<void> {
    // 实现遗忘机制：降低不常访问的记忆的重要性
    this.db.run(
      `UPDATE memories_v2 SET metadata = json_set(metadata, '$.importance', json_extract(metadata, '$.importance') * 0.9) WHERE json_extract(metadata, '$.accessCount') < 2`
    );
    
    // 删除重要性过低的记忆
    this.db.run(
      `DELETE FROM memories_v2 WHERE json_extract(metadata, '$.importance') < 0.1`
    );
  }
}

// ═══════════════════════════════════════════════════════════════
// 全局实例
// ═══════════════════════════════════════════════════════════════

let enhancedMemoryInstance: EnhancedMemory | null = null;

export function getEnhancedMemory(): EnhancedMemory {
  if (!enhancedMemoryInstance) {
    enhancedMemoryInstance = new EnhancedMemory();
  }
  return enhancedMemoryInstance;
}

export function resetEnhancedMemory(): void {
  enhancedMemoryInstance = null;
}
