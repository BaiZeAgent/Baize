/**
 * 上下文压缩器 - 上下文压缩策略
 * 
 * 第十二章 上下文管理
 * 
 * 功能：
 * 1. 摘要提取
 * 2. 关键信息保留
 * 3. 历史压缩
 */

import { getLogger } from '../../observability/logger';
import { ContextEntry, CompressionStrategy } from '../../types';

const logger = getLogger('context:compressor');

/**
 * 压缩结果
 */
interface CompressionResult {
  original: ContextEntry[];
  compressed: ContextEntry[];
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number;
}

/**
 * 上下文压缩器
 */
export class ContextCompressor {
  private defaultStrategy: CompressionStrategy = {
    type: 'summary',
    targetRatio: 0.3,
    preserveKeys: ['coreNeed', 'taskId', 'skillName', 'success'],
  };

  /**
   * 压缩条目列表
   */
  compress(entries: ContextEntry[], strategy?: CompressionStrategy): CompressionResult {
    const s = strategy || this.defaultStrategy;
    const originalTokens = entries.reduce((sum, e) => sum + e.tokens, 0);

    logger.debug('开始压缩', {
      entries: entries.length,
      originalTokens,
      strategy: s.type,
      targetRatio: s.targetRatio
    });

    let compressed: ContextEntry[];

    switch (s.type) {
      case 'summary':
        compressed = this.compressBySummary(entries, s);
        break;
      case 'extract':
        compressed = this.compressByExtract(entries, s);
        break;
      case 'truncate':
        compressed = this.compressByTruncate(entries, s);
        break;
      default:
        compressed = entries;
    }

    const compressedTokens = compressed.reduce((sum, e) => sum + e.tokens, 0);
    const compressionRatio = originalTokens > 0 ? compressedTokens / originalTokens : 0;

    logger.info('压缩完成', {
      originalEntries: entries.length,
      compressedEntries: compressed.length,
      originalTokens,
      compressedTokens,
      compressionRatio: `${Math.round(compressionRatio * 100)}%`
    });

    return {
      original: entries,
      compressed,
      originalTokens,
      compressedTokens,
      compressionRatio,
    };
  }

  /**
   * 摘要压缩：生成摘要
   */
  private compressBySummary(entries: ContextEntry[], strategy: CompressionStrategy): ContextEntry[] {
    // 按类型分组
    const grouped = this.groupByType(entries);
    const result: ContextEntry[] = [];

    // 对每种类型生成摘要
    for (const [type, typeEntries] of Object.entries(grouped)) {
      if (typeEntries.length === 0) continue;

      // 保留高重要性的条目
      const highImportance = typeEntries.filter(e => e.importance >= 0.8);
      
      if (highImportance.length > 0) {
        result.push(...highImportance);
      }

      // 对低重要性条目生成摘要
      const lowImportance = typeEntries.filter(e => e.importance < 0.8);
      if (lowImportance.length > 2) {
        const summary = this.generateSummary(lowImportance, type);
        result.push(summary);
      } else {
        result.push(...lowImportance);
      }
    }

    return result;
  }

  /**
   * 提取压缩：提取关键信息
   */
  private compressByExtract(entries: ContextEntry[], strategy: CompressionStrategy): ContextEntry[] {
    return entries.map(entry => {
      // 提取关键信息
      const extracted = this.extractKeyInfo(entry.content, strategy.preserveKeys);
      
      if (extracted.length < entry.content.length) {
        return {
          ...entry,
          content: extracted,
          tokens: this.countTokens(extracted),
        };
      }
      
      return entry;
    });
  }

  /**
   * 截断压缩：直接截断
   */
  private compressByTruncate(entries: ContextEntry[], strategy: CompressionStrategy): ContextEntry[] {
    const targetTokens = Math.floor(
      entries.reduce((sum, e) => sum + e.tokens, 0) * strategy.targetRatio
    );

    // 按重要性排序
    const sorted = [...entries].sort((a, b) => b.importance - a.importance);
    
    const result: ContextEntry[] = [];
    let currentTokens = 0;

    for (const entry of sorted) {
      if (currentTokens + entry.tokens <= targetTokens) {
        result.push(entry);
        currentTokens += entry.tokens;
      }
    }

    // 按时间重新排序
    return result.sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }

  /**
   * 按类型分组
   */
  private groupByType(entries: ContextEntry[]): Record<string, ContextEntry[]> {
    const grouped: Record<string, ContextEntry[]> = {};
    
    for (const entry of entries) {
      if (!grouped[entry.type]) {
        grouped[entry.type] = [];
      }
      grouped[entry.type].push(entry);
    }
    
    return grouped;
  }

  /**
   * 生成摘要
   */
  private generateSummary(entries: ContextEntry[], type: string): ContextEntry {
    // 简化实现：合并内容并截断
    const combinedContent = entries
      .map(e => e.content)
      .join('\n');

    // 提取关键句子
    const sentences = combinedContent.split(/[。！？\n]/);
    const keySentences = sentences
      .filter(s => s.length > 10)
      .slice(0, 3)
      .join('。');

    const summaryContent = `[${type}摘要] ${keySentences}... (共${entries.length}条)`;

    return {
      id: `summary_${Date.now()}`,
      type: type as ContextEntry['type'],
      content: summaryContent,
      tokens: this.countTokens(summaryContent),
      timestamp: new Date(),
      importance: 0.5,
      compressible: false,
    };
  }

  /**
   * 提取关键信息
   */
  private extractKeyInfo(content: string, preserveKeys: string[]): string {
    // 简化实现：查找包含关键词的句子
    const sentences = content.split(/[。！？\n]/);
    const keySentences: string[] = [];

    for (const sentence of sentences) {
      for (const key of preserveKeys) {
        if (sentence.includes(key)) {
          keySentences.push(sentence);
          break;
        }
      }
    }

    return keySentences.length > 0 
      ? keySentences.join('。') 
      : content.substring(0, Math.min(200, content.length));
  }

  /**
   * 计算Token数量
   */
  private countTokens(text: string): number {
    if (!text) return 0;
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const otherChars = text.length - chineseChars;
    return Math.ceil(chineseChars / 1.5 + otherChars / 4);
  }

  /**
   * 压缩思考过程
   */
  compressThoughtProcess(thoughtProcess: Record<string, unknown>): string {
    const parts: string[] = [];

    // 提取各阶段关键信息
    if (thoughtProcess.understanding) {
      const u = thoughtProcess.understanding as Record<string, unknown>;
      parts.push(`理解: ${u.coreNeed || ''}`);
    }

    if (thoughtProcess.decomposition) {
      const d = thoughtProcess.decomposition as Record<string, unknown>;
      const tasks = d.tasks as Array<Record<string, unknown>> || [];
      parts.push(`任务: ${tasks.length}个`);
    }

    if (thoughtProcess.planning) {
      const p = thoughtProcess.planning as Record<string, unknown>;
      parts.push(`规划: 需确认=${p.needConfirm || false}`);
    }

    return parts.join(' | ');
  }

  /**
   * 压缩任务历史
   */
  compressTaskHistory(tasks: Array<Record<string, unknown>>): string {
    const success = tasks.filter(t => t.success).length;
    const failed = tasks.length - success;
    
    return `执行${tasks.length}个任务: ${success}成功, ${failed}失败`;
  }
}

// 全局实例
let contextCompressor: ContextCompressor | null = null;

export function getContextCompressor(): ContextCompressor {
  if (!contextCompressor) {
    contextCompressor = new ContextCompressor();
  }
  return contextCompressor;
}
