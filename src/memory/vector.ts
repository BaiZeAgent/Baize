/**
 * 向量搜索模块 - 语义检索支持
 *
 * 核心功能：
 * 1. 文本嵌入（调用LLM或本地模型）
 * 2. 向量存储
 * 3. 相似度搜索
 * 4. 记忆语义检索
 *
 * 设计说明：
 * - 使用轻量级本地向量库（hnswlib-node风格实现）
 * - 支持持久化存储
 * - 与记忆系统集成
 */

import { getLogger } from '../observability/logger';
import { getLLMManager } from '../llm';
import * as fs from 'fs';
import * as path from 'path';

const logger = getLogger('memory:vector');

/**
 * 向量维度（OpenAI embedding维度）
 */
const VECTOR_DIMENSION = 1536;

/**
 * 向量记录
 */
export interface VectorRecord {
  /** 记录ID */
  id: string;
  /** 向量 */
  vector: number[];
  /** 原始文本 */
  text: string;
  /** 元数据 */
  metadata: Record<string, unknown>;
  /** 创建时间 */
  createdAt: Date;
}

/**
 * 搜索结果
 */
export interface SearchResult {
  /** 记录ID */
  id: string;
  /** 相似度分数（0-1） */
  score: number;
  /** 原始文本 */
  text: string;
  /** 元数据 */
  metadata: Record<string, unknown>;
}

/**
 * 向量搜索配置
 */
export interface VectorSearchConfig {
  /** 存储路径 */
  storagePath: string;
  /** 向量维度 */
  dimension: number;
  /** 是否持久化 */
  persist: boolean;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: VectorSearchConfig = {
  storagePath: './data/vectors',
  dimension: VECTOR_DIMENSION,
  persist: true,
};

/**
 * 向量搜索管理器
 */
export class VectorSearchManager {
  private config: VectorSearchConfig;
  private records: Map<string, VectorRecord> = new Map();
  private llm = getLLMManager();
  private initialized: boolean = false;

  constructor(config: Partial<VectorSearchConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 初始化
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // 确保存储目录存在
    if (this.config.persist && !fs.existsSync(this.config.storagePath)) {
      fs.mkdirSync(this.config.storagePath, { recursive: true });
    }

    // 加载已有数据
    if (this.config.persist) {
      await this.load();
    }

    this.initialized = true;
    logger.info(`[vector-init] records=${this.records.size}`);
  }

  /**
   * 嵌入文本
   * 
   * 使用LLM生成文本嵌入向量
   * 如果LLM不支持嵌入，使用简单的哈希向量作为后备
   */
  async embed(text: string): Promise<number[]> {
    try {
      // 尝试使用LLM嵌入
      // 注意：大多数LLM API支持embedding接口
      const embedding = await this.llm.embed(text);
      if (embedding && embedding.length > 0) {
        return embedding;
      }
    } catch (error) {
      logger.debug(`[vector-embed] LLM嵌入失败，使用后备方案: ${error}`);
    }

    // 后备方案：使用简单的哈希向量
    return this.hashEmbed(text);
  }

  /**
   * 哈希嵌入（后备方案）
   * 
   * 使用文本哈希生成伪向量
   * 注意：这不是真正的语义嵌入，仅用于测试和后备
   */
  private hashEmbed(text: string): number[] {
    const vector: number[] = new Array(this.config.dimension).fill(0);
    
    // 简单的字符哈希
    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i);
      const index = charCode % this.config.dimension;
      vector[index] += 1 / (i + 1);
    }

    // 归一化
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= norm;
      }
    }

    return vector;
  }

  /**
   * 添加向量
   */
  async add(
    id: string,
    text: string,
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    await this.init();

    const vector = await this.embed(text);

    const record: VectorRecord = {
      id,
      vector,
      text,
      metadata,
      createdAt: new Date(),
    };

    this.records.set(id, record);

    logger.debug(`[vector-add] id=${id}`);

    // 持久化
    if (this.config.persist) {
      await this.save();
    }
  }

  /**
   * 批量添加
   */
  async addBatch(
    items: Array<{ id: string; text: string; metadata?: Record<string, unknown> }>
  ): Promise<void> {
    await this.init();

    for (const item of items) {
      await this.add(item.id, item.text, item.metadata || {});
    }

    logger.info(`[vector-add-batch] count=${items.length}`);
  }

  /**
   * 删除向量
   */
  async delete(id: string): Promise<boolean> {
    const existed = this.records.delete(id);

    if (existed && this.config.persist) {
      await this.save();
    }

    logger.debug(`[vector-delete] id=${id} existed=${existed}`);
    return existed;
  }

  /**
   * 搜索相似向量
   */
  async search(
    query: string,
    options?: {
      /** 返回数量 */
      limit?: number;
      /** 最小相似度 */
      minScore?: number;
      /** 元数据过滤 */
      filter?: Record<string, unknown>;
    }
  ): Promise<SearchResult[]> {
    await this.init();

    const { limit = 10, minScore = 0, filter } = options || {};

    const queryVector = await this.embed(query);
    const results: SearchResult[] = [];

    for (const record of this.records.values()) {
      // 元数据过滤
      if (filter && !this.matchFilter(record.metadata, filter)) {
        continue;
      }

      // 计算相似度（余弦相似度）
      const score = this.cosineSimilarity(queryVector, record.vector);

      if (score >= minScore) {
        results.push({
          id: record.id,
          score,
          text: record.text,
          metadata: record.metadata,
        });
      }
    }

    // 按相似度排序
    results.sort((a, b) => b.score - a.score);

    // 限制返回数量
    const limited = results.slice(0, limit);

    logger.debug(`[vector-search] query="${query.slice(0, 30)}..." results=${limited.length}`);

    return limited;
  }

  /**
   * 获取向量记录
   */
  get(id: string): VectorRecord | undefined {
    return this.records.get(id);
  }

  /**
   * 获取所有ID
   */
  getAllIds(): string[] {
    return Array.from(this.records.keys());
  }

  /**
   * 获取记录数量
   */
  size(): number {
    return this.records.size;
  }

  /**
   * 清空所有记录
   */
  async clear(): Promise<void> {
    this.records.clear();

    if (this.config.persist) {
      await this.save();
    }

    logger.info('[vector-clear] 已清空所有记录');
  }

  /**
   * 计算余弦相似度
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * 匹配过滤器
   */
  private matchFilter(metadata: Record<string, unknown>, filter: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(filter)) {
      if (metadata[key] !== value) {
        return false;
      }
    }
    return true;
  }

  /**
   * 保存到文件
   */
  private async save(): Promise<void> {
    const filePath = path.join(this.config.storagePath, 'vectors.json');

    const data = Array.from(this.records.values()).map(r => ({
      id: r.id,
      vector: r.vector,
      text: r.text,
      metadata: r.metadata,
      createdAt: r.createdAt.toISOString(),
    }));

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

    logger.debug(`[vector-save] saved=${data.length}`);
  }

  /**
   * 从文件加载
   */
  private async load(): Promise<void> {
    const filePath = path.join(this.config.storagePath, 'vectors.json');

    if (!fs.existsSync(filePath)) {
      return;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content);

      for (const item of data) {
        const record: VectorRecord = {
          id: item.id,
          vector: item.vector,
          text: item.text,
          metadata: item.metadata || {},
          createdAt: new Date(item.createdAt),
        };
        this.records.set(record.id, record);
      }

      logger.debug(`[vector-load] loaded=${data.length}`);

    } catch (error) {
      logger.error(`[vector-load-error] ${error}`);
    }
  }
}

// 全局实例
let vectorSearchInstance: VectorSearchManager | null = null;

/**
 * 获取向量搜索管理器实例
 */
export function getVectorSearch(): VectorSearchManager {
  if (!vectorSearchInstance) {
    vectorSearchInstance = new VectorSearchManager();
  }
  return vectorSearchInstance;
}

/**
 * 重置向量搜索管理器实例（测试用）
 */
export function resetVectorSearch(): void {
  vectorSearchInstance = null;
}
