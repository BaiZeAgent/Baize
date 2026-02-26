/**
 * 语义缓存 - 基于语义相似度的缓存
 * 
 * 第十二章 12.3 语义缓存
 * 
 * 功能：
 * 1. 语义相似度匹配
 * 2. 缓存命中
 * 3. 缓存过期
 */

import { getLogger } from '../../observability/logger';

const logger = getLogger('core:cache');

interface CacheEntry {
  query: string;
  response: string;
  embedding: number[];
  timestamp: number;
  hitCount: number;
  ttl: number;
}

/**
 * 语义缓存
 */
export class SemanticCache {
  private cache: Map<string, CacheEntry> = new Map();
  private maxSize: number = 1000;
  private defaultTTL: number = 3600000; // 1小时

  constructor(options: { maxSize?: number; ttl?: number } = {}) {
    this.maxSize = options.maxSize || 1000;
    this.defaultTTL = options.ttl || 3600000;
    logger.info('语义缓存初始化', { maxSize: this.maxSize, ttl: this.defaultTTL });
  }

  /**
   * 获取缓存
   */
  async get(query: string, threshold: number = 0.95): Promise<string | null> {
    // 先检查精确匹配
    const exact = this.cache.get(query);
    if (exact && !this.isExpired(exact)) {
      exact.hitCount++;
      logger.debug('缓存精确命中', { query: query.substring(0, 50) });
      return exact.response;
    }

    // 语义相似度匹配
    const queryEmbedding = await this.getEmbedding(query);
    
    for (const [key, entry] of this.cache) {
      if (this.isExpired(entry)) {
        this.cache.delete(key);
        continue;
      }

      const similarity = this.cosineSimilarity(queryEmbedding, entry.embedding);
      if (similarity >= threshold) {
        entry.hitCount++;
        logger.debug('缓存语义命中', { 
          query: query.substring(0, 50), 
          similarity: Math.round(similarity * 100) + '%' 
        });
        return entry.response;
      }
    }

    return null;
  }

  /**
   * 设置缓存
   */
  async set(query: string, response: string, ttl?: number): Promise<void> {
    // 检查缓存大小
    if (this.cache.size >= this.maxSize) {
      this.evict();
    }

    const embedding = await this.getEmbedding(query);
    
    this.cache.set(query, {
      query,
      response,
      embedding,
      timestamp: Date.now(),
      hitCount: 0,
      ttl: ttl || this.defaultTTL,
    });

    logger.debug('缓存已设置', { query: query.substring(0, 50) });
  }

  /**
   * 检查是否过期
   */
  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp > entry.ttl;
  }

  /**
   * 淘汰缓存
   */
  private evict(): void {
    // 按命中次数和时间排序，淘汰最少使用的
    const entries = Array.from(this.cache.entries());
    entries.sort((a, b) => {
      if (a[1].hitCount !== b[1].hitCount) {
        return a[1].hitCount - b[1].hitCount;
      }
      return a[1].timestamp - b[1].timestamp;
    });

    // 淘汰10%
    const toRemove = Math.ceil(this.maxSize * 0.1);
    for (let i = 0; i < toRemove && i < entries.length; i++) {
      this.cache.delete(entries[i][0]);
    }

    logger.debug('缓存淘汰', { removed: toRemove });
  }

  /**
   * 获取嵌入向量
   * 简化实现：使用简单的哈希向量
   */
  private async getEmbedding(text: string): Promise<number[]> {
    // 简化实现：生成一个基于文本的伪向量
    const vector: number[] = [];
    const words = text.toLowerCase().split(/\s+/);
    
    for (let i = 0; i < 128; i++) {
      let sum = 0;
      for (const word of words) {
        sum += (word.charCodeAt(i % word.length) || 0) * (i + 1);
      }
      vector.push(sum / 1000);
    }

    // 归一化
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    return vector.map(v => v / norm);
  }

  /**
   * 计算余弦相似度
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    
    let dotProduct = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
    }
    
    return dotProduct;
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
    logger.info('缓存已清空');
  }

  /**
   * 获取统计信息
   */
  getStats(): { size: number; totalHits: number; avgHitCount: number } {
    let totalHits = 0;
    for (const entry of this.cache.values()) {
      totalHits += entry.hitCount;
    }

    return {
      size: this.cache.size,
      totalHits,
      avgHitCount: this.cache.size > 0 ? totalHits / this.cache.size : 0,
    };
  }
}

// 全局实例
let semanticCache: SemanticCache | null = null;

export function getSemanticCache(): SemanticCache {
  if (!semanticCache) {
    semanticCache = new SemanticCache();
  }
  return semanticCache;
}
