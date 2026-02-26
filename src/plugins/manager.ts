/**
 * 插件系统 - 核心模块
 * 
 * 功能：
 * 1. 插件发现和加载
 * 2. 插件生命周期管理
 * 3. 插件依赖管理
 * 4. 插件配置管理
 */

import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../observability/logger';

const logger = getLogger('plugins');

/**
 * 插件状态
 */
export enum PluginStatus {
  UNLOADED = 'unloaded',
  LOADING = 'loading',
  LOADED = 'loaded',
  ENABLED = 'enabled',
  DISABLED = 'disabled',
  ERROR = 'error',
}

/**
 * 插件清单
 */
export interface PluginManifest {
  /** 插件ID */
  id: string;
  /** 插件名称 */
  name: string;
  /** 插件版本 */
  version: string;
  /** 插件描述 */
  description?: string;
  /** 作者 */
  author?: string;
  /** 主入口文件 */
  main: string;
  /** 依赖 */
  dependencies?: Record<string, string>;
  /** 白泽版本要求 */
  baizeVersion?: string;
  /** 配置schema */
  configSchema?: Record<string, unknown>;
  /** 默认配置 */
  defaultConfig?: Record<string, unknown>;
  /** 权限要求 */
  permissions?: string[];
  /** Hook注册 */
  hooks?: string[];
}

/**
 * 插件实例
 */
export interface PluginInstance {
  /** 清单 */
  manifest: PluginManifest;
  /** 状态 */
  status: PluginStatus;
  /** 配置 */
  config: Record<string, unknown>;
  /** 加载时间 */
  loadedAt?: Date;
  /** 错误信息 */
  error?: string;
  /** 模块实例 */
  module?: Plugin;
}

/**
 * 插件接口
 */
export interface Plugin {
  /** 插件ID */
  id?: string;
  /** 初始化 */
  init?(context: PluginContext): Promise<void>;
  /** 启用 */
  enable?(): Promise<void>;
  /** 禁用 */
  disable?(): Promise<void>;
  /** 销毁 */
  destroy?(): Promise<void>;
}

/**
 * 插件上下文
 */
export interface PluginContext {
  /** 插件配置 */
  config: Record<string, unknown>;
  /** 日志器 */
  logger: ReturnType<typeof getLogger>;
  /** 注册Hook */
  registerHook: (event: string, handler: Function) => void;
  /** 注册工具 */
  registerTool: (name: string, handler: Function) => void;
  /** 获取服务 */
  getService: <T>(name: string) => T | undefined;
}

/**
 * 插件管理器
 */
export class PluginManager {
  private plugins: Map<string, PluginInstance> = new Map();
  private pluginDirs: string[] = [];
  private hooks: Map<string, Set<Function>> = new Map();
  private tools: Map<string, Function> = new Map();
  private services: Map<string, unknown> = new Map();

  constructor() {
    // 默认插件目录
    this.pluginDirs = [
      path.join(process.cwd(), 'plugins'),
      path.join(process.env.HOME || '', '.baize', 'plugins'),
    ];
  }

  /**
   * 添加插件目录
   */
  addPluginDir(dir: string): void {
    if (!this.pluginDirs.includes(dir)) {
      this.pluginDirs.push(dir);
      logger.info(`[plugin-dir] added: ${dir}`);
    }
  }

  /**
   * 发现插件
   */
  async discover(): Promise<PluginManifest[]> {
    const manifests: PluginManifest[] = [];

    for (const dir of this.pluginDirs) {
      if (!fs.existsSync(dir)) {
        continue;
      }

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const pluginPath = path.join(dir, entry.name);
        const manifestPath = path.join(pluginPath, 'plugin.json');

        if (fs.existsSync(manifestPath)) {
          try {
            const content = fs.readFileSync(manifestPath, 'utf-8');
            const manifest = JSON.parse(content) as PluginManifest;
            manifest.id = manifest.id || entry.name;
            manifests.push(manifest);
            logger.debug(`[plugin-discover] ${manifest.id}@${manifest.version}`);
          } catch (error) {
            logger.warn(`[plugin-discover] invalid manifest: ${manifestPath}`);
          }
        }
      }
    }

    return manifests;
  }

  /**
   * 加载插件
   */
  async load(pluginId: string, pluginPath?: string): Promise<boolean> {
    // 查找插件路径
    let resolvedPath = pluginPath;
    if (!resolvedPath) {
      for (const dir of this.pluginDirs) {
        const candidate = path.join(dir, pluginId);
        if (fs.existsSync(candidate)) {
          resolvedPath = candidate;
          break;
        }
      }
    }

    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
      logger.error(`[plugin-load] not found: ${pluginId}`);
      return false;
    }

    // 读取清单
    const manifestPath = path.join(resolvedPath, 'plugin.json');
    if (!fs.existsSync(manifestPath)) {
      logger.error(`[plugin-load] manifest not found: ${pluginId}`);
      return false;
    }

    let manifest: PluginManifest;
    try {
      const content = fs.readFileSync(manifestPath, 'utf-8');
      manifest = JSON.parse(content);
      manifest.id = manifest.id || pluginId;
    } catch (error) {
      logger.error(`[plugin-load] invalid manifest: ${pluginId}`);
      return false;
    }

    // 创建插件实例
    const instance: PluginInstance = {
      manifest,
      status: PluginStatus.LOADING,
      config: manifest.defaultConfig || {},
    };

    this.plugins.set(pluginId, instance);

    try {
      // 加载模块
      const mainPath = path.join(resolvedPath, manifest.main);
      if (fs.existsSync(mainPath)) {
        // 使用动态导入
        const module = await import(mainPath);
        const pluginModule = (module.default || module) as Plugin;
        instance.module = pluginModule;

        // 初始化
        if (pluginModule && typeof pluginModule.init === 'function') {
          const context = this.createContext(pluginId, instance.config);
          await pluginModule.init(context);
        }
      }

      instance.status = PluginStatus.LOADED;
      instance.loadedAt = new Date();
      logger.info(`[plugin-load] ${pluginId}@${manifest.version}`);
      return true;
    } catch (error) {
      instance.status = PluginStatus.ERROR;
      instance.error = String(error);
      logger.error(`[plugin-load] error: ${pluginId} - ${error}`);
      return false;
    }
  }

  /**
   * 启用插件
   */
  async enable(pluginId: string): Promise<boolean> {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      logger.error(`[plugin-enable] not found: ${pluginId}`);
      return false;
    }

    if (instance.status !== PluginStatus.LOADED && instance.status !== PluginStatus.DISABLED) {
      logger.warn(`[plugin-enable] invalid status: ${pluginId} - ${instance.status}`);
      return false;
    }

    try {
      const module = instance.module;
      if (module && typeof module.enable === 'function') {
        await module.enable();
      }

      instance.status = PluginStatus.ENABLED;
      logger.info(`[plugin-enable] ${pluginId}`);
      return true;
    } catch (error) {
      instance.status = PluginStatus.ERROR;
      instance.error = String(error);
      logger.error(`[plugin-enable] error: ${pluginId} - ${error}`);
      return false;
    }
  }

  /**
   * 禁用插件
   */
  async disable(pluginId: string): Promise<boolean> {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      logger.error(`[plugin-disable] not found: ${pluginId}`);
      return false;
    }

    if (instance.status !== PluginStatus.ENABLED) {
      logger.warn(`[plugin-disable] invalid status: ${pluginId} - ${instance.status}`);
      return false;
    }

    try {
      const module = instance.module;
      if (module && typeof module.disable === 'function') {
        await module.disable();
      }

      instance.status = PluginStatus.DISABLED;
      logger.info(`[plugin-disable] ${pluginId}`);
      return true;
    } catch (error) {
      instance.status = PluginStatus.ERROR;
      instance.error = String(error);
      logger.error(`[plugin-disable] error: ${pluginId} - ${error}`);
      return false;
    }
  }

  /**
   * 卸载插件
   */
  async unload(pluginId: string): Promise<boolean> {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      return false;
    }

    try {
      // 先禁用
      if (instance.status === PluginStatus.ENABLED) {
        await this.disable(pluginId);
      }

      // 销毁
      const module = instance.module;
      if (module && typeof module.destroy === 'function') {
        await module.destroy();
      }

      this.plugins.delete(pluginId);
      logger.info(`[plugin-unload] ${pluginId}`);
      return true;
    } catch (error) {
      logger.error(`[plugin-unload] error: ${pluginId} - ${error}`);
      return false;
    }
  }

  /**
   * 获取插件
   */
  getPlugin(pluginId: string): PluginInstance | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * 获取所有插件
   */
  getAllPlugins(): PluginInstance[] {
    return Array.from(this.plugins.values());
  }

  /**
   * 获取已启用的插件
   */
  getEnabledPlugins(): PluginInstance[] {
    return Array.from(this.plugins.values()).filter(
      (p) => p.status === PluginStatus.ENABLED
    );
  }

  /**
   * 注册Hook
   */
  registerHook(event: string, handler: Function): void {
    if (!this.hooks.has(event)) {
      this.hooks.set(event, new Set());
    }
    this.hooks.get(event)!.add(handler);
    logger.debug(`[hook-register] ${event}`);
  }

  /**
   * 触发Hook
   */
  async emitHook(event: string, ...args: unknown[]): Promise<unknown[]> {
    const handlers = this.hooks.get(event);
    if (!handlers || handlers.size === 0) {
      return [];
    }

    const results: unknown[] = [];
    for (const handler of handlers) {
      try {
        const result = await handler(...args);
        results.push(result);
      } catch (error) {
        logger.error(`[hook-error] ${event} - ${error}`);
      }
    }

    return results;
  }

  /**
   * 注册工具
   */
  registerTool(name: string, handler: Function): void {
    this.tools.set(name, handler);
    logger.debug(`[tool-register] ${name}`);
  }

  /**
   * 获取工具
   */
  getTool(name: string): Function | undefined {
    return this.tools.get(name);
  }

  /**
   * 注册服务
   */
  registerService(name: string, service: unknown): void {
    this.services.set(name, service);
    logger.debug(`[service-register] ${name}`);
  }

  /**
   * 获取服务
   */
  getService<T>(name: string): T | undefined {
    return this.services.get(name) as T | undefined;
  }

  /**
   * 创建插件上下文
   */
  private createContext(pluginId: string, config: Record<string, unknown>): PluginContext {
    return {
      config,
      logger: getLogger(`plugin:${pluginId}`),
      registerHook: (event: string, handler: Function) => {
        this.registerHook(`${pluginId}:${event}`, handler);
      },
      registerTool: (name: string, handler: Function) => {
        this.registerTool(`${pluginId}.${name}`, handler);
      },
      getService: <T>(name: string) => this.getService<T>(name),
    };
  }
}

// 全局实例
let pluginManagerInstance: PluginManager | null = null;

/**
 * 获取插件管理器实例
 */
export function getPluginManager(): PluginManager {
  if (!pluginManagerInstance) {
    pluginManagerInstance = new PluginManager();
  }
  return pluginManagerInstance;
}

/**
 * 重置插件管理器实例（测试用）
 */
export function resetPluginManager(): void {
  if (pluginManagerInstance) {
    pluginManagerInstance.getAllPlugins().forEach((p) => {
      pluginManagerInstance!.unload(p.manifest.id);
    });
  }
  pluginManagerInstance = null;
}
