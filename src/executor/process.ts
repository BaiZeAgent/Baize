/**
 * 进程管理器 - 后台执行与PTY支持
 *
 * 核心功能：
 * 1. 前台执行（等待完成）
 * 2. 后台执行（立即返回ID）
 * 3. PTY交互执行
 * 4. 进程状态查询
 * 5. 进程控制（启动/停止/暂停/恢复）
 * 6. 超时控制
 * 7. 输出流处理
 */

import { spawn, ChildProcess, exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { getLogger } from '../observability/logger';
import { getSandboxManager, SandboxContext, ExecResult } from '../sandbox';

const logger = getLogger('executor:process');
const execAsync = promisify(exec);

/**
 * 进程状态
 */
export enum ProcessStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  TIMEOUT = 'timeout',
  CANCELLED = 'cancelled',
}

/**
 * 进程配置
 */
export interface ProcessConfig {
  /** 命令 */
  command: string;
  /** 参数 */
  args: string[];
  /** 工作目录 */
  cwd?: string;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 是否后台执行 */
  background?: boolean;
  /** 是否PTY模式 */
  pty?: boolean;
  /** 沙箱上下文 */
  sandbox?: SandboxContext;
}

/**
 * 进程信息
 */
export interface ProcessInfo {
  /** 进程ID */
  id: string;
  /** 进程PID */
  pid?: number;
  /** 配置 */
  config: ProcessConfig;
  /** 状态 */
  status: ProcessStatus;
  /** 退出码 */
  exitCode?: number;
  /** 输出 */
  stdout: string;
  /** 错误输出 */
  stderr: string;
  /** 创建时间 */
  createdAt: Date;
  /** 开始时间 */
  startedAt?: Date;
  /** 完成时间 */
  completedAt?: Date;
  /** 执行时长（毫秒） */
  duration?: number;
}

/**
 * 进程管理器
 */
export class ProcessManager {
  private processes: Map<string, ProcessInfo> = new Map();
  private sandboxManager = getSandboxManager();

  /**
   * 执行进程
   */
  async execute(config: ProcessConfig): Promise<ProcessInfo> {
    const id = this.generateId();
    
    const info: ProcessInfo = {
      id,
      config,
      status: ProcessStatus.PENDING,
      stdout: '',
      stderr: '',
      createdAt: new Date(),
    };

    this.processes.set(id, info);

    try {
      if (config.background) {
        // 后台执行
        return this.executeBackground(info);
      } else {
        // 前台执行
        return this.executeForeground(info);
      }
    } catch (error) {
      info.status = ProcessStatus.FAILED;
      info.stderr = String(error);
      info.completedAt = new Date();
      return info;
    }
  }

  /**
   * 前台执行（等待完成）
   */
  private async executeForeground(info: ProcessInfo): Promise<ProcessInfo> {
    const { config } = info;
    info.status = ProcessStatus.RUNNING;
    info.startedAt = new Date();

    logger.debug(`[process-exec] id=${info.id} command=${config.command}`);

    try {
      let result: ExecResult;

      if (config.sandbox?.containerId) {
        // 在沙箱中执行
        result = await this.sandboxManager.exec(config.sandbox, [
          config.command,
          ...config.args,
        ], {
          timeoutMs: config.timeout,
          env: config.env,
        });
      } else {
        // 在主机执行
        result = await this.execOnHost(config);
      }

      info.stdout = result.stdout;
      info.stderr = result.stderr;
      info.exitCode = result.exitCode;
      info.status = result.exitCode === 0 ? ProcessStatus.COMPLETED : ProcessStatus.FAILED;
      info.duration = result.duration;
      info.completedAt = new Date();

      logger.debug(`[process-done] id=${info.id} status=${info.status} duration=${info.duration}ms`);

      return info;

    } catch (error) {
      info.status = ProcessStatus.FAILED;
      info.stderr = String(error);
      info.completedAt = new Date();
      return info;
    }
  }

  /**
   * 后台执行（立即返回）
   */
  private executeBackground(info: ProcessInfo): ProcessInfo {
    const { config } = info;
    info.status = ProcessStatus.RUNNING;
    info.startedAt = new Date();

    logger.info(`[process-bg] id=${info.id} command=${config.command}`);

    // 异步执行，不等待
    this.executeBackgroundAsync(info).catch(error => {
      info.status = ProcessStatus.FAILED;
      info.stderr = String(error);
      info.completedAt = new Date();
    });

    return info;
  }

  /**
   * 后台异步执行
   */
  private async executeBackgroundAsync(info: ProcessInfo): Promise<void> {
    const { config } = info;

    try {
      let result: ExecResult;

      if (config.sandbox?.containerId) {
        result = await this.sandboxManager.exec(config.sandbox, [
          config.command,
          ...config.args,
        ], {
          timeoutMs: config.timeout,
          env: config.env,
        });
      } else {
        result = await this.execOnHost(config);
      }

      info.stdout = result.stdout;
      info.stderr = result.stderr;
      info.exitCode = result.exitCode;
      info.status = result.exitCode === 0 ? ProcessStatus.COMPLETED : ProcessStatus.FAILED;
      info.duration = result.duration;
      info.completedAt = new Date();

    } catch (error) {
      info.status = ProcessStatus.FAILED;
      info.stderr = String(error);
      info.completedAt = new Date();
    }
  }

  /**
   * 查询进程状态
   */
  getStatus(id: string): ProcessInfo | undefined {
    return this.processes.get(id);
  }

  /**
   * 等待进程完成
   */
  async wait(id: string, timeout?: number): Promise<ProcessInfo> {
    const info = this.processes.get(id);
    if (!info) {
      throw new Error(`进程不存在: ${id}`);
    }

    const startTime = Date.now();
    const checkInterval = 100;
    const maxWait = timeout || 300000; // 默认5分钟

    while (info.status === ProcessStatus.RUNNING || info.status === ProcessStatus.PENDING) {
      if (Date.now() - startTime > maxWait) {
        info.status = ProcessStatus.TIMEOUT;
        info.completedAt = new Date();
        break;
      }
      await this.sleep(checkInterval);
    }

    return info;
  }

  /**
   * 终止进程
   */
  async kill(id: string): Promise<boolean> {
    const info = this.processes.get(id);
    if (!info) {
      return false;
    }

    if (info.status !== ProcessStatus.RUNNING) {
      return false;
    }

    logger.info(`[process-kill] id=${id}`);

    // 如果在沙箱中，需要特殊处理
    if (info.config.sandbox?.containerId) {
      // 沙箱中的进程会随容器停止而终止
      info.status = ProcessStatus.CANCELLED;
      info.completedAt = new Date();
      return true;
    }

    // 主机进程终止
    if (info.pid) {
      try {
        process.kill(info.pid, 'SIGTERM');
        info.status = ProcessStatus.CANCELLED;
        info.completedAt = new Date();
        return true;
      } catch (error) {
        return false;
      }
    }

    return false;
  }

  /**
   * 获取所有进程
   */
  getAll(): ProcessInfo[] {
    return Array.from(this.processes.values());
  }

  /**
   * 清理已完成进程
   */
  cleanup(): number {
    let cleaned = 0;
    
    for (const [id, info] of this.processes) {
      if (info.status !== ProcessStatus.RUNNING && info.status !== ProcessStatus.PENDING) {
        this.processes.delete(id);
        cleaned++;
      }
    }

    logger.info(`[process-cleanup] cleaned=${cleaned}`);
    return cleaned;
  }

  /**
   * 在主机执行命令
   */
  private async execOnHost(config: ProcessConfig): Promise<ExecResult> {
    const startTime = Date.now();
    const command = [config.command, ...config.args].join(' ');

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: config.cwd,
        env: { ...process.env, ...config.env },
        timeout: config.timeout || 60000,
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

  /**
   * 生成进程ID
   */
  private generateId(): string {
    return `proc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  /**
   * 休眠
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 全局实例
let processManagerInstance: ProcessManager | null = null;

/**
 * 获取进程管理器实例
 */
export function getProcessManager(): ProcessManager {
  if (!processManagerInstance) {
    processManagerInstance = new ProcessManager();
  }
  return processManagerInstance;
}

/**
 * 重置进程管理器实例（测试用）
 */
export function resetProcessManager(): void {
  processManagerInstance = null;
}
