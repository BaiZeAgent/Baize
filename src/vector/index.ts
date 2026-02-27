/**
 * 向量存储系统 - SQLite-vec 集成
 * 
 * 提供高效的向量存储和检索：
 * 1. 向量索引
 * 2. 相似度搜索
 * 3. 持久化存储
 */

import { getLogger } from '../observability/logger';
import { EmbeddingVector } from '../embeddings';
import * as fs from 'fs';
import * as path from 'path';

const logger = getLogger('vector');

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

/**
 * 向量文档
 */
export interface VectorDocument {
  id: string;
  content: string;
  vector?: EmbeddingVector;
  metadata: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/**
 * 搜索结果
 */
export interface SearchResult {
  id: string;
  content: string;
  score: number;
  metadata: Record<string, unknown>;
}

/**
 * 搜索选项
 */
export interface SearchOptions {
  topK?: number;
  minScore?: number;
  filter?: Record<string, unknown>;
}

/**
 * 向量存储配置
 */
export interface VectorStoreConfig {
  dbPath: string;
  dimensions: number;
  tableName?: string;
}

// ═══════════════════════════════════════════════════════════════
// 内存向量存储
// ═══════════════════════════════════════════════════════════════

/**
 * 内存向量存储
 * 
 * 简单的内存实现，用于开发和测试
 */
export class MemoryVectorStore {
  private documents: Map<string, VectorDocument> = new Map();
  private dimensions: number;
  
  constructor(dimensions: number = 384) {
    this.dimensions = dimensions;
  }
  
  /**
   * 添加文档
   */
  async add(doc: VectorDocument): Promise<void> {
    if (doc.vector && doc.vector.length !== this.dimensions) {
      throw new Error(`Vector dimensions mismatch: expected ${this.dimensions}, got ${doc.vector.length}`);
    }
    
    this.documents.set(doc.id, {
      ...doc,
      createdAt: doc.createdAt || Date.now(),
      updatedAt: Date.now(),
    });
    
    logger.debug(`添加文档: ${doc.id}`);
  }
  
  /**
   * 批量添加文档
   */
  async addBatch(docs: VectorDocument[]): Promise<void> {
    for (const doc of docs) {
      await this.add(doc);
    }
    logger.info(`批量添加 ${docs.length} 个文档`);
  }
  
  /**
   * 获取文档
   */
  async get(id: string): Promise<VectorDocument | null> {
    return this.documents.get(id) || null;
  }
  
  /**
   * 删除文档
   */
  async delete(id: string): Promise<boolean> {
    const result = this.documents.delete(id);
    if (result) {
      logger.debug(`删除文档: ${id}`);
    }
    return result;
  }
  
  /**
   * 搜索相似文档
   */
  async search(query: EmbeddingVector, options: SearchOptions = {}): Promise<SearchResult[]> {
    const { topK = 10, minScore = 0 } = options;
    
    const results: SearchResult[] = [];
    
    for (const [id, doc] of this.documents) {
      if (!doc.vector) continue;
      
      // 应用过滤器
      if (options.filter) {
        const match = Object.entries(options.filter).every(
          ([key, value]) => doc.metadata[key] === value
        );
        if (!match) continue;
      }
      
      const score = this.cosineSimilarity(query, doc.vector);
      
      if (score >= minScore) {
        results.push({
          id,
          content: doc.content,
          score,
          metadata: doc.metadata,
        });
      }
    }
    
    // 按分数排序
    results.sort((a, b) => b.score - a.score);
    
    return results.slice(0, topK);
  }
  
  /**
   * 获取所有文档
   */
  async getAll(): Promise<VectorDocument[]> {
    return Array.from(this.documents.values());
  }
  
  /**
   * 获取文档数量
   */
  async count(): Promise<number> {
    return this.documents.size;
  }
  
  /**
   * 清空存储
   */
  async clear(): Promise<void> {
    this.documents.clear();
    logger.info('清空向量存储');
  }
  
  /**
   * 计算余弦相似度
   */
  private cosineSimilarity(a: EmbeddingVector, b: EmbeddingVector): number {
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
}

// ═══════════════════════════════════════════════════════════════
// 持久化向量存储
// ═══════════════════════════════════════════════════════════════

/**
 * 持久化向量存储
 * 
 * 使用 JSON 文件存储
 */
export class PersistentVectorStore {
  private memoryStore: MemoryVectorStore;
  private dbPath: string;
  private dimensions: number;
  private dirty: boolean = false;
  private saveInterval?: NodeJS.Timeout;
  
  constructor(config: VectorStoreConfig) {
    this.dbPath = config.dbPath;
    this.dimensions = config.dimensions;
    this.memoryStore = new MemoryVectorStore(this.dimensions);
    
    // 确保目录存在
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // 加载已有数据
    this.load();
    
    // 定期保存
    this.saveInterval = setInterval(() => {
      if (this.dirty) {
        this.save();
      }
    }, 30000); // 30秒
  }
  
  /**
   * 添加文档
   */
  async add(doc: VectorDocument): Promise<void> {
    await this.memoryStore.add(doc);
    this.dirty = true;
  }
  
  /**
   * 批量添加文档
   */
  async addBatch(docs: VectorDocument[]): Promise<void> {
    await this.memoryStore.addBatch(docs);
    this.dirty = true;
  }
  
  /**
   * 获取文档
   */
  async get(id: string): Promise<VectorDocument | null> {
    return this.memoryStore.get(id);
  }
  
  /**
   * 删除文档
   */
  async delete(id: string): Promise<boolean> {
    const result = await this.memoryStore.delete(id);
    if (result) {
      this.dirty = true;
    }
    return result;
  }
  
  /**
   * 搜索相似文档
   */
  async search(query: EmbeddingVector, options?: SearchOptions): Promise<SearchResult[]> {
    return this.memoryStore.search(query, options);
  }
  
  /**
   * 获取所有文档
   */
  async getAll(): Promise<VectorDocument[]> {
    return this.memoryStore.getAll();
  }
  
  /**
   * 获取文档数量
   */
  async count(): Promise<number> {
    return this.memoryStore.count();
  }
  
  /**
   * 清空存储
   */
  async clear(): Promise<void> {
    await this.memoryStore.clear();
    this.dirty = true;
  }
  
  /**
   * 保存到文件
   */
  async save(): Promise<void> {
    const docs = await this.memoryStore.getAll();
    
    const data = {
      version: 1,
      dimensions: this.dimensions,
      documents: docs,
      savedAt: Date.now(),
    };
    
    fs.writeFileSync(this.dbPath, JSON.stringify(data, null, 2));
    this.dirty = false;
    
    logger.debug(`保存向量存储: ${docs.length} 个文档`);
  }
  
  /**
   * 从文件加载
   */
  private load(): void {
    if (!fs.existsSync(this.dbPath)) {
      logger.debug('向量存储文件不存在，创建新存储');
      return;
    }
    
    try {
      const data = JSON.parse(fs.readFileSync(this.dbPath, 'utf-8'));
      
      if (data.version !== 1) {
        logger.warn('向量存储版本不匹配，跳过加载');
        return;
      }
      
      if (data.dimensions !== this.dimensions) {
        logger.warn(`向量维度不匹配: ${data.dimensions} vs ${this.dimensions}`);
        return;
      }
      
      for (const doc of data.documents || []) {
        this.memoryStore.add(doc).catch(() => {});
      }
      
      logger.info(`加载向量存储: ${data.documents?.length || 0} 个文档`);
    } catch (error) {
      logger.error(`加载向量存储失败: ${error}`);
    }
  }
  
  /**
   * 关闭存储
   */
  async close(): Promise<void> {
    if (this.saveInterval) {
      clearInterval(this.saveInterval);
    }
    
    if (this.dirty) {
      await this.save();
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 全局实例
// ═══════════════════════════════════════════════════════════════

let globalVectorStore: MemoryVectorStore | PersistentVectorStore | null = null;

/**
 * 获取全局向量存储
 */
export function getVectorStore(): MemoryVectorStore | PersistentVectorStore {
  if (!globalVectorStore) {
    globalVectorStore = new MemoryVectorStore(384);
  }
  return globalVectorStore;
}

/**
 * 设置全局向量存储
 */
export function setVectorStore(store: MemoryVectorStore | PersistentVectorStore): void {
  globalVectorStore = store;
}

/**
 * 重置全局向量存储
 */
export function resetVectorStore(): void {
  globalVectorStore = null;
}

/**
 * 创建持久化向量存储
 */
export function createPersistentVectorStore(
  dbPath: string,
  dimensions: number = 384
): PersistentVectorStore {
  return new PersistentVectorStore({ dbPath, dimensions });
}

// ═══════════════════════════════════════════════════════════════
// 便捷函数
// ═══════════════════════════════════════════════════════════════

/**
 * 搜索相似内容
 */
export async function searchSimilar(
  query: EmbeddingVector,
  options?: SearchOptions
): Promise<SearchResult[]> {
  return getVectorStore().search(query, options);
}

/**
 * 添加向量文档
 */
export async function addVectorDoc(
  id: string,
  content: string,
  vector: EmbeddingVector,
  metadata?: Record<string, unknown>
): Promise<void> {
  await getVectorStore().add({
    id,
    content,
    vector,
    metadata: metadata || {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
}
