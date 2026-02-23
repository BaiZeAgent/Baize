/**
 * 知识层 - 向量存储与RAG
 * 
 * 支持：
 * 1. 内存向量存储
 * 2. 简单的向量相似度计算
 * 3. RAG检索增强生成
 */
import { getLogger } from '../observability/logger';

const logger = getLogger('knowledge');

/**
 * 知识条目
 */
export interface KnowledgeEntry {
  id: string;
  content: string;
  embedding?: number[];
  metadata: Record<string, unknown>;
  createdAt: Date;
}

/**
 * 搜索结果
 */
export interface SearchResult {
  entry: KnowledgeEntry;
  score: number;
}

/**
 * 向量存储接口
 */
export interface VectorStore {
  add(entry: KnowledgeEntry): Promise<void>;
  search(query: string, topK: number): Promise<SearchResult[]>;
  searchByVector(embedding: number[], topK: number): Promise<SearchResult[]>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
  size(): number;
}

/**
 * 内存向量存储
 * 
 * 使用简单的文本匹配和余弦相似度
 */
export class MemoryVectorStore implements VectorStore {
  private entries: Map<string, KnowledgeEntry> = new Map();

  async add(entry: KnowledgeEntry): Promise<void> {
    this.entries.set(entry.id, entry);
    logger.debug(`添加知识条目: ${entry.id}`);
  }

  async search(query: string, topK: number): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/);

    for (const entry of this.entries.values()) {
      const contentLower = entry.content.toLowerCase();
      
      // 计算词匹配分数
      let matchScore = 0;
      for (const word of queryWords) {
        if (contentLower.includes(word)) {
          matchScore += 1;
        }
      }
      
      // 归一化分数
      const score = queryWords.length > 0 ? matchScore / queryWords.length : 0;
      
      if (score > 0) {
        results.push({ entry, score });
      }
    }

    // 按分数排序
    results.sort((a, b) => b.score - a.score);
    
    return results.slice(0, topK);
  }

  async searchByVector(embedding: number[], topK: number): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    for (const entry of this.entries.values()) {
      if (entry.embedding && entry.embedding.length === embedding.length) {
        const score = this.cosineSimilarity(embedding, entry.embedding);
        results.push({ entry, score });
      }
    }

    // 按分数排序
    results.sort((a, b) => b.score - a.score);
    
    return results.slice(0, topK);
  }

  async delete(id: string): Promise<void> {
    this.entries.delete(id);
    logger.debug(`删除知识条目: ${id}`);
  }

  async clear(): Promise<void> {
    this.entries.clear();
    logger.debug('清空知识库');
  }

  size(): number {
    return this.entries.size;
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
}

/**
 * RAG检索增强生成
 */
export class RAGSystem {
  private store: VectorStore;

  constructor(store?: VectorStore) {
    this.store = store || new MemoryVectorStore();
  }

  /**
   * 添加知识
   */
  async addKnowledge(
    content: string,
    metadata: Record<string, unknown> = {},
    embedding?: number[]
  ): Promise<string> {
    const id = `knowledge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    await this.store.add({
      id,
      content,
      embedding,
      metadata,
      createdAt: new Date(),
    });

    logger.info(`添加知识: ${id}`);
    return id;
  }

  /**
   * 批量添加知识
   */
  async addKnowledgeBatch(
    items: Array<{ content: string; metadata?: Record<string, unknown>; embedding?: number[] }>
  ): Promise<string[]> {
    const ids: string[] = [];
    
    for (const item of items) {
      const id = await this.addKnowledge(item.content, item.metadata, item.embedding);
      ids.push(id);
    }
    
    return ids;
  }

  /**
   * 检索相关知识
   */
  async retrieve(query: string, topK: number = 5): Promise<SearchResult[]> {
    return this.store.search(query, topK);
  }

  /**
   * 通过向量检索
   */
  async retrieveByVector(embedding: number[], topK: number = 5): Promise<SearchResult[]> {
    return this.store.searchByVector(embedding, topK);
  }

  /**
   * 构建增强上下文
   */
  async buildContext(query: string, maxTokens: number = 2000): Promise<string> {
    const results = await this.retrieve(query, 5);
    
    if (results.length === 0) {
      return '';
    }

    const contexts: string[] = ['相关知识:'];
    let currentLength = 0;

    for (const result of results) {
      const text = `\n- ${result.entry.content}`;
      
      if (currentLength + text.length > maxTokens) {
        break;
      }
      
      contexts.push(text);
      currentLength += text.length;
    }

    return contexts.join('');
  }

  /**
   * 删除知识
   */
  async deleteKnowledge(id: string): Promise<void> {
    await this.store.delete(id);
  }

  /**
   * 清空知识库
   */
  async clearKnowledge(): Promise<void> {
    await this.store.clear();
  }

  /**
   * 获取知识库大小
   */
  getKnowledgeCount(): number {
    return this.store.size();
  }

  /**
   * 获取存储实例
   */
  getStore(): VectorStore {
    return this.store;
  }
}

// 全局实例
let ragSystem: RAGSystem | null = null;

export function getRAGSystem(): RAGSystem {
  if (!ragSystem) {
    ragSystem = new RAGSystem();
  }
  return ragSystem;
}

export function getVectorStore(): VectorStore {
  return getRAGSystem().getStore();
}
