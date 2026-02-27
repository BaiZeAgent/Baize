/**
 * Web 搜索工具
 * 
 * 支持多种搜索提供商：
 * - Brave Search
 * - DuckDuckGo (无需 API Key)
 * - Google Custom Search
 */

import { BaseTool, ToolResult, ToolContext, readStringParam, readNumberParam, jsonResult, errorResult } from './base';
import { getLogger } from '../observability/logger';

const logger = getLogger('tools:web-search');

// 搜索提供商类型
type SearchProvider = 'brave' | 'duckduckgo' | 'google';

// 搜索结果
interface SearchResult {
  title: string;
  url: string;
  description: string;
  published?: string;
  siteName?: string;
}

// 搜索响应
interface SearchResponse {
  query: string;
  provider: SearchProvider;
  results: SearchResult[];
  tookMs: number;
}

/**
 * Brave Search API
 */
async function braveSearch(query: string, count: number): Promise<SearchResult[]> {
  const apiKey = process.env.BRAVE_API_KEY;
  if (!apiKey) {
    throw new Error('需要设置 BRAVE_API_KEY 环境变量');
  }

  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(count));

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': apiKey,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Brave Search API 错误 (${response.status}): ${text}`);
  }

  const data = await response.json() as any;
  const results = data.web?.results ?? [];

  return results.map((entry: any) => ({
    title: entry.title ?? '',
    url: entry.url ?? '',
    description: entry.description ?? '',
    published: entry.age,
    siteName: entry.url ? new URL(entry.url).hostname : undefined,
  }));
}

/**
 * DuckDuckGo 搜索 (无需 API Key)
 */
async function duckduckgoSearch(query: string, count: number): Promise<SearchResult[]> {
  // DuckDuckGo Instant Answer API
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`DuckDuckGo API 错误 (${response.status})`);
  }

  const data = await response.json() as any;
  const results: SearchResult[] = [];

  // 相关主题
  if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
    for (const topic of data.RelatedTopics.slice(0, count)) {
      if (topic.Text && topic.FirstURL) {
        results.push({
          title: topic.Text.split(' - ')[0] || topic.Text.slice(0, 50),
          url: topic.FirstURL,
          description: topic.Text,
        });
      }
    }
  }

  // 抽象结果
  if (data.Abstract && data.AbstractURL) {
    results.unshift({
      title: data.Heading || '摘要',
      url: data.AbstractURL,
      description: data.Abstract,
      siteName: data.AbstractSource,
    });
  }

  return results.slice(0, count);
}

/**
 * Google Custom Search API
 */
async function googleSearch(query: string, count: number): Promise<SearchResult[]> {
  const apiKey = process.env.GOOGLE_API_KEY;
  const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;

  if (!apiKey || !searchEngineId) {
    throw new Error('需要设置 GOOGLE_API_KEY 和 GOOGLE_SEARCH_ENGINE_ID 环境变量');
  }

  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('q', query);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('cx', searchEngineId);
  url.searchParams.set('num', String(count));

  const response = await fetch(url.toString());
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Search API 错误 (${response.status}): ${text}`);
  }

  const data = await response.json() as any;
  const items = data.items ?? [];

  return items.map((item: any) => ({
    title: item.title ?? '',
    url: item.link ?? '',
    description: item.snippet ?? '',
    siteName: item.displayLink,
  }));
}

/**
 * 自动选择搜索提供商
 */
function autoSelectProvider(): SearchProvider {
  if (process.env.BRAVE_API_KEY) return 'brave';
  if (process.env.GOOGLE_API_KEY && process.env.GOOGLE_SEARCH_ENGINE_ID) return 'google';
  return 'duckduckgo';
}

/**
 * Web 搜索工具
 */
export class WebSearchTool extends BaseTool<Record<string, unknown>, SearchResponse> {
  name = 'web_search';
  label = 'Web Search';
  description = '搜索互联网获取信息。支持 Brave、DuckDuckGo、Google 搜索。返回相关网页标题、链接和摘要。';
  parameters = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '搜索查询字符串',
      },
      count: {
        type: 'number',
        description: '返回结果数量 (1-10)',
        minimum: 1,
        maximum: 10,
      },
      provider: {
        type: 'string',
        enum: ['brave', 'duckduckgo', 'google'],
        description: '搜索提供商 (可选，默认自动选择)',
      },
    },
    required: ['query'],
  };

  async execute(params: Record<string, unknown>, context?: ToolContext): Promise<ToolResult<SearchResponse>> {
    const query = readStringParam(params, 'query', { required: true, label: '搜索查询' });
    if (!query) {
      return errorResult('搜索查询不能为空');
    }

    const count = readNumberParam(params, 'count', { min: 1, max: 10 }) ?? 5;
    const providerInput = readStringParam(params, 'provider');
    const provider: SearchProvider = (providerInput as SearchProvider) || autoSelectProvider();

    logger.info(`执行搜索: "${query}" (provider=${provider}, count=${count})`);

    const start = Date.now();
    let results: SearchResult[];

    try {
      switch (provider) {
        case 'brave':
          results = await braveSearch(query, count);
          break;
        case 'google':
          results = await googleSearch(query, count);
          break;
        case 'duckduckgo':
        default:
          results = await duckduckgoSearch(query, count);
          break;
      }

      const tookMs = Date.now() - start;
      logger.info(`搜索完成: ${results.length} 个结果 (${tookMs}ms)`);

      return jsonResult({
        query,
        provider,
        results,
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
 * Web 搜索工具参数
 */
export interface WebSearchParams {
  query: string;
  count?: number;
  provider?: SearchProvider;
}
