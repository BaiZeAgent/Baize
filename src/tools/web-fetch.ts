/**
 * Web 抓取工具
 * 
 * 功能：
 * - 抓取网页内容
 * - 提取正文
 * - 支持多种输出格式
 */

import { BaseTool, ToolResult, readStringParam, readNumberParam, readBooleanParam, jsonResult, errorResult } from './base';
import { getLogger } from '../observability/logger';

const logger = getLogger('tools:web-fetch');

// 抓取结果
interface FetchResult {
  url: string;
  title: string;
  content: string;
  textContent: string;
  statusCode: number;
  contentType: string;
  tookMs: number;
}

// 简单的 HTML 清理
function stripHtml(html: string): string {
  // 移除 script 和 style 标签
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  
  // 移除注释
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  
  // 移除标签，保留内容
  text = text.replace(/<[^>]+>/g, ' ');
  
  // 解码 HTML 实体
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)));
  
  // 清理空白
  text = text.replace(/\s+/g, ' ').trim();
  
  return text;
}

// 提取标题
function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? match[1].trim() : '';
}

// 提取正文（简单实现）
function extractMainContent(html: string): string {
  // 尝试找到主要内容区域
  const patterns = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*id="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
    /<body[^>]*>([\s\S]*?)<\/body>/i,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      return stripHtml(match[1]);
    }
  }

  return stripHtml(html);
}

/**
 * Web 抓取工具
 */
export class WebFetchTool extends BaseTool<Record<string, unknown>, FetchResult> {
  name = 'web_fetch';
  label = 'Web Fetch';
  description = '抓取网页内容并提取正文。返回网页标题、纯文本内容和原始 HTML。';
  parameters = {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: '要抓取的网页 URL',
      },
      timeout: {
        type: 'number',
        description: '超时时间（秒），默认 30',
      },
      maxBytes: {
        type: 'number',
        description: '最大抓取字节数，默认 1MB',
      },
      extractText: {
        type: 'boolean',
        description: '是否提取纯文本，默认 true',
      },
    },
    required: ['url'],
  };

  async execute(params: Record<string, unknown>): Promise<ToolResult<FetchResult>> {
    const url = readStringParam(params, 'url', { required: true, label: 'URL' });
    if (!url) {
      return errorResult('URL 不能为空');
    }

    // 验证 URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return errorResult('无效的 URL 格式');
    }

    // 只允许 http/https
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return errorResult('只支持 HTTP/HTTPS 协议');
    }

    const timeout = (readNumberParam(params, 'timeout') ?? 30) * 1000;
    const maxBytes = readNumberParam(params, 'maxBytes') ?? 1024 * 1024; // 1MB
    const extractText = readBooleanParam(params, 'extractText', true);

    logger.info(`抓取网页: ${url}`);

    const start = Date.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; BaizeBot/3.2; +https://github.com/baize)',
          'Accept': 'text/html,application/xhtml+xml,text/plain',
          'Accept-Language': 'zh-CN,zh,en;q=0.9',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const contentType = response.headers.get('content-type') || 'text/html';
      
      // 检查内容类型
      if (!contentType.includes('text/') && !contentType.includes('application/json')) {
        return errorResult(`不支持的内容类型: ${contentType}`);
      }

      // 读取内容
      const reader = response.body?.getReader();
      if (!reader) {
        return errorResult('无法读取响应体');
      }

      const chunks: Uint8Array[] = [];
      let totalBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        totalBytes += value.length;
        if (totalBytes > maxBytes) {
          break;
        }
        chunks.push(value);
      }

      const buffer = Buffer.concat(chunks);
      const html = buffer.toString('utf-8');

      const title = extractTitle(html);
      const textContent = extractText ? extractMainContent(html) : '';
      const tookMs = Date.now() - start;

      logger.info(`抓取完成: ${title || '(无标题)'} (${tookMs}ms, ${buffer.length} bytes)`);

      return jsonResult({
        url,
        title,
        content: extractText ? textContent : html,
        textContent,
        statusCode: response.status,
        contentType,
        tookMs,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`抓取失败: ${errorMsg}`);
      return errorResult(errorMsg);
    }
  }
}

/**
 * Web 抓取工具参数
 */
export interface WebFetchParams {
  url: string;
  timeout?: number;
  maxBytes?: number;
  extractText?: boolean;
}
