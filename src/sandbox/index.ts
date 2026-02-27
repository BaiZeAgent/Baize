/**
 * 沙箱系统 - Docker 容器隔离执行
 */

import { getLogger } from '../observability/logger';
import { randomBytes } from 'crypto';

const logger = getLogger('sandbox');

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

export interface SandboxConfig {
  image: string;
  memoryLimit: number;
  cpuQuota: number;
  pidsLimit: number;
  timeout: number;
  networkDisabled: boolean;
  allowedHosts?: string[];
  mounts: MountConfig[];
  env?: Record<string, string>;
  workdir?: string;
}

export interface MountConfig {
  host: string;
  container: string;
  mode: 'ro' | 'rw';
}

export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  image: 'baize/sandbox:latest',
  memoryLimit: 512 * 1024 * 1024,
  cpuQuota: 50000,
  pidsLimit: 100,
  timeout: 30000,
  networkDisabled: true,
  mounts: [],
};

export interface ExecOptions {
  command: string;
  timeout?: number;
  env?: Record<string, string>;
  cwd?: string;
  stdin?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  duration: number;
  timedOut: boolean;
  oomKilled: boolean;
}

export interface SandboxInstance {
  id: string;
  config: SandboxConfig;
  createdAt: number;
  status: 'running' | 'stopped' | 'error';
  exec: (options: ExecOptions) => Promise<ExecResult>;
  destroy: () => Promise<void>;
}

export interface ContainerStats {
  cpuPercent: number;
  memoryUsage: number;
  memoryLimit: number;
  networkRx: number;
  networkTx: number;
  pids: number;
}

// ═══════════════════════════════════════════════════════════════
// 沙箱管理器
// ═══════════════════════════════════════════════════════════════

export class SandboxManager {
  private instances: Map<string, SandboxInstance> = new Map();
  private dockerAvailable: boolean | null = null;
  
  async checkDockerAvailable(): Promise<boolean> {
    if (this.dockerAvailable !== null) return this.dockerAvailable;
    try {
      const result = await this.execHostCommand('docker --version');
      this.dockerAvailable = result.exitCode === 0;
      logger.info(`Docker 可用: ${this.dockerAvailable}`);
    } catch {
      this.dockerAvailable = false;
      logger.warn('Docker 不可用，将使用降级模式');
    }
    return this.dockerAvailable;
  }
  
  async create(config: Partial<SandboxConfig> = {}): Promise<SandboxInstance> {
    const fullConfig: SandboxConfig = { ...DEFAULT_SANDBOX_CONFIG, ...config };
    const id = this.generateId();
    const dockerAvailable = await this.checkDockerAvailable();
    
    if (dockerAvailable) {
      return this.createDockerSandbox(id, fullConfig);
    } else {
      return this.createFallbackSandbox(id, fullConfig);
    }
  }
  
  private async createDockerSandbox(id: string, config: SandboxConfig): Promise<SandboxInstance> {
    logger.info(`创建 Docker 沙箱: ${id}`);
    
    const mountArgs = config.mounts.map(m => `-v ${m.host}:${m.container}:${m.mode}`).join(' ');
    const envArgs = config.env ? Object.entries(config.env).map(([k, v]) => `-e ${k}=${v}`).join(' ') : '';
    
    const createCmd = [
      'docker run -d',
      `--name ${id}`,
      `--memory ${config.memoryLimit}`,
      `--cpu-quota ${config.cpuQuota}`,
      `--pids-limit ${config.pidsLimit}`,
      config.networkDisabled ? '--network none' : '',
      mountArgs,
      envArgs,
      config.workdir ? `-w ${config.workdir}` : '',
      '--security-opt no-new-privileges',
      config.image,
      'sleep infinity',
    ].filter(Boolean).join(' ');
    
    const createResult = await this.execHostCommand(createCmd);
    if (createResult.exitCode !== 0) {
      throw new Error(`创建容器失败: ${createResult.stderr}`);
    }
    
    const instance: SandboxInstance = {
      id,
      config,
      createdAt: Date.now(),
      status: 'running',
      exec: async (options: ExecOptions) => this.execInContainer(id, options, config),
      destroy: async () => this.destroyContainer(id),
    };
    
    this.instances.set(id, instance);
    return instance;
  }
  
  private async createFallbackSandbox(id: string, config: SandboxConfig): Promise<SandboxInstance> {
    logger.warn(`使用降级沙箱模式: ${id}`);
    
    const instance: SandboxInstance = {
      id,
      config,
      createdAt: Date.now(),
      status: 'running',
      exec: async (options: ExecOptions) => {
        const result = await this.execHostCommand(options.command, {
          timeout: options.timeout || config.timeout,
          env: options.env,
          cwd: options.cwd,
        });
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          duration: result.duration,
          timedOut: false,
          oomKilled: false,
        };
      },
      destroy: async () => { this.instances.delete(id); },
    };
    
    this.instances.set(id, instance);
    return instance;
  }
  
  private async execInContainer(
    containerId: string,
    options: ExecOptions,
    config: SandboxConfig
  ): Promise<ExecResult> {
    const startTime = Date.now();
    const timeout = options.timeout || config.timeout;
    
    const execCmd = [
      'docker exec',
      options.cwd ? `-w ${options.cwd}` : '',
      containerId,
      'bash -c',
      `'${options.command.replace(/'/g, "'\\''")}'`,
    ].filter(Boolean).join(' ');
    
    try {
      const result = await this.execHostCommand(execCmd, { timeout });
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        duration: Date.now() - startTime,
        timedOut: false,
        oomKilled: false,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('timeout')) {
        return { stdout: '', stderr: 'Timeout', exitCode: 124, duration: timeout, timedOut: true, oomKilled: false };
      }
      throw error;
    }
  }
  
  private async destroyContainer(containerId: string): Promise<void> {
    logger.info(`销毁容器: ${containerId}`);
    try {
      await this.execHostCommand(`docker stop ${containerId} 2>/dev/null || true`);
      await this.execHostCommand(`docker rm ${containerId} 2>/dev/null || true`);
    } catch (error) {
      logger.error(`销毁容器失败: ${error}`);
    }
    this.instances.delete(containerId);
  }
  
  private execHostCommand(
    command: string,
    options?: { timeout?: number; env?: Record<string, string>; cwd?: string }
  ): Promise<{ stdout: string; stderr: string; exitCode: number; duration: number }> {
    return new Promise((resolve, reject) => {
      const { spawn } = require('child_process');
      const timeout = options?.timeout || 30000;
      const startTime = Date.now();
      let timedOut = false;
      
      const proc = spawn('bash', ['-c', command], {
        cwd: options?.cwd,
        env: { ...process.env, ...options?.env },
      });
      
      let stdout = '';
      let stderr = '';
      
      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
      
      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGKILL');
      }, timeout);
      
      proc.on('close', (code: number) => {
        clearTimeout(timer);
        if (timedOut) {
          reject(new Error('timeout'));
        } else {
          resolve({ stdout, stderr, exitCode: code, duration: Date.now() - startTime });
        }
      });
      
      proc.on('error', (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }
  
  private generateId(): string {
    return `baize-sandbox-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
  }
  
  getInstances(): SandboxInstance[] {
    return Array.from(this.instances.values());
  }
  
  getInstance(id: string): SandboxInstance | undefined {
    return this.instances.get(id);
  }
  
  async destroyAll(): Promise<void> {
    for (const instance of this.instances.values()) {
      await instance.destroy().catch(() => {});
    }
    this.instances.clear();
  }
}

// ═══════════════════════════════════════════════════════════════
// 资源限制器
// ═══════════════════════════════════════════════════════════════

export interface ResourceLimits {
  maxMemory: number;
  maxCpu: number;
  maxPids: number;
  maxFileSize: number;
  maxOpenFiles: number;
  maxExecutionTime: number;
}

export const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  maxMemory: 512 * 1024 * 1024,
  maxCpu: 50,
  maxPids: 100,
  maxFileSize: 100 * 1024 * 1024,
  maxOpenFiles: 100,
  maxExecutionTime: 60000,
};

export class ResourceLimiter {
  constructor(private limits: ResourceLimits = DEFAULT_RESOURCE_LIMITS) {}
  
  checkUsage(stats: ContainerStats): { ok: boolean; violations: string[] } {
    const violations: string[] = [];
    if (stats.memoryUsage > this.limits.maxMemory) {
      violations.push(`内存超过限制`);
    }
    if (stats.cpuPercent > this.limits.maxCpu) {
      violations.push(`CPU 超过限制`);
    }
    if (stats.pids > this.limits.maxPids) {
      violations.push(`进程数超过限制`);
    }
    return { ok: violations.length === 0, violations };
  }
  
  getLimits(): ResourceLimits { return { ...this.limits }; }
  updateLimits(limits: Partial<ResourceLimits>): void {
    this.limits = { ...this.limits, ...limits };
  }
}

// ═══════════════════════════════════════════════════════════════
// 网络策略
// ═══════════════════════════════════════════════════════════════

export interface NetworkPolicy {
  enabled: boolean;
  allowOutbound: boolean;
  allowInbound: boolean;
  allowedHosts: string[];
  blockedHosts: string[];
}

export const DEFAULT_NETWORK_POLICY: NetworkPolicy = {
  enabled: true,
  allowOutbound: false,
  allowInbound: false,
  allowedHosts: [],
  blockedHosts: [],
};

export class NetworkPolicyManager {
  constructor(private policy: NetworkPolicy = DEFAULT_NETWORK_POLICY) {}
  
  isHostAllowed(host: string): boolean {
    if (!this.policy.enabled) return true;
    if (this.policy.blockedHosts.some(h => this.matchHost(host, h))) return false;
    if (this.policy.allowedHosts.length === 0) return this.policy.allowOutbound;
    return this.policy.allowedHosts.some(h => this.matchHost(host, h));
  }
  
  private matchHost(host: string, pattern: string): boolean {
    if (pattern === '*') return true;
    if (pattern.startsWith('*.')) return host.endsWith(pattern.slice(1));
    return host === pattern;
  }
  
  getPolicy(): NetworkPolicy { return { ...this.policy }; }
  updatePolicy(policy: Partial<NetworkPolicy>): void {
    this.policy = { ...this.policy, ...policy };
  }
}

// ═══════════════════════════════════════════════════════════════
// 全局实例
// ═══════════════════════════════════════════════════════════════

let globalSandboxManager: SandboxManager | null = null;
let globalResourceLimiter: ResourceLimiter | null = null;
let globalNetworkPolicyManager: NetworkPolicyManager | null = null;

export function getSandboxManager(): SandboxManager {
  if (!globalSandboxManager) globalSandboxManager = new SandboxManager();
  return globalSandboxManager;
}

export function getResourceLimiter(): ResourceLimiter {
  if (!globalResourceLimiter) globalResourceLimiter = new ResourceLimiter();
  return globalResourceLimiter;
}

export function getNetworkPolicyManager(): NetworkPolicyManager {
  if (!globalNetworkPolicyManager) globalNetworkPolicyManager = new NetworkPolicyManager();
  return globalNetworkPolicyManager;
}

export function resetSandbox(): void {
  if (globalSandboxManager) globalSandboxManager.destroyAll().catch(() => {});
  globalSandboxManager = null;
  globalResourceLimiter = null;
  globalNetworkPolicyManager = null;
}

export async function execInSandbox(
  command: string,
  options?: {
    timeout?: number;
    env?: Record<string, string>;
    cwd?: string;
    mounts?: MountConfig[];
    networkDisabled?: boolean;
  }
): Promise<ExecResult> {
  const manager = getSandboxManager();
  const sandbox = await manager.create({
    mounts: options?.mounts || [],
    networkDisabled: options?.networkDisabled ?? true,
    timeout: options?.timeout,
  });
  
  try {
    return await sandbox.exec({ command, ...options });
  } finally {
    await sandbox.destroy();
  }
}
