/**
 * 工具函数模块
 */
import { v4 as uuidv4 } from 'uuid';

/**
 * 生成唯一ID
 */
export function generateId(prefix: string = ''): string {
  const id = uuidv4();
  return prefix ? `${prefix}_${id}` : id;
}

/**
 * 延迟执行
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 重试函数
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    delay?: number;
    backoff?: 'fixed' | 'exponential';
  } = {}
): Promise<T> {
  const { maxRetries = 3, delay: delayMs = 1000, backoff = 'exponential' } = options;
  
  let lastError: Error | null = null;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (i < maxRetries - 1) {
        const waitTime = backoff === 'exponential' 
          ? delayMs * Math.pow(2, i) 
          : delayMs;
        await delay(waitTime);
      }
    }
  }
  
  throw lastError;
}

/**
 * 超时包装
 */
export async function withTimeout<T>(
  fn: Promise<T>,
  timeoutMs: number,
  message: string = '操作超时'
): Promise<T> {
  return Promise.race([
    fn,
    new Promise<T>((_, reject) => 
      setTimeout(() => reject(new Error(message)), timeoutMs)
    ),
  ]);
}

/**
 * 深拷贝
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * 防抖
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delayMs: number
): (...args: Parameters<T>) => void {
  let timer: NodeJS.Timeout | null = null;
  
  return (...args: Parameters<T>) => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => fn(...args), delayMs);
  };
}

/**
 * 节流
 */
export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  limitMs: number
): (...args: Parameters<T>) => void {
  let lastRun = 0;
  
  return (...args: Parameters<T>) => {
    const now = Date.now();
    if (now - lastRun >= limitMs) {
      lastRun = now;
      fn(...args);
    }
  };
}

/**
 * 格式化日期
 */
export function formatDate(date: Date | string, format: string = 'YYYY-MM-DD HH:mm:ss'): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  
  const replacements: Record<string, string> = {
    'YYYY': d.getFullYear().toString(),
    'MM': (d.getMonth() + 1).toString().padStart(2, '0'),
    'DD': d.getDate().toString().padStart(2, '0'),
    'HH': d.getHours().toString().padStart(2, '0'),
    'mm': d.getMinutes().toString().padStart(2, '0'),
    'ss': d.getSeconds().toString().padStart(2, '0'),
  };
  
  let result = format;
  for (const [key, value] of Object.entries(replacements)) {
    result = result.replace(key, value);
  }
  
  return result;
}

/**
 * 解析JSON安全
 */
export function safeJsonParse<T>(str: string, defaultValue: T): T {
  try {
    return JSON.parse(str);
  } catch {
    return defaultValue;
  }
}

/**
 * 截断字符串
 */
export function truncate(str: string, maxLength: number, suffix: string = '...'): string {
  if (str.length <= maxLength) {
    return str;
  }
  return str.substring(0, maxLength - suffix.length) + suffix;
}

/**
 * 计算文本相似度（简单的Jaccard相似度）
 */
export function textSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/));
  const words2 = new Set(text2.toLowerCase().split(/\s+/));
  
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
}
