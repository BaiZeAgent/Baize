/**
 * ProcessSupervisor - 进程管理器
 * 
 * 核心功能：
 * 1. spawn - 启动进程（支持后台运行）
 * 2. poll - 轮询进程输出
 * 3. write - 向 stdin 写入数据
 * 4. send-keys - 发送按键序列
 * 5. paste - 粘贴文本
 * 6. kill - 终止进程
 * 7. list - 列出进程
 * 8. log - 获取日志
 * 
 * 设计参考：OpenClaw ProcessSupervisor
 */

import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import {
  ProcessState,
  ProcessRecord,
  ActiveProcess,
  ProcessResult,
  SPECIAL_KEYS,
  keysToString,
} from './types';
import { getLogger } from '../../observability/logger';

const logger = getLogger('process:supervisor');

/**
 * 进程注册表（持久化记录）
 */
interface ProcessRegistry {
  records: Map<string, ProcessRecord>;
  
  add(record: ProcessRecord): void;
  get(id: string): ProcessRecord | undefined;
  update(id: string, updates: Partial<ProcessRecord>): void;
  delete(id: string): void;
  list(filter?: {
    state?: ProcessState;
    sessionId?: string;
    scopeKey?: string;
  }): ProcessRecord[];
}

function createProcessRegistry(): ProcessRegistry {
  const records = new Map<string, ProcessRecord>();
  
  return {
    records,
    
    add(record: ProcessRecord) {
      records.set(record.id, record);
    },
    
    get(id: string) {
      return records.get(id);
    },
    
    update(id: string, updates: Partial<ProcessRecord>) {
      const record = records.get(id);
      if (record) {
        records.set(id, { ...record, ...updates });
      }
    },
    
    delete(id: string) {
      records.delete(id);
    },
    
    list(filter?: {
      state?: ProcessState;
      sessionId?: string;
      scopeKey?: string;
    }) {
      let result = Array.from(records.values());
      
      if (filter?.state) {
        result = result.filter(r => r.state === filter.state);
      }
      if (filter?.sessionId) {
        result = result.filter(r => r.sessionId === filter.sessionId);
      }
      if (filter?.scopeKey) {
        result = result.filter(r => r.scopeKey === filter.scopeKey);
      }
      
      return result;
    },
  };
}

/**
 * Spawn 输入参数
 */
export interface SpawnInput {
  /** 要执行的命令 */
  command: string;
  /** 命令参数 */
  args?: string[];
  /** 工作目录 */
  cwd?: string;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 超时时间（毫秒） */
  timeoutMs?: number;
  /** 会话ID */
  sessionId?: string;
  /** 作用域键 */
  scopeKey?: string;
  /** stdout 回调 */
  onStdout?: (chunk: string) => void;
  /** stderr 回调 */
  onStderr?: (chunk: string) => void;
  /** 完成回调 */
  onComplete?: (result: ProcessResult) => void;
}

/**
 * 托管进程
 */
export interface ManagedProcess {
  /** 进程ID */
  id: string;
  /** 系统进程ID */
  pid?: number;
  /** stdin 写入流 */
  stdin: NodeJS.WritableStream | null;
  /** 等待完成 */
  wait: () => Promise<ProcessResult>;
  /** 取消进程 */
  cancel: (reason: string) => void;
  /** 获取当前输出 */
  getOutput: () => { stdout: string; stderr: string };
  /** 获取进程状态 */
  getState: () => ProcessState;
}

/**
 * ProcessSupervisor - 进程管理器
 */
export interface ProcessSupervisor {
  /** 启动进程 */
  spawn(input: SpawnInput): Promise<ManagedProcess>;
  /** 轮询进程输出 */
  poll(id: string, timeoutMs?: number): Promise<{
    stdout: string;
    stderr: string;
    stdoutDelta: string;
    stderrDelta: string;
    state: ProcessState;
    exitCode?: number | null;
  }>;
  /** 向 stdin 写入数据 */
  write(id: string, data: string): Promise<{ bytesWritten: number }>;
  /** 发送按键序列 */
  sendKeys(id: string, keys: string[]): Promise<void>;
  /** 粘贴文本 */
  paste(id: string, text: string): Promise<void>;
  /** 终止进程 */
  kill(id: string, signal?: 'SIGTERM' | 'SIGKILL' | 'SIGINT'): Promise<boolean>;
  /** 列出进程 */
  list(filter?: {
    state?: ProcessState;
    sessionId?: string;
    scopeKey?: string;
  }): ProcessRecord[];
  /** 获取进程记录 */
  getRecord(id: string): ProcessRecord | undefined;
  /** 取消作用域内所有进程 */
  cancelScope(scopeKey: string, reason: string): Promise<void>;
}

/**
 * 创建 ProcessSupervisor
 */
export function createProcessSupervisor(): ProcessSupervisor {
  const registry = createProcessRegistry();
  const active = new Map<string, ActiveProcess>();
  const lastOutput = new Map<string, { stdout: string; stderr: string }>();
  
  /**
   * 生成唯一进程ID
   */
  function generateId(): string {
    return `proc_${Date.now()}_${randomUUID().slice(0, 8)}`;
  }
  
  /**
   * 启动进程
   */
  async function spawn(input: SpawnInput): Promise<ManagedProcess> {
    const id = generateId();
    const startTime = Date.now();
    
    logger.info('启动进程', {
      id,
      command: input.command,
      args: input.args,
      cwd: input.cwd,
    });
    
    // 创建进程记录
    const record: ProcessRecord = {
      id,
      sessionId: input.sessionId,
      scopeKey: input.scopeKey,
      state: 'starting',
      startedAtMs: startTime,
      command: input.command,
      args: input.args || [],
      cwd: input.cwd || process.cwd(),
      env: input.env || {},
      timeoutMs: input.timeoutMs,
      isPty: false,
    };
    
    registry.add(record);
    
    // 创建进程
    const child = createChildProcess(
      input.command,
      input.args || [],
      input.cwd,
      input.env
    );
    
    let stdout = '';
    let stderr = '';
    let cancelled = false;
    let cancelReason = '';
    let timeoutTimer: NodeJS.Timeout | null = null;
    
    // 设置超时
    if (input.timeoutMs && input.timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        cancelled = true;
        cancelReason = 'timeout';
        child.kill('SIGKILL');
        registry.update(id, { state: 'timeout', error: '进程超时' });
      }, input.timeoutMs);
    }
    
    // 创建 wait promise
    let waitResolve: (result: ProcessResult) => void;
    const waitPromise = new Promise<ProcessResult>((resolve) => {
      waitResolve = resolve;
    });
    
    // 取消函数
    const cancel = (reason: string) => {
      if (cancelled) return;
      cancelled = true;
      cancelReason = reason;
      child.kill('SIGTERM');
      registry.update(id, { state: 'killed', error: reason });
    };
    
    // 监听 stdout
    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      stdout += text;
      input.onStdout?.(text);
    });
    
    // 监听 stderr
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8');
      stderr += text;
      input.onStderr?.(text);
    });
    
    // 监听错误
    child.on('error', (error: Error) => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      
      registry.update(id, {
        state: 'failed',
        error: error.message,
        endedAtMs: Date.now(),
      });
      
      const result: ProcessResult = {
        id,
        success: false,
        exitCode: null,
        stdout,
        stderr,
        durationMs: Date.now() - startTime,
        error: error.message,
        cancelled,
        cancelReason,
      };
      
      active.delete(id);
      input.onComplete?.(result);
      waitResolve(result);
    });
    
    // 监听关闭
    child.on('close', (exitCode: number | null) => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      
      const finalState = cancelled
        ? (cancelReason === 'timeout' ? 'timeout' : 'killed')
        : (exitCode === 0 ? 'completed' : 'failed');
      
      registry.update(id, {
        state: finalState,
        exitCode,
        endedAtMs: Date.now(),
      });
      
      const result: ProcessResult = {
        id,
        success: exitCode === 0 && !cancelled,
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - startTime,
        error: finalState === 'failed' ? `进程退出码: ${exitCode}` : undefined,
        cancelled,
        cancelReason,
      };
      
      active.delete(id);
      input.onComplete?.(result);
      waitResolve(result);
    });
    
    // 更新状态为运行中
    registry.update(id, { state: 'running' });
    
    // 存储活动进程
    const activeProcess: ActiveProcess = {
      record,
      child,
      stdin: child.stdin,
      stdout,
      stderr,
      cancel,
      wait: () => waitPromise,
    };
    
    active.set(id, activeProcess);
    lastOutput.set(id, { stdout: '', stderr: '' });
    
    return {
      id,
      pid: child.pid,
      stdin: child.stdin,
      wait: () => waitPromise,
      cancel,
      getOutput: () => ({ stdout, stderr }),
      getState: () => registry.get(id)?.state || 'failed',
    };
  }
  
  /**
   * 轮询进程输出
   */
  async function poll(
    id: string,
    timeoutMs: number = 5000
  ): Promise<{
    stdout: string;
    stderr: string;
    stdoutDelta: string;
    stderrDelta: string;
    state: ProcessState;
    exitCode?: number | null;
  }> {
    const process = active.get(id);
    const record = registry.get(id);
    
    if (!record) {
      throw new Error(`进程不存在: ${id}`);
    }
    
    // 如果进程已结束，返回完整输出
    if (!process) {
      return {
        stdout: record.error || '',
        stderr: '',
        stdoutDelta: '',
        stderrDelta: '',
        state: record.state,
        exitCode: record.exitCode,
      };
    }
    
    const currentOutput = process.stdout;
    const currentError = process.stderr;
    const last = lastOutput.get(id) || { stdout: '', stderr: '' };
    
    const stdoutDelta = currentOutput.slice(last.stdout.length);
    const stderrDelta = currentError.slice(last.stderr.length);
    
    lastOutput.set(id, { stdout: currentOutput, stderr: currentError });
    
    return {
      stdout: currentOutput,
      stderr: currentError,
      stdoutDelta,
      stderrDelta,
      state: record.state,
      exitCode: record.exitCode,
    };
  }
  
  /**
   * 向 stdin 写入数据
   */
  async function write(id: string, data: string): Promise<{ bytesWritten: number }> {
    const process = active.get(id);
    
    if (!process) {
      throw new Error(`进程不存在或已结束: ${id}`);
    }
    
    if (!process.stdin) {
      throw new Error(`进程没有 stdin: ${id}`);
    }
    
    return new Promise((resolve, reject) => {
      process.stdin!.write(data, 'utf-8', (error?: Error | null) => {
        if (error) {
          reject(error);
        } else {
          resolve({ bytesWritten: Buffer.byteLength(data, 'utf-8') });
        }
      });
    });
  }
  
  /**
   * 发送按键序列
   */
  async function sendKeys(id: string, keys: string[]): Promise<void> {
    const process = active.get(id);
    
    if (!process) {
      throw new Error(`进程不存在或已结束: ${id}`);
    }
    
    if (!process.stdin) {
      throw new Error(`进程没有 stdin: ${id}`);
    }
    
    const keyString = keysToString(keys);
    
    return new Promise((resolve, reject) => {
      process.stdin!.write(keyString, 'utf-8', (error?: Error | null) => {
        if (error) {
          reject(error);
        } else {
          logger.debug('发送按键', { id, keys });
          resolve();
        }
      });
    });
  }
  
  /**
   * 粘贴文本
   */
  async function paste(id: string, text: string): Promise<void> {
    const process = active.get(id);
    
    if (!process) {
      throw new Error(`进程不存在或已结束: ${id}`);
    }
    
    if (!process.stdin) {
      throw new Error(`进程没有 stdin: ${id}`);
    }
    
    // Bracketed paste mode: \x1b[200~ + text + \x1b[201~
    const bracketedPaste = `\x1b[200~${text}\x1b[201~`;
    
    return new Promise((resolve, reject) => {
      process.stdin!.write(bracketedPaste, 'utf-8', (error?: Error | null) => {
        if (error) {
          reject(error);
        } else {
          logger.debug('粘贴文本', { id, length: text.length });
          resolve();
        }
      });
    });
  }
  
  /**
   * 终止进程
   */
  async function kill(
    id: string,
    signal: 'SIGTERM' | 'SIGKILL' | 'SIGINT' = 'SIGTERM'
  ): Promise<boolean> {
    const process = active.get(id);
    const record = registry.get(id);
    
    if (!record) {
      throw new Error(`进程不存在: ${id}`);
    }
    
    if (!process) {
      // 进程已结束
      return false;
    }
    
    const previousState = record.state;
    
    logger.info('终止进程', { id, signal, previousState });
    
    process.child.kill(signal);
    
    // 等待进程结束
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        // 强制杀死
        try {
          process.child.kill('SIGKILL');
        } catch {
          // ignore
        }
        resolve();
      }, 5000);
      
      process.child.on('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    
    registry.update(id, { state: 'killed' });
    active.delete(id);
    
    return true;
  }
  
  /**
   * 列出进程
   */
  function list(filter?: {
    state?: ProcessState;
    sessionId?: string;
    scopeKey?: string;
  }): ProcessRecord[] {
    return registry.list(filter);
  }
  
  /**
   * 获取进程记录
   */
  function getRecord(id: string): ProcessRecord | undefined {
    return registry.get(id);
  }
  
  /**
   * 取消作用域内所有进程
   */
  async function cancelScope(scopeKey: string, reason: string): Promise<void> {
    const processes = registry.list({ scopeKey });
    
    logger.info('取消作用域进程', { scopeKey, count: processes.length, reason });
    
    await Promise.all(
      processes.map(async (record) => {
        const process = active.get(record.id);
        if (process) {
          process.cancel(reason);
        }
      })
    );
  }
  
  return {
    spawn,
    poll,
    write,
    sendKeys,
    paste,
    kill,
    list,
    getRecord,
    cancelScope,
  };
}

/**
 * 创建子进程
 */
function createChildProcess(
  command: string,
  args: string[],
  cwd?: string,
  env?: Record<string, string>
): ChildProcess {
  return spawn(command, args, {
    cwd: cwd || process.cwd(),
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  });
}

// ═══════════════════════════════════════════════════════════════
// 全局实例
// ═══════════════════════════════════════════════════════════════

let supervisorInstance: ProcessSupervisor | null = null;

export function getProcessSupervisor(): ProcessSupervisor {
  if (!supervisorInstance) {
    supervisorInstance = createProcessSupervisor();
  }
  return supervisorInstance;
}

export function resetProcessSupervisor(): void {
  supervisorInstance = null;
}
