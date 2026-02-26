/**
 * 沙箱管理器 - Docker容器隔离
 *
 * 核心功能：
 * 1. 容器生命周期管理（创建/启动/停止/销毁）
 * 2. 文件系统隔离（只读系统目录，读写工作目录）
 * 3. 网络隔离（默认无网络，可配置）
 * 4. 资源限制（CPU/内存/PIDs）
 * 5. 超时控制
 *
 * 安全策略：
 * - 禁止特权容器
 * - 禁止挂载敏感目录
 * - 默认无网络访问
 * - 超时自动终止
 */

import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { getLogger } from '../observability/logger';

const logger = getLogger('sandbox');
const execAsync = promisify(exec);

/**
 * 沙箱配置
 */
export interface SandboxConfig {
  /** 是否启用沙箱 */
  enabled: boolean;
  /** Docker镜像 */
  image: string;
  /** 网络模式 */
  networkMode: 'none' | 'bridge' | 'host';
  /** 资源限制 */
  resourceLimits: ResourceLimits;
  /** 默认超时（毫秒） */
  defaultTimeoutMs: number;
  /** 工作目录容器路径 */
  containerWorkdir: string;
  /** 禁止挂载的目录 */
  forbiddenMounts: string[];
}

/**
 * 资源限制
 */
export interface ResourceLimits {
  /** CPU限制（核心数） */
  cpuCores: number;
  /** 内存限制（MB） */
  memoryMb: number;
  /** PIDs限制 */
  pids: number;
  /** 磁盘限制（MB，可选） */
  diskMb?: number;
}

/**
 * 沙箱上下文
 */
export interface SandboxContext {
  /** 容器ID */
  containerId: string;
  /** 容器名称 */
  containerName: string;
  /** 主机工作目录 */
  hostWorkdir: string;
  /** 容器工作目录 */
  containerWorkdir: string;
  /** 是否已启动 */
  started: boolean;
  /** 创建时间 */
  createdAt: Date;
}

/**
 * 执行结果
 */
export interface ExecResult {
  /** 退出码 */
  exitCode: number;
  /** 标准输出 */
  stdout: string;
  /** 标准错误 */
  stderr: string;
  /** 执行时长（毫秒） */
  duration: number;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: SandboxConfig = {
  enabled: true,
  image: 'node:20-slim',
  networkMode: 'none',
  resourceLimits: {
    cpuCores: 2,
    memoryMb: 2048,
    pids: 256,
  },
  defaultTimeoutMs: 60000,
  containerWorkdir: '/workspace',
  forbiddenMounts: [
    '/etc',
    '/root',
    '/var',
    '/home',
    '/usr/local',
    '/opt',
  ],
};

/**
 * 沙箱管理器
 */
export class SandboxManager {
  private config: SandboxConfig;
  private activeContainers: Map<string, SandboxContext> = new Map();

  constructor(config: Partial<SandboxConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info(`[sandbox-init] enabled=${this.config.enabled}`);
  }

  /**
   * 检查Docker是否可用
   */
  async checkDockerAvailable(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('docker --version');
      logger.debug(`[docker-check] ${stdout.trim()}`);
      return true;
    } catch (error) {
      logger.error(`[docker-check] Docker不可用: ${error}`);
      return false;
    }
  }

  /**
   * 创建沙箱容器
   */
  async create(options: {
    /** 主机工作目录 */
    hostWorkdir: string;
    /** 会话ID */
    sessionId: string;
    /** 自定义挂载点 */
    additionalMounts?: Array<{ hostPath: string; containerPath: string; mode: 'ro' | 'rw' }>;
  }): Promise<SandboxContext> {
    const { hostWorkdir, sessionId, additionalMounts = [] } = options;

    // 如果沙箱未启用，返回空上下文
    if (!this.config.enabled) {
      logger.warn('[sandbox-create] 沙箱未启用，返回空上下文');
      return {
        containerId: '',
        containerName: '',
        hostWorkdir,
        containerWorkdir: hostWorkdir,
        started: false,
        createdAt: new Date(),
      };
    }

    // 检查Docker可用性
    const dockerAvailable = await this.checkDockerAvailable();
    if (!dockerAvailable) {
      throw new Error('Docker不可用，无法创建沙箱');
    }

    // 生成容器名称
    const containerName = `baize-${sessionId}-${Date.now().toString(36)}`;
    logger.info(`[sandbox-create] containerName=${containerName}`);

    // 验证工作目录
    if (!fs.existsSync(hostWorkdir)) {
      fs.mkdirSync(hostWorkdir, { recursive: true });
    }

    // 构建挂载参数
    const mountArgs = this.buildMountArgs(hostWorkdir, additionalMounts);

    // 构建资源限制参数
    const resourceArgs = this.buildResourceArgs();

    // 构建网络参数
    const networkArg = `--network=${this.config.networkMode}`;

    // 构建安全参数
    const securityArgs = this.buildSecurityArgs();

    // 构建完整命令
    const createCommand = [
      'docker', 'create',
      `--name=${containerName}`,
      networkArg,
      ...mountArgs,
      ...resourceArgs,
      ...securityArgs,
      `-w=${this.config.containerWorkdir}`,
      this.config.image,
      'tail', '-f', '/dev/null', // 保持容器运行
    ].join(' ');

    try {
      // 创建容器
      const { stdout: containerId } = await execAsync(createCommand);
      const trimmedContainerId = containerId.trim();

      const context: SandboxContext = {
        containerId: trimmedContainerId,
        containerName,
        hostWorkdir,
        containerWorkdir: this.config.containerWorkdir,
        started: false,
        createdAt: new Date(),
      };

      // 记录活跃容器
      this.activeContainers.set(trimmedContainerId, context);

      logger.info(`[sandbox-created] containerId=${trimmedContainerId.slice(0, 12)}`);
      return context;

    } catch (error) {
      logger.error(`[sandbox-create-error] ${error}`);
      throw new Error(`创建沙箱容器失败: ${error}`);
    }
  }

  /**
   * 启动沙箱容器
   */
  async start(context: SandboxContext): Promise<void> {
    if (!this.config.enabled || !context.containerId) {
      return;
    }

    if (context.started) {
      logger.debug(`[sandbox-start] 容器已启动: ${context.containerId.slice(0, 12)}`);
      return;
    }

    try {
      await execAsync(`docker start ${context.containerId}`);
      context.started = true;
      logger.info(`[sandbox-started] containerId=${context.containerId.slice(0, 12)}`);
    } catch (error) {
      logger.error(`[sandbox-start-error] ${error}`);
      throw new Error(`启动沙箱容器失败: ${error}`);
    }
  }

  /**
   * 在沙箱中执行命令
   */
  async exec(
    context: SandboxContext,
    command: string[],
    options?: {
      timeoutMs?: number;
      env?: Record<string, string>;
    }
  ): Promise<ExecResult> {
    const startTime = Date.now();
    const timeout = options?.timeoutMs || this.config.defaultTimeoutMs;

    // 如果沙箱未启用，直接在主机执行
    if (!this.config.enabled || !context.containerId) {
      return this.execOnHost(command, options?.env, timeout);
    }

    // 确保容器已启动
    if (!context.started) {
      await this.start(context);
    }

    logger.debug(`[sandbox-exec] command=${command.join(' ')}`);

    // 构建执行命令
    const envArgs = options?.env
      ? Object.entries(options.env).map(([k, v]) => `-e ${k}=${v}`).join(' ')
      : '';

    const execCommand = [
      'docker', 'exec',
      envArgs,
      context.containerId,
      ...command,
    ].filter(Boolean).join(' ');

    try {
      const { stdout, stderr } = await execAsync(execCommand, {
        timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      const duration = Date.now() - startTime;

      return {
        exitCode: 0,
        stdout,
        stderr,
        duration,
      };

    } catch (error: any) {
      const duration = Date.now() - startTime;

      // 处理超时
      if (error.killed) {
        logger.warn(`[sandbox-exec-timeout] timeout=${timeout}ms`);
        return {
          exitCode: 124, // timeout exit code
          stdout: '',
          stderr: `命令执行超时 (${timeout}ms)`,
          duration,
        };
      }

      // 处理其他错误
      return {
        exitCode: error.code || 1,
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
        duration,
      };
    }
  }

  /**
   * 停止沙箱容器
   */
  async stop(context: SandboxContext): Promise<void> {
    if (!this.config.enabled || !context.containerId) {
      return;
    }

    try {
      await execAsync(`docker stop -t 5 ${context.containerId}`);
      context.started = false;
      logger.info(`[sandbox-stopped] containerId=${context.containerId.slice(0, 12)}`);
    } catch (error) {
      logger.warn(`[sandbox-stop-error] ${error}`);
    }
  }

  /**
   * 销毁沙箱容器
   */
  async destroy(context: SandboxContext): Promise<void> {
    if (!this.config.enabled || !context.containerId) {
      return;
    }

    try {
      // 先停止
      if (context.started) {
        await this.stop(context);
      }

      // 删除容器
      await execAsync(`docker rm -f ${context.containerId}`);

      // 从活跃列表移除
      this.activeContainers.delete(context.containerId);

      logger.info(`[sandbox-destroyed] containerId=${context.containerId.slice(0, 12)}`);

    } catch (error) {
      logger.warn(`[sandbox-destroy-error] ${error}`);
    }
  }

  /**
   * 清理所有活跃容器
   */
  async cleanupAll(): Promise<void> {
    const contexts = Array.from(this.activeContainers.values());
    
    await Promise.all(contexts.map(context => this.destroy(context)));

    logger.info(`[sandbox-cleanup] 清理了 ${contexts.length} 个容器`);
  }

  /**
   * 获取容器状态
   */
  async getStatus(context: SandboxContext): Promise<{
    exists: boolean;
    running: boolean;
    status: string;
  }> {
    if (!this.config.enabled || !context.containerId) {
      return { exists: false, running: false, status: 'disabled' };
    }

    try {
      const { stdout } = await execAsync(
        `docker inspect --format='{{.State.Status}}' ${context.containerId}`
      );
      const status = stdout.trim();
      
      return {
        exists: true,
        running: status === 'running',
        status,
      };
    } catch (error) {
      return { exists: false, running: false, status: 'not_found' };
    }
  }

  /**
   * 构建挂载参数
   */
  private buildMountArgs(
    hostWorkdir: string,
    additionalMounts: Array<{ hostPath: string; containerPath: string; mode: 'ro' | 'rw' }>
  ): string[] {
    const args: string[] = [];

    // 主工作目录挂载
    args.push(`-v=${hostWorkdir}:${this.config.containerWorkdir}:rw`);

    // 验证并添加额外挂载
    for (const mount of additionalMounts) {
      if (this.isMountAllowed(mount.hostPath)) {
        args.push(`-v=${mount.hostPath}:${mount.containerPath}:${mount.mode}`);
      } else {
        logger.warn(`[sandbox-mount] 禁止挂载目录: ${mount.hostPath}`);
      }
    }

    return args;
  }

  /**
   * 构建资源限制参数
   */
  private buildResourceArgs(): string[] {
    const { cpuCores, memoryMb, pids } = this.config.resourceLimits;
    
    return [
      `--cpus=${cpuCores}`,
      `-m=${memoryMb}m`,
      `--pids-limit=${pids}`,
    ];
  }

  /**
   * 构建安全参数
   */
  private buildSecurityArgs(): string[] {
    return [
      '--security-opt=no-new-privileges', // 禁止提权
      '--cap-drop=ALL', // 移除所有能力
      '--read-only', // 根文件系统只读（工作目录除外）
    ];
  }

  /**
   * 检查挂载是否被允许
   */
  private isMountAllowed(hostPath: string): boolean {
    const absolutePath = path.resolve(hostPath);
    
    for (const forbidden of this.config.forbiddenMounts) {
      if (absolutePath.startsWith(forbidden)) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * 在主机上执行命令（沙箱未启用时）
   */
  private async execOnHost(
    command: string[],
    env?: Record<string, string>,
    timeout?: number
  ): Promise<ExecResult> {
    const startTime = Date.now();

    try {
      const { stdout, stderr } = await execAsync(command.join(' '), {
        timeout,
        env: { ...process.env, ...env },
        maxBuffer: 10 * 1024 * 1024,
      });

      return {
        exitCode: 0,
        stdout,
        stderr,
        duration: Date.now() - startTime,
      };

    } catch (error: any) {
      return {
        exitCode: error.code || 1,
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
        duration: Date.now() - startTime,
      };
    }
  }
}

// 全局实例
let sandboxManagerInstance: SandboxManager | null = null;

/**
 * 获取沙箱管理器实例
 */
export function getSandboxManager(): SandboxManager {
  if (!sandboxManagerInstance) {
    sandboxManagerInstance = new SandboxManager();
  }
  return sandboxManagerInstance;
}

/**
 * 重置沙箱管理器实例（测试用）
 */
export function resetSandboxManager(): void {
  if (sandboxManagerInstance) {
    sandboxManagerInstance.cleanupAll();
  }
  sandboxManagerInstance = null;
}
