/**
 * 混合检索系统
 */

import { getLogger } from '../observability/logger';
import { getEmbeddingManager } from '../embeddings';
import { getVectorStore, SearchResult } from '../vector';

const logger = getLogger('search');

export type RetrievalStrategy = 'vector' | 'fts' | 'hybrid';

export interface SearchOptions {
  topK?: number;
  minScore?: number;
  filter?: Record<string, unknown>;
}

export interface HybridSearchOptions extends SearchOptions {
  strategy?: RetrievalStrategy;
  vectorWeight?: number;
  ftsWeight?: number;
}

export interface HybridSearchResult extends SearchResult {
  vectorScore?: number;
  ftsScore?: number;
}

export interface IndexDocument {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export class FullTextIndex {
  private index: Map<string, Set<string>> = new Map();
  private documents: Map<string, { content: string; metadata: Record<string, unknown> }> = new Map();
  
  add(id: string, content: string, metadata: Record<string, unknown> = {}): void {
    this.documents.set(id, { content, metadata });
    const tokens = this.tokenize(content);
    for (const token of tokens) {
      if (!this.index.has(token)) this.index.set(token, new Set());
      this.index.get(token)!.add(id);
    }
  }
  
  delete(id: string): boolean {
    if (!this.documents.has(id)) return false;
    const doc = this.documents.get(id)!;
    const tokens = this.tokenize(doc.content);
    for (const token of tokens) {
      this.index.get(token)?.delete(id);
    }
    this.documents.delete(id);
    return true;
  }
  
  search(query: string, topK: number = 10): Array<{ id: string; score: number }> {
    const queryTokens = this.tokenize(query);
    const scores: Map<string, number> = new Map();
    
    for (const token of queryTokens) {
      const docSet = this.index.get(token);
      if (!docSet) continue;
      
      const idf = Math.log((this.documents.size + 1) / (docSet.size + 0.5));
      
      for (const docId of docSet) {
        const doc = this.documents.get(docId);
        if (!doc) continue;
        
        const docTokens = this.tokenize(doc.content);
        const tf = docTokens.filter(t => t === token).length;
        const score = idf * tf;
        scores.set(docId, (scores.get(docId) || 0) + score);
      }
    }
    
    return Array.from(scores.entries())
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
  
  get(id: string): { content: string; metadata: Record<string, unknown> } | null {
    return this.documents.get(id) || null;
  }
  
  clear(): void {
    this.index.clear();
    this.documents.clear();
  }
  
  private tokenize(text: string): string[] {
    return text.toLowerCase().replace(/[^\w\s\u4e00-\u9fff]/g, ' ').split(/\s+/).filter(t => t.length > 0);
  }
}

export class HybridSearchEngine {
  private vectorStore = getVectorStore();
  private ftsIndex = new FullTextIndex();
  private embeddingManager = getEmbeddingManager();
  
  async index(doc: IndexDocument): Promise<void> {
    const embedding = await this.embeddingManager.embed(doc.content);
    
    await this.vectorStore.add({
      id: doc.id,
      content: doc.content,
      vector: embedding.vector,
      metadata: doc.metadata || {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    
    this.ftsIndex.add(doc.id, doc.content, doc.metadata || {});
    logger.debug(`索引文档: ${doc.id}`);
  }
  
  async indexBatch(docs: IndexDocument[]): Promise<void> {
    for (const doc of docs) {
      await this.index(doc);
    }
    logger.info(`批量索引 ${docs.length} 个文档`);
  }
  
  async delete(id: string): Promise<boolean> {
    const v = await this.vectorStore.delete(id);
    const f = this.ftsIndex.delete(id);
    return v || f;
  }
  
  async search(query: string, options: HybridSearchOptions = {}): Promise<HybridSearchResult[]> {
    const { strategy = 'hybrid', topK = 10, minScore = 0, vectorWeight = 0.5, ftsWeight = 0.5 } = options;
    
    let results: HybridSearchResult[] = [];
    
    if (strategy === 'vector') {
      results = await this.vectorSearch(query, topK);
    } else if (strategy === 'fts') {
      results = this.ftsSearch(query, topK);
    } else {
      results = await this.hybridSearch(query, topK, vectorWeight, ftsWeight);
    }
    
    return results.filter(r => r.score >= minScore);
  }
  
  private async vectorSearch(query: string, topK: number): Promise<HybridSearchResult[]> {
    const embedding = await this.embeddingManager.embed(query);
    const results = await this.vectorStore.search(embedding.vector, { topK });
    return results.map(r => ({ ...r, vectorScore: r.score }));
  }
  
  private ftsSearch(query: string, topK: number): HybridSearchResult[] {
    const ftsResults = this.ftsIndex.search(query, topK);
    return ftsResults.map(r => {
      const doc = this.ftsIndex.get(r.id);
      return { id: r.id, content: doc?.content || '', score: r.score, metadata: doc?.metadata || {}, ftsScore: r.score };
    });
  }
  
  private async hybridSearch(query: string, topK: number, vw: number, fw: number): Promise<HybridSearchResult[]> {
    const [vr, fr] = await Promise.all([
      this.vectorSearch(query, topK * 2),
      Promise.resolve(this.ftsSearch(query, topK * 2)),
    ]);
    
    const merged: Map<string, HybridSearchResult> = new Map();
    const maxV = Math.max(...vr.map(r => r.score), 1);
    const maxF = Math.max(...fr.map(r => r.score), 1);
    
    for (const r of vr) {
      merged.set(r.id, { ...r, vectorScore: r.score / maxV, score: 0 });
    }
    
    for (const r of fr) {
      const e = merged.get(r.id);
      if (e) {
        e.ftsScore = r.score / maxF;
      } else {
        merged.set(r.id, { ...r, ftsScore: r.score / maxF, score: 0 });
      }
    }
    
    for (const r of merged.values()) {
      r.score = vw * (r.vectorScore || 0) + fw * (r.ftsScore || 0);
    }
    
    return Array.from(merged.values()).sort((a, b) => b.score - a.score).slice(0, topK);
  }
  
  async clear(): Promise<void> {
    await this.vectorStore.clear();
    this.ftsIndex.clear();
  }
}

let globalSearchEngine: HybridSearchEngine | null = null;

export function getSearchEngine(): HybridSearchEngine {
  if (!globalSearchEngine) globalSearchEngine = new HybridSearchEngine();
  return globalSearchEngine;
}

export function resetSearchEngine(): void {
  globalSearchEngine = null;
}

export async function search(query: string, options?: HybridSearchOptions): Promise<HybridSearchResult[]> {
  return getSearchEngine().search(query, options);
}

export async function indexDocument(doc: IndexDocument): Promise<void> {
  return getSearchEngine().index(doc);
}
