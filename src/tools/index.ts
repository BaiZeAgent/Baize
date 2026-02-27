/**
 * 内置工具注册表
 */

import { BaseTool, ToolDefinition, ToolResult, ToolContext } from './base';
import { WebSearchTool } from './web-search';
import { WebFetchTool } from './web-fetch';
import { MemorySearchTool, MemoryGetTool, MemorySetTool } from './memory';
import { ImageGenerateTool, ImageDescribeTool } from './image';
import { SubAgentTool, TaskDecomposeTool } from './subagent';
import { getLogger } from '../observability/logger';

const logger = getLogger('tools:registry');

/**
 * 工具注册表
 */
class ToolRegistry {
  private tools: Map<string, BaseTool<any, any>> = new Map();

  /**
   * 注册工具
   */
  register(tool: BaseTool<any, any>): void {
    this.tools.set(tool.name, tool);
    logger.debug(`注册工具: ${tool.name}`);
  }

  /**
   * 获取工具
   */
  get(name: string): BaseTool<any, any> | undefined {
    return this.tools.get(name);
  }

  /**
   * 获取所有工具
   */
  getAll(): BaseTool<any, any>[] {
    return Array.from(this.tools.values());
  }

  /**
   * 获取工具列表（用于 LLM）
   */
  getToolList(): Array<{
    name: string;
    label: string;
    description: string;
    parameters: any;
  }> {
    return this.getAll().map(tool => ({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  /**
   * 执行工具
   */
  async execute(name: string, params: Record<string, unknown>, context?: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        error: `工具不存在: ${name}`,
        duration: 0,
      };
    }

    return tool.safeExecute(params, context);
  }

  /**
   * 检查工具是否存在
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * 获取工具数量
   */
  get size(): number {
    return this.tools.size;
  }
}

// 全局注册表
let registry: ToolRegistry | null = null;

/**
 * 获取工具注册表
 */
export function getToolRegistry(): ToolRegistry {
  if (!registry) {
    registry = new ToolRegistry();
    registerBuiltinTools(registry);
  }
  return registry;
}

/**
 * 注册内置工具
 */
function registerBuiltinTools(registry: ToolRegistry): void {
  // Web 工具
  registry.register(new WebSearchTool());
  registry.register(new WebFetchTool());

  // 记忆工具
  registry.register(new MemorySearchTool());
  registry.register(new MemoryGetTool());
  registry.register(new MemorySetTool());

  // 图像工具
  registry.register(new ImageGenerateTool());
  registry.register(new ImageDescribeTool());

  // 子代理工具
  registry.register(new SubAgentTool());
  registry.register(new TaskDecomposeTool());

  logger.info(`内置工具注册完成，共 ${registry.size} 个工具`);
}

/**
 * 重置工具注册表
 */
export function resetToolRegistry(): void {
  registry = null;
}

// 导出工具类
export {
  BaseTool,
  WebSearchTool,
  WebFetchTool,
  MemorySearchTool,
  MemoryGetTool,
  MemorySetTool,
  ImageGenerateTool,
  ImageDescribeTool,
  SubAgentTool,
  TaskDecomposeTool,
};

// 导出类型
export type { ToolResult, ToolContext, ToolDefinition };
