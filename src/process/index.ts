/**
 * 进程管理系统 - PTY 终端与进程生命周期
 * 
 * 提供企业级进程管理：
 * 1. PTY 终端支持
 * 2. 后台进程管理
 * 3. 进程信号处理
 * 4. 超时控制
 */

import { getLogger } from '../observability/logger';
import { randomBytes } from 'crypto';
import { EventEmitter } from 'events';

const logger = getLogger('process');

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

/**
 * 进程状态
 */
export type ProcessStatus = 'running' | 'completed' | 'failed' | 'killed' | 'timeout';

/**
 * 进程信息
 */
export interface ProcessInfo {
  id: string;
  pid?: number;
  command: string;
  cwd: string;
  env: Record<string, string>;
  status: ProcessStatus;
  exitCode?: number;
  startTime: number;
  endTime?: number;
  duration?: number;
  stdout: string;
  stderr: string;
  isBackground: boolean;
  pty?: boolean;
}

/**
 * 进程选项
 */
export interface ProcessOptions {
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  background?: boolean;
  pty?: boolean;
  shell?: string;
  uid?: number;
  gid?: number;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
}

/**
 * 进程结果
 */
export interface ProcessResult {
  id: string;
  status: ProcessStatus;
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  timedOut: boolean;
  killed: boolean;
}

/**
 * PTY 选项
 */
export interface PtyOptions {
  cols: number;
  rows: number;
  cwd?: string;
  env?: Record<string, string>;
}

// ═══════════════════════════════════════════════════════════════
// 进程注册表
// ═══════════════════════════════════════════════════════════════

/**
 * 进程注册表
 * 
 * 管理所有运行的进程
 */
export class ProcessRegistry extends EventEmitter {
  private processes: Map<string, ProcessInfo> = new Map();
  private ptyProcesses: Map<string, any> = new Map();
  private maxProcesses = 100;
  
  /**
   * 生成进程 ID
   */
  generateId(): string {
    return `proc-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
  }
  
  /**
   * 注册进程
   */
  register(info: Omit<ProcessInfo, 'id' | 'startTime' | 'status' | 'stdout' | 'stderr'>): string {
    const id = this.generateId();
    
    const processInfo: ProcessInfo = {
      ...info,
      id,
      startTime: Date.now(),
      status: 'running',
      stdout: '',
      stderr: '',
    };
    
    this.processes.set(id, processInfo);
    this.emit('registered', processInfo);
    
    logger.debug(`进程注册: ${id} - ${info.command}`);
    
    // 检查进程数量限制
    if (this.processes.size > this.maxProcesses) {
      this.cleanup();
    }
    
    return id;
  }
  
  /**
   * 更新进程状态
   */
  update(id: string, updates: Partial<ProcessInfo>): void {
    const info = this.processes.get(id);
    if (!info) return;
    
    Object.assign(info, updates);
    this.processes.set(id, info);
    
    if (updates.status && updates.status !== 'running') {
      this.emit('completed', info);
    }
  }
  
  /**
   * 获取进程信息
   */
  get(id: string): ProcessInfo | undefined {
    return this.processes.get(id);
  }
  
  /**
   * 获取所有进程
   */
  getAll(): ProcessInfo[] {
    return Array.from(this.processes.values());
  }
  
  /**
   * 获取运行中的进程
   */
  getRunning(): ProcessInfo[] {
    return this.getAll().filter(p => p.status === 'running');
  }
  
  /**
   * 获取后台进程
   */
  getBackground(): ProcessInfo[] {
    return this.getAll().filter(p => p.isBackground && p.status === 'running');
  }
  
  /**
   * 清理已完成的进程
   */
  cleanup(): number {
    let cleaned = 0;
    
    for (const [id, info] of this.processes) {
      if (info.status !== 'running') {
        this.processes.delete(id);
        cleaned++;
      }
    }
    
    logger.debug(`清理进程: ${cleaned} 个`);
    return cleaned;
  }
  
  /**
   * 注册 PTY 进程
   */
  registerPty(id: string, ptyProcess: any): void {
    this.ptyProcesses.set(id, ptyProcess);
  }
  
  /**
   * 获取 PTY 进程
   */
  getPty(id: string): any {
    return this.ptyProcesses.get(id);
  }
  
  /**
   * 移除 PTY 进程
   */
  removePty(id: string): void {
    this.ptyProcesses.delete(id);
  }
}

// ═══════════════════════════════════════════════════════════════
// 进程管理器
// ═══════════════════════════════════════════════════════════════

/**
 * 进程管理器
 * 
 * 执行和管理进程
 */
export class ProcessManager {
  private registry: ProcessRegistry;
  private ptyAvailable: boolean | null = null;
  
  constructor() {
    this.registry = new ProcessRegistry();
  }
  
  /**
   * 检查 PTY 是否可用
   */
  async checkPtyAvailable(): Promise<boolean> {
    if (this.ptyAvailable !== null) {
      return this.ptyAvailable;
    }
    
    try {
      require('node-pty');
      this.ptyAvailable = true;
    } catch {
      this.ptyAvailable = false;
      logger.warn('node-pty 不可用，PTY 功能将被禁用');
    }
    
    return this.ptyAvailable;
  }
  
  /**
   * 执行命令
   */
  async exec(options: ProcessOptions): Promise<ProcessResult> {
    const {
      command,
      cwd = process.cwd(),
      env = {},
      timeout = 30000,
      background = false,
      pty = false,
      shell = '/bin/bash',
      onStdout,
      onStderr,
    } = options;
    
    // 注册进程
    const id = this.registry.register({
      command,
      cwd,
      env,
      isBackground: background,
      pty,
    });
    
    const startTime = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killed = false;
    let exitCode = 0;
    
    try {
      // 选择执行方式
      if (pty && await this.checkPtyAvailable()) {
        const result = await this.execPty(id, options);
        stdout = result.stdout;
        stderr = result.stderr;
        exitCode = result.exitCode;
      } else {
        const result = await this.execSpawn(options);
        stdout = result.stdout;
        stderr = result.stderr;
        exitCode = result.exitCode;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      
      if (message.includes('timeout') || message.includes('timed out')) {
        timedOut = true;
        exitCode = 124;
      } else if (message.includes('killed')) {
        killed = true;
        exitCode = 137;
      } else {
        stderr = message;
        exitCode = 1;
      }
    }
    
    const duration = Date.now() - startTime;
    const status: ProcessStatus = 
      timedOut ? 'timeout' :
      killed ? 'killed' :
      exitCode === 0 ? 'completed' : 'failed';
    
    // 更新进程状态
    this.registry.update(id, {
      status,
      exitCode,
      endTime: Date.now(),
      duration,
      stdout,
      stderr,
    });
    
    return {
      id,
      status,
      exitCode,
      stdout,
      stderr,
      duration,
      timedOut,
      killed,
    };
  }
  
  /**
   * 使用 spawn 执行
   */
  private execSpawn(options: ProcessOptions): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const { spawn } = require('child_process');
      
      const { command, cwd, env, timeout, shell, onStdout, onStderr } = options;
      
      const proc = spawn(shell || '/bin/bash', ['-c', command], {
        cwd,
        env: { ...process.env, ...env },
      });
      
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      
      proc.stdout.on('data', (data: Buffer) => {
        const str = data.toString();
        stdout += str;
        onStdout?.(str);
      });
      
      proc.stderr.on('data', (data: Buffer) => {
        const str = data.toString();
        stderr += str;
        onStderr?.(str);
      });
      
      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGKILL');
      }, timeout || 30000);
      
      proc.on('close', (code: number) => {
        clearTimeout(timer);
        
        if (timedOut) {
          reject(new Error('timeout'));
        } else {
          resolve({ stdout, stderr, exitCode: code });
        }
      });
      
      proc.on('error', (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }
  
  /**
   * 使用 PTY 执行
   */
  private async execPty(
    id: string,
    options: ProcessOptions
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const pty = require('node-pty');
    
    const { command, cwd, env, timeout, onStdout, onStderr } = options;
    
    return new Promise((resolve, reject) => {
      const ptyProcess = pty.spawn('/bin/bash', ['-c', command], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd,
        env: { ...process.env, ...env },
      });
      
      this.registry.registerPty(id, ptyProcess);
      
      let stdout = '';
      let timedOut = false;
      
      ptyProcess.onData((data: string) => {
        stdout += data;
        onStdout?.(data);
      });
      
      const timer = setTimeout(() => {
        timedOut = true;
        ptyProcess.kill();
      }, timeout || 30000);
      
      ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
        clearTimeout(timer);
        this.registry.removePty(id);
        
        if (timedOut) {
          reject(new Error('timeout'));
        } else {
          resolve({ stdout, stderr: '', exitCode });
        }
      });
    });
  }
  
  /**
   * 发送信号到 PTY 进程
   */
  sendToPty(id: string, data: string): boolean {
    const ptyProcess = this.registry.getPty(id);
    if (!ptyProcess) return false;
    
    ptyProcess.write(data);
    return true;
  }
  
  /**
   * 调整 PTY 大小
   */
  resizePty(id: string, cols: number, rows: number): boolean {
    const ptyProcess = this.registry.getPty(id);
    if (!ptyProcess) return false;
    
    ptyProcess.resize(cols, rows);
    return true;
  }
  
  /**
   * 终止进程
   */
  async kill(id: string, signal: string = 'SIGTERM'): Promise<boolean> {
    const info = this.registry.get(id);
    if (!info || info.status !== 'running') {
      return false;
    }
    
    // 尝试终止 PTY
    const ptyProcess = this.registry.getPty(id);
    if (ptyProcess) {
      ptyProcess.kill(signal);
      this.registry.removePty(id);
    }
    
    // 更新状态
    this.registry.update(id, {
      status: 'killed',
      endTime: Date.now(),
    });
    
    logger.info(`进程已终止: ${id}`);
    return true;
  }
  
  /**
   * 终止所有进程
   */
  async killAll(signal: string = 'SIGTERM'): Promise<number> {
    const running = this.registry.getRunning();
    let killed = 0;
    
    for (const info of running) {
      if (await this.kill(info.id, signal)) {
        killed++;
      }
    }
    
    logger.info(`已终止 ${killed} 个进程`);
    return killed;
  }
  
  /**
   * 获取注册表
   */
  getRegistry(): ProcessRegistry {
    return this.registry;
  }
}

// ═══════════════════════════════════════════════════════════════
// 超时管理器
// ═══════════════════════════════════════════════════════════════

/**
 * 超时配置
 */
export interface TimeoutConfig {
  default: number;
  max: number;
  warningThreshold: number;
}

/**
 * 默认超时配置
 */
export const DEFAULT_TIMEOUT_CONFIG: TimeoutConfig = {
  default: 30000,
  max: 300000,
  warningThreshold: 0.8,
};

/**
 * 超时管理器
 */
export class TimeoutManager {
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private config: TimeoutConfig;
  
  constructor(config: TimeoutConfig = DEFAULT_TIMEOUT_CONFIG) {
    this.config = config;
  }
  
  /**
   * 设置超时
   */
  set(id: string, callback: () => void, ms?: number): void {
    // 清除现有定时器
    this.clear(id);
    
    const timeout = Math.min(ms || this.config.default, this.config.max);
    
    const timer = setTimeout(() => {
      this.timers.delete(id);
      callback();
    }, timeout);
    
    this.timers.set(id, timer);
  }
  
  /**
   * 清除超时
   */
  clear(id: string): boolean {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
      return true;
    }
    return false;
  }
  
  /**
   * 清除所有超时
   */
  clearAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
  
  /**
   * 获取剩余时间
   */
  getRemaining(id: string): number | null {
    // 无法精确获取剩余时间，返回 null
    return this.timers.has(id) ? null : null;
  }
}

// ═══════════════════════════════════════════════════════════════
// 全局实例
// ═══════════════════════════════════════════════════════════════

let globalProcessManager: ProcessManager | null = null;
let globalTimeoutManager: TimeoutManager | null = null;

export function getProcessManager(): ProcessManager {
  if (!globalProcessManager) {
    globalProcessManager = new ProcessManager();
  }
  return globalProcessManager;
}

export function getTimeoutManager(): TimeoutManager {
  if (!globalTimeoutManager) {
    globalTimeoutManager = new TimeoutManager();
  }
  return globalTimeoutManager;
}

export function resetProcess(): void {
  if (globalProcessManager) {
    globalProcessManager.killAll().catch(() => {});
  }
  globalProcessManager = null;
  globalTimeoutManager?.clearAll();
  globalTimeoutManager = null;
}

// ═══════════════════════════════════════════════════════════════
// 便捷函数
// ═══════════════════════════════════════════════════════════════

/**
 * 执行命令
 */
export async function exec(
  command: string,
  options?: Omit<ProcessOptions, 'command'>
): Promise<ProcessResult> {
  return getProcessManager().exec({ command, ...options });
}

/**
 * 执行命令并返回输出
 */
export async function execOutput(command: string, timeout?: number): Promise<string> {
  const result = await exec(command, { timeout });
  if (result.exitCode !== 0) {
    throw new Error(`Command failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

/**
 * 后台执行
 */
export async function execBackground(command: string, options?: Omit<ProcessOptions, 'command' | 'background'>): Promise<string> {
  const result = await exec(command, { ...options, background: true });
  return result.id;
}
