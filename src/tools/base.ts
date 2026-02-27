/**
 * 内置工具基类
 * 
 * OpenClaw 风格的工具定义
 */

import { getLogger } from '../observability/logger';

const logger = getLogger('tools');

/**
 * 工具执行结果
 */
export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  duration: number;
}

/**
 * 工具定义
 */
export interface ToolDefinition<TParams = unknown, TResult = unknown> {
  name: string;
  label: string;
  description: string;
  parameters: any;
  execute: (params: TParams, context?: ToolContext) => Promise<ToolResult<TResult>>;
}

/**
 * 工具执行上下文
 */
export interface ToolContext {
  sessionId?: string;
  userId?: string;
  conversationId?: string;
}

/**
 * 工具基类
 */
export abstract class BaseTool<TParams, TResult> implements ToolDefinition<TParams, TResult> {
  abstract name: string;
  abstract label: string;
  abstract description: string;
  abstract parameters: any;
  
  abstract execute(params: TParams, context?: ToolContext): Promise<ToolResult<TResult>>;

  /**
   * 安全执行，捕获异常
   */
  async safeExecute(params: TParams, context?: ToolContext): Promise<ToolResult<TResult>> {
    const start = Date.now();
    try {
      const result = await this.execute(params, context);
      result.duration = Date.now() - start;
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`工具 ${this.name} 执行失败: ${errorMsg}`);
      return {
        success: false,
        error: errorMsg,
        duration,
      };
    }
  }
}

/**
 * 读取字符串参数
 */
export function readStringParam(
  params: Record<string, unknown>,
  key: string,
  options: { required?: boolean; label?: string } = {}
): string | undefined {
  const { required = false, label = key } = options;
  const value = params[key];
  
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  
  if (required) {
    throw new Error(`${label} 是必需的`);
  }
  
  return undefined;
}

/**
 * 读取数字参数
 */
export function readNumberParam(
  params: Record<string, unknown>,
  key: string,
  options: { required?: boolean; label?: string; integer?: boolean; min?: number; max?: number } = {}
): number | undefined {
  const { required = false, label = key, integer = false, min, max } = options;
  const value = params[key];
  
  let num: number | undefined;
  
  if (typeof value === 'number' && Number.isFinite(value)) {
    num = value;
  } else if (typeof value === 'string') {
    const parsed = parseFloat(value);
    if (Number.isFinite(parsed)) {
      num = parsed;
    }
  }
  
  if (num === undefined) {
    if (required) {
      throw new Error(`${label} 是必需的`);
    }
    return undefined;
  }
  
  if (integer) {
    num = Math.trunc(num);
  }
  
  if (min !== undefined && num < min) {
    num = min;
  }
  if (max !== undefined && num > max) {
    num = max;
  }
  
  return num;
}

/**
 * 读取布尔参数
 */
export function readBooleanParam(
  params: Record<string, unknown>,
  key: string,
  defaultValue?: boolean
): boolean | undefined {
  const value = params[key];
  
  if (typeof value === 'boolean') {
    return value;
  }
  
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower === 'true' || lower === '1' || lower === 'yes') {
      return true;
    }
    if (lower === 'false' || lower === '0' || lower === 'no') {
      return false;
    }
  }
  
  return defaultValue;
}

/**
 * 读取数组参数
 */
export function readArrayParam(
  params: Record<string, unknown>,
  key: string,
  options: { required?: boolean; label?: string } = {}
): string[] | undefined {
  const { required = false, label = key } = options;
  const value = params[key];
  
  if (Array.isArray(value)) {
    const strings = value
      .filter(v => typeof v === 'string')
      .map(v => (v as string).trim())
      .filter(Boolean);
    
    if (strings.length > 0) {
      return strings;
    }
  }
  
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) {
      return [trimmed];
    }
  }
  
  if (required) {
    throw new Error(`${label} 是必需的`);
  }
  
  return undefined;
}

/**
 * JSON 结果
 */
export function jsonResult<T>(data: T): ToolResult<T> {
  return {
    success: true,
    data,
    duration: 0,
  } as ToolResult<T>;
}

/**
 * 错误结果
 */
export function errorResult<T = unknown>(error: string): ToolResult<T> {
  return {
    success: false,
    error,
    duration: 0,
  } as ToolResult<T>;
}
