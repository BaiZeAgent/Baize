/**
 * 交互层 - 统一交互接口
 * 
 * 支持：
 * 1. CLI交互
 * 2. HTTP API
 * 3. WebSocket
 */

import { getLogger } from '../observability/logger';
import { APIServer, createAPIServer } from './api';

const logger = getLogger('interaction');

/**
 * 交互类型
 */
export type InteractionType = 'cli' | 'api' | 'webhook' | 'websocket';

/**
 * 交互消息
 */
export interface InteractionMessage {
  type: 'text' | 'command' | 'event';
  content: string;
  metadata?: Record<string, unknown>;
}

/**
 * 交互响应
 */
export interface InteractionResponse {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
  requiresInput: boolean;
  prompt?: string;
}

/**
 * 交互处理器接口
 */
export interface InteractionHandler {
  type: InteractionType;
  initialize(): Promise<void>;
  handleMessage(message: InteractionMessage): Promise<InteractionResponse>;
  sendResponse(response: InteractionResponse): Promise<void>;
  shutdown(): Promise<void>;
}

/**
 * 交互管理器
 */
export class InteractionManager {
  private handlers: Map<InteractionType, InteractionHandler> = new Map();
  private defaultHandler: InteractionType = 'cli';
  private apiServer: APIServer | null = null;

  /**
   * 注册处理器
   */
  registerHandler(handler: InteractionHandler): void {
    this.handlers.set(handler.type, handler);
    logger.info(`注册交互处理器: ${handler.type}`);
  }

  /**
   * 获取处理器
   */
  getHandler(type?: InteractionType): InteractionHandler | undefined {
    return this.handlers.get(type || this.defaultHandler);
  }

  /**
   * 初始化所有处理器
   */
  async initializeAll(): Promise<void> {
    for (const [type, handler] of this.handlers) {
      try {
        await handler.initialize();
        logger.info(`交互处理器初始化完成: ${type}`);
      } catch (error) {
        logger.error(`交互处理器初始化失败: ${type}`, { error });
      }
    }
  }

  /**
   * 启动HTTP API服务器
   */
  async startAPI(port: number = 3000): Promise<void> {
    if (!this.apiServer) {
      this.apiServer = createAPIServer({ port });
      await this.apiServer.start();
    }
  }

  /**
   * 停止HTTP API服务器
   */
  async stopAPI(): Promise<void> {
    if (this.apiServer) {
      this.apiServer.stop();
      this.apiServer = null;
    }
  }

  /**
   * 处理消息
   */
  async processMessage(
    message: InteractionMessage,
    handlerType?: InteractionType
  ): Promise<InteractionResponse> {
    const handler = this.getHandler(handlerType);
    
    if (!handler) {
      return {
        success: false,
        message: '没有可用的交互处理器',
        requiresInput: false,
      };
    }

    try {
      return await handler.handleMessage(message);
    } catch (error) {
      logger.error(`处理消息失败`, { error });
      return {
        success: false,
        message: `处理失败: ${error}`,
        requiresInput: false,
      };
    }
  }

  /**
   * 发送响应
   */
  async sendResponse(
    response: InteractionResponse,
    handlerType?: InteractionType
  ): Promise<void> {
    const handler = this.getHandler(handlerType);
    
    if (handler) {
      await handler.sendResponse(response);
    }
  }

  /**
   * 关闭所有处理器
   */
  async shutdownAll(): Promise<void> {
    await this.stopAPI();
    
    for (const [type, handler] of this.handlers) {
      try {
        await handler.shutdown();
        logger.info(`交互处理器已关闭: ${type}`);
      } catch (error) {
        logger.error(`关闭交互处理器失败: ${type}`, { error });
      }
    }
  }
}

// 全局实例
let interactionManager: InteractionManager | null = null;

export function getInteractionManager(): InteractionManager {
  if (!interactionManager) {
    interactionManager = new InteractionManager();
  }
  return interactionManager;
}

// 导出API相关
export { APIServer, createAPIServer } from './api';
