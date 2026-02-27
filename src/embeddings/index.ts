/**
 * 嵌入系统 - 多提供者支持
 * 
 * 提供统一的文本嵌入接口：
 * 1. OpenAI Embeddings
 * 2. 本地嵌入模型
 * 3. 缓存支持
 */

import { getLogger } from '../observability/logger';
import { randomBytes } from 'crypto';

const logger = getLogger('embeddings');

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

/**
 * 嵌入向量
 */
export type EmbeddingVector = number[];

/**
 * 嵌入结果
 */
export interface EmbeddingResult {
  vector: EmbeddingVector;
  model: string;
  dimensions: number;
  tokens: number;
}

/**
 * 批量嵌入结果
 */
export interface BatchEmbeddingResult {
  vectors: EmbeddingVector[];
  model: string;
  dimensions: number;
  totalTokens: number;
}

/**
 * 嵌入提供者配置
 */
export interface EmbeddingProviderConfig {
  name: string;
  model: string;
  dimensions: number;
  maxTokens: number;
  batchSize: number;
}

/**
 * OpenAI 配置
 */
export interface OpenAIEmbeddingConfig extends EmbeddingProviderConfig {
  apiKey: string;
  baseUrl?: string;
}

/**
 * 本地嵌入配置
 */
export interface LocalEmbeddingConfig extends EmbeddingProviderConfig {
  modelPath?: string;
}

// ═══════════════════════════════════════════════════════════════
// 嵌入提供者接口
// ═══════════════════════════════════════════════════════════════

/**
 * 嵌入提供者接口
 */
export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;
  
  embed(text: string): Promise<EmbeddingResult>;
  embedBatch(texts: string[]): Promise<BatchEmbeddingResult>;
  isAvailable(): Promise<boolean>;
}

// ═══════════════════════════════════════════════════════════════
// OpenAI 嵌入提供者
// ═══════════════════════════════════════════════════════════════

/**
 * OpenAI 嵌入提供者
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai';
  readonly model: string;
  readonly dimensions: number;
  
  private apiKey: string;
  private baseUrl: string;
  private maxTokens: number;
  private batchSize: number;
  
  constructor(config: Partial<OpenAIEmbeddingConfig> & { apiKey: string }) {
    this.model = config.model || 'text-embedding-3-small';
    this.dimensions = config.dimensions || 1536;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    this.maxTokens = config.maxTokens || 8191;
    this.batchSize = config.batchSize || 100;
  }
  
  async embed(text: string): Promise<EmbeddingResult> {
    const result = await this.embedBatch([text]);
    return {
      vector: result.vectors[0],
      model: result.model,
      dimensions: result.dimensions,
      tokens: result.totalTokens,
    };
  }
  
  async embedBatch(texts: string[]): Promise<BatchEmbeddingResult> {
    // 分批处理
    const allVectors: EmbeddingVector[] = [];
    let totalTokens = 0;
    
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const response = await this.callAPI(batch);
      
      for (const item of response.data) {
        allVectors.push(item.embedding);
      }
      totalTokens += response.usage.total_tokens;
    }
    
    return {
      vectors: allVectors,
      model: this.model,
      dimensions: this.dimensions,
      totalTokens,
    };
  }
  
  async isAvailable(): Promise<boolean> {
    try {
      await this.embed('test');
      return true;
    } catch {
      return false;
    }
  }
  
  private async callAPI(texts: string[]): Promise<any> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        dimensions: this.dimensions,
      }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${error}`);
    }
    
    return response.json();
  }
}

// ═══════════════════════════════════════════════════════════════
// 本地嵌入提供者
// ═══════════════════════════════════════════════════════════════

/**
 * 本地嵌入提供者 (简化版)
 * 
 * 使用简单的哈希向量作为嵌入
 * 注意：这不是真正的语义嵌入，仅用于测试和演示
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'local';
  readonly model = 'local-hash';
  readonly dimensions: number;
  
  constructor(config?: Partial<LocalEmbeddingConfig>) {
    this.dimensions = config?.dimensions || 384;
  }
  
  async embed(text: string): Promise<EmbeddingResult> {
    const vector = this.textToVector(text);
    return {
      vector,
      model: this.model,
      dimensions: this.dimensions,
      tokens: Math.ceil(text.length / 4),
    };
  }
  
  async embedBatch(texts: string[]): Promise<BatchEmbeddingResult> {
    const vectors = texts.map(t => this.textToVector(t));
    return {
      vectors,
      model: this.model,
      dimensions: this.dimensions,
      totalTokens: Math.ceil(texts.reduce((sum, t) => sum + t.length, 0) / 4),
    };
  }
  
  async isAvailable(): Promise<boolean> {
    return true;
  }
  
  /**
   * 将文本转换为向量
   * 
   * 使用简单的哈希方法，不是真正的语义嵌入
   */
  private textToVector(text: string): EmbeddingVector {
    const vector = new Array(this.dimensions).fill(0);
    
    // 使用字符哈希
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      const idx = (char * (i + 1)) % this.dimensions;
      vector[idx] += Math.sin(char) * Math.cos(i);
    }
    
    // 使用单词哈希
    const words = text.toLowerCase().split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      let hash = 0;
      for (let j = 0; j < word.length; j++) {
        hash = ((hash << 5) - hash) + word.charCodeAt(j);
        hash = hash & hash;
      }
      const idx = Math.abs(hash) % this.dimensions;
      vector[idx] += 1;
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
}

// ═══════════════════════════════════════════════════════════════
// 嵌入缓存
// ═══════════════════════════════════════════════════════════════

/**
 * 嵌入缓存接口
 */
export interface EmbeddingCache {
  get(text: string): Promise<EmbeddingVector | null>;
  set(text: string, vector: EmbeddingVector): Promise<void>;
  has(text: string): Promise<boolean>;
  clear(): Promise<void>;
}

/**
 * 内存嵌入缓存
 */
export class MemoryEmbeddingCache implements EmbeddingCache {
  private cache: Map<string, EmbeddingVector> = new Map();
  private maxSize: number;
  
  constructor(maxSize: number = 10000) {
    this.maxSize = maxSize;
  }
  
  async get(text: string): Promise<EmbeddingVector | null> {
    const key = this.hashText(text);
    return this.cache.get(key) || null;
  }
  
  async set(text: string, vector: EmbeddingVector): Promise<void> {
    if (this.cache.size >= this.maxSize) {
      // 删除最早的条目
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    
    const key = this.hashText(text);
    this.cache.set(key, vector);
  }
  
  async has(text: string): Promise<boolean> {
    const key = this.hashText(text);
    return this.cache.has(key);
  }
  
  async clear(): Promise<void> {
    this.cache.clear();
  }
  
  private hashText(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash = hash & hash;
    }
    return hash.toString(16);
  }
}

// ═══════════════════════════════════════════════════════════════
// 嵌入管理器
// ═══════════════════════════════════════════════════════════════

/**
 * 嵌入管理器配置
 */
export interface EmbeddingManagerConfig {
  provider: EmbeddingProvider;
  cache?: EmbeddingCache;
  enableCache?: boolean;
}

/**
 * 嵌入管理器
 */
export class EmbeddingManager {
  private provider: EmbeddingProvider;
  private cache: EmbeddingCache;
  private enableCache: boolean;
  
  constructor(config: EmbeddingManagerConfig) {
    this.provider = config.provider;
    this.cache = config.cache || new MemoryEmbeddingCache();
    this.enableCache = config.enableCache !== false;
  }
  
  /**
   * 获取单个文本的嵌入
   */
  async embed(text: string): Promise<EmbeddingResult> {
    // 检查缓存
    if (this.enableCache) {
      const cached = await this.cache.get(text);
      if (cached) {
        return {
          vector: cached,
          model: this.provider.model,
          dimensions: this.provider.dimensions,
          tokens: 0,
        };
      }
    }
    
    // 调用提供者
    const result = await this.provider.embed(text);
    
    // 存入缓存
    if (this.enableCache) {
      await this.cache.set(text, result.vector);
    }
    
    return result;
  }
  
  /**
   * 批量获取嵌入
   */
  async embedBatch(texts: string[]): Promise<BatchEmbeddingResult> {
    if (!this.enableCache) {
      return this.provider.embedBatch(texts);
    }
    
    // 分离已缓存和未缓存的
    const cached: Map<number, EmbeddingVector> = new Map();
    const uncached: { index: number; text: string }[] = [];
    
    for (let i = 0; i < texts.length; i++) {
      const cachedVector = await this.cache.get(texts[i]);
      if (cachedVector) {
        cached.set(i, cachedVector);
      } else {
        uncached.push({ index: i, text: texts[i] });
      }
    }
    
    // 获取未缓存的嵌入
    let result: BatchEmbeddingResult;
    if (uncached.length > 0) {
      const uncachedTexts = uncached.map(u => u.text);
      result = await this.provider.embedBatch(uncachedTexts);
      
      // 存入缓存
      for (let i = 0; i < uncached.length; i++) {
        await this.cache.set(uncached[i].text, result.vectors[i]);
      }
    } else {
      result = {
        vectors: [],
        model: this.provider.model,
        dimensions: this.provider.dimensions,
        totalTokens: 0,
      };
    }
    
    // 合并结果
    const allVectors: EmbeddingVector[] = new Array(texts.length);
    
    // 填充缓存的结果
    for (const [index, vector] of cached) {
      allVectors[index] = vector;
    }
    
    // 填充新计算的结果
    for (let i = 0; i < uncached.length; i++) {
      allVectors[uncached[i].index] = result.vectors[i];
    }
    
    return {
      vectors: allVectors,
      model: result.model,
      dimensions: result.dimensions,
      totalTokens: result.totalTokens,
    };
  }
  
  /**
   * 计算余弦相似度
   */
  cosineSimilarity(a: EmbeddingVector, b: EmbeddingVector): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same length');
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
   * 清除缓存
   */
  async clearCache(): Promise<void> {
    await this.cache.clear();
  }
  
  /**
   * 获取提供者信息
   */
  getProviderInfo(): { name: string; model: string; dimensions: number } {
    return {
      name: this.provider.name,
      model: this.provider.model,
      dimensions: this.provider.dimensions,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// 全局实例
// ═══════════════════════════════════════════════════════════════

let globalEmbeddingManager: EmbeddingManager | null = null;

/**
 * 获取全局嵌入管理器
 */
export function getEmbeddingManager(): EmbeddingManager {
  if (!globalEmbeddingManager) {
    // 默认使用本地嵌入
    const provider = new LocalEmbeddingProvider();
    globalEmbeddingManager = new EmbeddingManager({ provider });
  }
  return globalEmbeddingManager;
}

/**
 * 设置全局嵌入管理器
 */
export function setEmbeddingManager(manager: EmbeddingManager): void {
  globalEmbeddingManager = manager;
}

/**
 * 重置全局嵌入管理器
 */
export function resetEmbeddingManager(): void {
  globalEmbeddingManager = null;
}

/**
 * 获取文本嵌入 (便捷函数)
 */
export async function getEmbedding(text: string): Promise<EmbeddingVector> {
  const result = await getEmbeddingManager().embed(text);
  return result.vector;
}

/**
 * 批量获取嵌入 (便捷函数)
 */
export async function getEmbeddings(texts: string[]): Promise<EmbeddingVector[]> {
  const result = await getEmbeddingManager().embedBatch(texts);
  return result.vectors;
}

/**
 * 计算相似度 (便捷函数)
 */
export async function similarity(text1: string, text2: string): Promise<number> {
  const manager = getEmbeddingManager();
  const [vec1, vec2] = await Promise.all([
    manager.embed(text1),
    manager.embed(text2),
  ]);
  return manager.cosineSimilarity(vec1.vector, vec2.vector);
}
