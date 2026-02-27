/**
 * 记忆搜索工具
 * 
 * 功能：
 * - 搜索记忆库
 * - 读取记忆文件
 * - 支持语义搜索
 */

import { BaseTool, ToolResult, readStringParam, readNumberParam, jsonResult, errorResult } from './base';
import { getMemory } from '../memory';
import { getLogger } from '../observability/logger';

const logger = getLogger('tools:memory');

// 搜索结果
interface MemorySearchResult {
  id: number;
  type: string;
  content: string;
  timestamp: string;
  score: number;
}

// 搜索响应
interface MemorySearchResponse {
  query: string;
  results: MemorySearchResult[];
  total: number;
  tookMs: number;
}

// 读取结果
interface MemoryGetResult {
  key: string;
  value: string;
  confidence: number;
  found: boolean;
}

/**
 * 记忆搜索工具
 */
export class MemorySearchTool extends BaseTool<Record<string, unknown>, MemorySearchResponse> {
  name = 'memory_search';
  label = 'Memory Search';
  description = '搜索记忆库中的历史对话和存储的信息。用于回忆之前的对话内容、用户偏好或学习到的知识。';
  parameters = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索查询',
      },
      type: {
        type: 'string',
        description: '记忆类型 (conversation, learning, task 等)',
      },
      limit: {
        type: 'number',
        description: '返回结果数量，默认 10',
        minimum: 1,
        maximum: 50,
      },
    },
    required: ['query'],
  };

  async execute(params: Record<string, unknown>): Promise<ToolResult<MemorySearchResponse>> {
    const query = readStringParam(params, 'query', { required: true, label: '搜索查询' });
    if (!query) {
      return errorResult('搜索查询不能为空');
    }

    const type = readStringParam(params, 'type');
    const limit = readNumberParam(params, 'limit', { min: 1, max: 50 }) ?? 10;

    logger.info(`搜索记忆: "${query}" (type=${type || 'all'}, limit=${limit})`);

    const start = Date.now();
    const memory = getMemory();

    try {
      const results: MemorySearchResult[] = [];
      const queryLower = query.toLowerCase();

      // 1. 搜索声明式记忆（用户偏好等）
      const allPreferences = memory.getAllPreferences();
      
      // 关键词映射 - 支持中英文和多种表达方式
      const keywordMap: Record<string, string[]> = {
        '吃': ['food', '食物', '吃', 'food_preference'],
        '食物': ['food', '食物', '吃', 'food_preference'],
        '美食': ['food', '食物', '吃', 'food_preference'],
        '名字': ['name', '名字', '称呼', 'user_name'],
        '叫什么': ['name', '名字', '称呼', 'user_name'],
        '职业': ['job', '职业', '工作', '开发', '前端', '后端', 'user_job'],
        '工作': ['job', '职业', '工作', 'user_job'],
        '喜欢': ['like', 'prefer', '喜欢', 'preference'],
        '爱好': ['hobby', '爱好', 'interest'],
      };
      
      // 扩展搜索词
      const searchTerms = [queryLower];
      for (const [key, values] of Object.entries(keywordMap)) {
        if (queryLower.includes(key)) {
          searchTerms.push(...values);
        }
      }
      
      for (const [key, value] of Object.entries(allPreferences)) {
        const keyLower = key.toLowerCase();
        const valueLower = String(value).toLowerCase();
        
        // 检查是否匹配任何搜索词
        let matched = false;
        let score = 0;
        
        for (const term of searchTerms) {
          if (keyLower.includes(term) || valueLower.includes(term)) {
            matched = true;
            score += 10;
          }
        }
        
        if (matched) {
          results.push({
            id: 0,
            type: 'preference',
            content: `${key}: ${value}`,
            timestamp: new Date().toISOString(),
            score,
          });
        }
      }

      // 2. 搜索情景记忆
      const episodes = memory.getEpisodes(type, 1000);
      const queryWords = queryLower.split(/\s+/);

      for (const episode of episodes) {
        const contentLower = episode.content.toLowerCase();
        
        let score = 0;
        
        for (const word of queryWords) {
          if (word.length < 2) continue;
          const matches = (contentLower.match(new RegExp(word, 'g')) || []).length;
          score += matches;
        }
        
        // 也检查扩展搜索词
        for (const term of searchTerms) {
          if (contentLower.includes(term)) {
            score += 5;
          }
        }

        if (score > 0) {
          results.push({
            id: episode.id,
            type: episode.type,
            content: episode.content,
            timestamp: episode.timestamp.toISOString(),
            score,
          });
        }
      }

      // 按分数排序
      results.sort((a, b) => b.score - a.score);
      
      // 限制数量
      const limited = results.slice(0, limit);
      const tookMs = Date.now() - start;

      logger.info(`搜索完成: ${limited.length} 个结果 (${tookMs}ms)`);

      return jsonResult({
        query,
        results: limited,
        total: results.length,
        tookMs,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`搜索失败: ${errorMsg}`);
      return errorResult(errorMsg);
    }
  }
}

/**
 * 记忆读取工具
 */
export class MemoryGetTool extends BaseTool<Record<string, unknown>, MemoryGetResult> {
  name = 'memory_get';
  label = 'Memory Get';
  description = '从声明式记忆中读取特定键的值。用于获取用户偏好、系统设置等存储的信息。';
  parameters = {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: '记忆键名',
      },
    },
    required: ['key'],
  };

  async execute(params: Record<string, unknown>): Promise<ToolResult<MemoryGetResult>> {
    const key = readStringParam(params, 'key', { required: true, label: '键名' });
    if (!key) {
      return errorResult('键名不能为空');
    }

    logger.info(`读取记忆: ${key}`);

    const memory = getMemory();
    const result = memory.recall(key);

    if (result) {
      return jsonResult({
        key,
        value: result.value,
        confidence: result.confidence,
        found: true,
      });
    } else {
      return jsonResult({
        key,
        value: '',
        confidence: 0,
        found: false,
      });
    }
  }
}

/**
 * 记忆存储工具
 */
export class MemorySetTool extends BaseTool<Record<string, unknown>, { key: string; success: boolean }> {
  name = 'memory_set';
  label = 'Memory Set';
  description = '将信息存储到声明式记忆中。用于记住用户偏好、重要信息等。';
  parameters = {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: '记忆键名',
      },
      value: {
        type: 'string',
        description: '要存储的值',
      },
      confidence: {
        type: 'number',
        description: '置信度 (0-1)，默认 0.8',
        minimum: 0,
        maximum: 1,
      },
    },
    required: ['key', 'value'],
  };

  async execute(params: Record<string, unknown>): Promise<ToolResult<{ key: string; success: boolean }>> {
    const key = readStringParam(params, 'key', { required: true, label: '键名' });
    const value = readStringParam(params, 'value', { required: true, label: '值' });
    
    if (!key || !value) {
      return errorResult('键名和值都不能为空');
    }

    const confidence = readNumberParam(params, 'confidence', { min: 0, max: 1 }) ?? 0.8;

    logger.info(`存储记忆: ${key} = ${value.slice(0, 50)}...`);

    const memory = getMemory();
    memory.remember(key, value, confidence);

    return jsonResult({
      key,
      success: true,
    });
  }
}
