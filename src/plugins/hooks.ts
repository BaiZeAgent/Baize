/**
 * Hook系统 - 事件钩子
 * 
 * 支持的Hook类型：
 * 1. beforeAgentStart - Agent启动前
 * 2. afterAgentEnd - Agent结束后
 * 3. beforeToolCall - 工具调用前
 * 4. afterToolCall - 工具调用后
 * 5. beforeLLMCall - LLM调用前
 * 6. afterLLMCall - LLM调用后
 * 7. onMessage - 消息处理
 * 8. onError - 错误处理
 */

import { getLogger } from '../observability/logger';

const logger = getLogger('hooks');

/**
 * Hook类型
 */
export enum HookType {
  // Agent生命周期
  BEFORE_AGENT_START = 'beforeAgentStart',
  AFTER_AGENT_END = 'afterAgentEnd',
  
  // 工具调用
  BEFORE_TOOL_CALL = 'beforeToolCall',
  AFTER_TOOL_CALL = 'afterToolCall',
  
  // LLM调用
  BEFORE_LLM_CALL = 'beforeLLMCall',
  AFTER_LLM_CALL = 'afterLLMCall',
  
  // 消息处理
  ON_MESSAGE = 'onMessage',
  ON_MESSAGE_SENT = 'onMessageSent',
  
  // 错误处理
  ON_ERROR = 'onError',
  
  // 会话管理
  ON_SESSION_START = 'onSessionStart',
  ON_SESSION_END = 'onSessionEnd',
  
  // 记忆操作
  ON_MEMORY_STORE = 'onMemoryStore',
  ON_MEMORY_RECALL = 'onMemoryRecall',
}

/**
 * Hook上下文
 */
export interface HookContext {
  /** Hook类型 */
  type: HookType;
  /** 时间戳 */
  timestamp: Date;
  /** 会话ID */
  sessionId?: string;
  /** 用户ID */
  userId?: string;
  /** 自定义数据 */
  data?: Record<string, unknown>;
}

/**
 * Hook结果
 */
export interface HookResult {
  /** 是否继续执行 */
  proceed?: boolean;
  /** 修改后的数据 */
  modifiedData?: Record<string, unknown>;
  /** 错误信息 */
  error?: string;
}

/**
 * Hook处理器
 */
export type HookHandler = (context: HookContext) => Promise<HookResult | void> | HookResult | void;

/**
 * Hook注册信息
 */
interface HookRegistration {
  id: string;
  type: HookType;
  handler: HookHandler;
  priority: number;
  once: boolean;
}

/**
 * 判断是否为HookResult
 */
function isHookResult(value: unknown): value is HookResult {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const obj = value as Record<string, unknown>;
  return 'proceed' in obj || 'modifiedData' in obj || 'error' in obj;
}

/**
 * Hook管理器
 */
export class HookManager {
  private hooks: Map<HookType, HookRegistration[]> = new Map();
  private executedOnce: Set<string> = new Set();

  /**
   * 注册Hook
   */
  register(
    type: HookType,
    handler: HookHandler,
    options: { priority?: number; once?: boolean; id?: string } = {}
  ): string {
    const id = options.id || `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const priority = options.priority ?? 0;
    const once = options.once ?? false;

    const registration: HookRegistration = {
      id,
      type,
      handler,
      priority,
      once,
    };

    if (!this.hooks.has(type)) {
      this.hooks.set(type, []);
    }

    const registrations = this.hooks.get(type)!;
    registrations.push(registration);
    registrations.sort((a, b) => b.priority - a.priority);

    logger.debug(`[hook-register] ${type} - ${id}`);
    return id;
  }

  /**
   * 注销Hook
   */
  unregister(id: string): boolean {
    for (const [type, registrations] of this.hooks) {
      const index = registrations.findIndex((r) => r.id === id);
      if (index !== -1) {
        registrations.splice(index, 1);
        logger.debug(`[hook-unregister] ${type} - ${id}`);
        return true;
      }
    }
    return false;
  }

  /**
   * 触发Hook
   */
  async emit(type: HookType, data?: Record<string, unknown>): Promise<HookContext> {
    const context: HookContext = {
      type,
      timestamp: new Date(),
      data: data || {},
    };

    const registrations = this.hooks.get(type) || [];
    const toRemove: string[] = [];

    for (const registration of registrations) {
      // 检查是否已执行过一次性Hook
      if (registration.once && this.executedOnce.has(registration.id)) {
        continue;
      }

      try {
        const result = await registration.handler(context);

        // 处理结果
        if (isHookResult(result)) {
          // 检查是否需要停止执行
          if (result.proceed === false) {
            logger.debug(`[hook-blocked] ${type} - ${registration.id}`);
            break;
          }
          // 合并修改的数据
          if (result.modifiedData) {
            context.data = { ...context.data, ...result.modifiedData };
          }
        }

        // 标记一次性Hook已执行
        if (registration.once) {
          this.executedOnce.add(registration.id);
          toRemove.push(registration.id);
        }
      } catch (error) {
        logger.error(`[hook-error] ${type} - ${registration.id}: ${error}`);
      }
    }

    // 移除一次性Hook
    for (const id of toRemove) {
      this.unregister(id);
    }

    return context;
  }

  /**
   * 触发同步Hook
   */
  emitSync(type: HookType, data?: Record<string, unknown>): HookContext {
    const context: HookContext = {
      type,
      timestamp: new Date(),
      data: data || {},
    };

    const registrations = this.hooks.get(type) || [];

    for (const registration of registrations) {
      try {
        const result = registration.handler(context);

        if (isHookResult(result)) {
          if (result.proceed === false) {
            break;
          }
          if (result.modifiedData) {
            context.data = { ...context.data, ...result.modifiedData };
          }
        }
      } catch (error) {
        logger.error(`[hook-error] ${type} - ${registration.id}: ${error}`);
      }
    }

    return context;
  }

  /**
   * 获取指定类型的Hook数量
   */
  getHookCount(type: HookType): number {
    return this.hooks.get(type)?.length || 0;
  }

  /**
   * 获取所有Hook数量
   */
  getTotalHookCount(): number {
    let count = 0;
    for (const registrations of this.hooks.values()) {
      count += registrations.length;
    }
    return count;
  }

  /**
   * 清除所有Hook
   */
  clear(): void {
    this.hooks.clear();
    this.executedOnce.clear();
    logger.info('[hook-clear] all hooks cleared');
  }

  /**
   * 清除指定类型的Hook
   */
  clearType(type: HookType): void {
    this.hooks.delete(type);
    logger.debug(`[hook-clear] ${type}`);
  }
}

// 全局实例
let hookManagerInstance: HookManager | null = null;

/**
 * 获取Hook管理器实例
 */
export function getHookManager(): HookManager {
  if (!hookManagerInstance) {
    hookManagerInstance = new HookManager();
  }
  return hookManagerInstance;
}

/**
 * 重置Hook管理器实例（测试用）
 */
export function resetHookManager(): void {
  if (hookManagerInstance) {
    hookManagerInstance.clear();
  }
  hookManagerInstance = null;
}

/**
 * 快捷注册函数
 */
export function onHook(type: HookType, handler: HookHandler, options?: { priority?: number; once?: boolean }): string {
  return getHookManager().register(type, handler, options);
}

/**
 * 快捷触发函数
 */
export async function emitHook(type: HookType, data?: Record<string, unknown>): Promise<HookContext> {
  return getHookManager().emit(type, data);
}
