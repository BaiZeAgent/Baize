/**
 * 进程管理器 - 后台执行与PTY支持
 */

import { spawn, ChildProcess, exec } from 'child_process';
import { promisify } from 'util';
import { getLogger } from '../observability/logger';
import { getSandboxManager, ExecResult, SandboxInstance } from '../sandbox';

const logger = getLogger('executor:process');
const execAsync = promisify(exec);

export enum ProcessStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  TIMEOUT = 'timeout',
  CANCELLED = 'cancelled',
}

export interface ProcessConfig {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  background?: boolean;
  pty?: boolean;
  sandbox?: { containerId?: string; instance?: SandboxInstance };
}

export interface ProcessInfo {
  id: string;
  pid?: number;
  config: ProcessConfig;
  status: ProcessStatus;
  exitCode?: number;
  stdout: string;
  stderr: string;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  duration?: number;
}

export class ProcessManager {
  private processes: Map<string, ProcessInfo> = new Map();
  private sandboxManager = getSandboxManager();

  async execute(config: ProcessConfig): Promise<ProcessInfo> {
    const id = this.generateId();
    const info: ProcessInfo = {
      id, config, status: ProcessStatus.PENDING,
      stdout: '', stderr: '', createdAt: new Date(),
    };
    this.processes.set(id, info);
    
    try {
      return config.background ? this.executeBackground(info) : this.executeForeground(info);
    } catch (error) {
      info.status = ProcessStatus.FAILED;
      info.stderr = String(error);
      info.completedAt = new Date();
      return info;
    }
  }

  private async executeForeground(info: ProcessInfo): Promise<ProcessInfo> {
    const { config } = info;
    info.status = ProcessStatus.RUNNING;
    info.startedAt = new Date();
    logger.debug(`[process-exec] id=${info.id} command=${config.command}`);

    try {
      let result: ExecResult;
      
      if (config.sandbox?.instance) {
        result = await config.sandbox.instance.exec({
          command: [config.command, ...config.args].join(' '),
          timeout: config.timeout,
          env: config.env,
          cwd: config.cwd,
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
      return info;
    } catch (error) {
      info.status = ProcessStatus.FAILED;
      info.stderr = String(error);
      info.completedAt = new Date();
      return info;
    }
  }

  private executeBackground(info: ProcessInfo): ProcessInfo {
    info.status = ProcessStatus.RUNNING;
    info.startedAt = new Date();
    logger.info(`[process-bg] id=${info.id}`);
    
    this.executeBackgroundAsync(info).catch(error => {
      info.status = ProcessStatus.FAILED;
      info.stderr = String(error);
      info.completedAt = new Date();
    });
    return info;
  }

  private async executeBackgroundAsync(info: ProcessInfo): Promise<void> {
    const { config } = info;
    try {
      let result: ExecResult;
      
      if (config.sandbox?.instance) {
        result = await config.sandbox.instance.exec({
          command: [config.command, ...config.args].join(' '),
          timeout: config.timeout,
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

  getStatus(id: string): ProcessInfo | undefined { return this.processes.get(id); }

  async wait(id: string, timeout?: number): Promise<ProcessInfo> {
    const info = this.processes.get(id);
    if (!info) throw new Error(`进程不存在: ${id}`);
    
    const startTime = Date.now();
    const maxWait = timeout || 300000;
    
    while (info.status === ProcessStatus.RUNNING || info.status === ProcessStatus.PENDING) {
      if (Date.now() - startTime > maxWait) {
        info.status = ProcessStatus.TIMEOUT;
        info.completedAt = new Date();
        break;
      }
      await this.sleep(100);
    }
    return info;
  }

  async kill(id: string): Promise<boolean> {
    const info = this.processes.get(id);
    if (!info || info.status !== ProcessStatus.RUNNING) return false;
    
    logger.info(`[process-kill] id=${id}`);
    info.status = ProcessStatus.CANCELLED;
    info.completedAt = new Date();
    return true;
  }

  getAll(): ProcessInfo[] { return Array.from(this.processes.values()); }

  cleanup(): number {
    let cleaned = 0;
    for (const [id, info] of this.processes) {
      if (info.status !== ProcessStatus.RUNNING && info.status !== ProcessStatus.PENDING) {
        this.processes.delete(id);
        cleaned++;
      }
    }
    return cleaned;
  }

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

      return { exitCode: 0, stdout, stderr, duration: Date.now() - startTime, timedOut: false, oomKilled: false };
    } catch (error: any) {
      return {
        exitCode: error.code || 1,
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
        duration: Date.now() - startTime,
        timedOut: false,
        oomKilled: false,
      };
    }
  }

  private generateId(): string {
    return `proc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

let processManagerInstance: ProcessManager | null = null;

export function getProcessManager(): ProcessManager {
  if (!processManagerInstance) processManagerInstance = new ProcessManager();
  return processManagerInstance;
}

export function resetProcessManager(): void { processManagerInstance = null; }
