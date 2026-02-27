/**
 * 自动环境管理系统
 * 
 * 核心功能：
 * 1. 检测系统依赖
 * 2. 自动安装缺失的依赖
 * 3. 支持多种包管理器 (npm, pip, apt, brew)
 * 4. 与能力缺口检测集成
 */

import { getLogger } from '../observability/logger';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execAsync = promisify(exec);
const logger = getLogger('environment');

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

/**
 * 包管理器类型
 */
export type PackageManager = 'npm' | 'pip' | 'pip3' | 'apt' | 'brew' | 'choco' | 'yarn' | 'pnpm';

/**
 * 依赖类型
 */
export type DependencyType = 'system' | 'npm' | 'python' | 'node' | 'tool';

/**
 * 依赖信息
 */
export interface Dependency {
  name: string;
  type: DependencyType;
  packageManager: PackageManager;
  packageName?: string;        // 实际包名（如果与 name 不同）
  version?: string;
  required?: boolean;
  description?: string;
  checkCommand?: string;       // 检查是否安装的命令
  installCommand?: string;     // 自定义安装命令
}

/**
 * 依赖检查结果
 */
export interface DependencyCheckResult {
  name: string;
  installed: boolean;
  version?: string;
  path?: string;
}

/**
 * 安装结果
 */
export interface InstallResult {
  success: boolean;
  name: string;
  output?: string;
  error?: string;
  duration: number;
}

/**
 * 环境状态
 */
export interface EnvironmentStatus {
  healthy: boolean;
  missingDependencies: Dependency[];
  installedDependencies: DependencyCheckResult[];
  platform: string;
  packageManagers: PackageManager[];
}

// ═══════════════════════════════════════════════════════════════
// 常用依赖定义
// ═══════════════════════════════════════════════════════════════

/**
 * 常用系统工具依赖
 */
export const COMMON_DEPENDENCIES: Dependency[] = [
  // 系统工具
  { name: 'git', type: 'system', packageManager: 'apt', description: '版本控制' },
  { name: 'curl', type: 'system', packageManager: 'apt', description: 'HTTP 客户端' },
  { name: 'wget', type: 'system', packageManager: 'apt', description: '下载工具' },
  { name: 'jq', type: 'system', packageManager: 'apt', description: 'JSON 处理' },
  { name: 'ripgrep', type: 'system', packageManager: 'apt', packageName: 'ripgrep', description: '快速搜索' },
  { name: 'fd', type: 'system', packageManager: 'apt', packageName: 'fd-find', description: '文件查找' },
  
  // Node.js 工具
  { name: 'node', type: 'node', packageManager: 'npm', description: 'Node.js 运行时' },
  { name: 'npm', type: 'node', packageManager: 'npm', description: 'Node 包管理器' },
  { name: 'typescript', type: 'npm', packageManager: 'npm', description: 'TypeScript 编译器' },
  { name: 'ts-node', type: 'npm', packageManager: 'npm', description: 'TypeScript 执行器' },
  
  // Python 工具
  { name: 'python', type: 'python', packageManager: 'pip', description: 'Python 运行时' },
  { name: 'pip', type: 'python', packageManager: 'pip', description: 'Python 包管理器' },
  { name: 'virtualenv', type: 'python', packageManager: 'pip', description: 'Python 虚拟环境' },
];

// ═══════════════════════════════════════════════════════════════
// 包管理器检测
// ═══════════════════════════════════════════════════════════════

/**
 * 包管理器检测器
 */
export class PackageManagerDetector {
  private available: Map<PackageManager, boolean> = new Map();
  
  /**
   * 检测可用的包管理器
   */
  async detect(): Promise<PackageManager[]> {
    const managers: PackageManager[] = ['npm', 'pip', 'pip3', 'apt', 'brew', 'yarn', 'pnpm'];
    const available: PackageManager[] = [];
    
    for (const manager of managers) {
      const isAvailable = await this.checkManager(manager);
      this.available.set(manager, isAvailable);
      if (isAvailable) {
        available.push(manager);
      }
    }
    
    logger.info(`检测到包管理器: ${available.join(', ')}`);
    return available;
  }
  
  /**
   * 检查单个包管理器
   */
  private async checkManager(manager: PackageManager): Promise<boolean> {
    try {
      const cmd = process.platform === 'win32' ? 'where' : 'which';
      await execAsync(`${cmd} ${manager}`);
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * 获取可用的包管理器
   */
  getAvailable(): PackageManager[] {
    return Array.from(this.available.entries())
      .filter(([_, available]) => available)
      .map(([manager]) => manager);
  }
  
  /**
   * 检查特定包管理器是否可用
   */
  isAvailable(manager: PackageManager): boolean {
    return this.available.get(manager) || false;
  }
}

// ═══════════════════════════════════════════════════════════════
// 依赖检查器
// ═══════════════════════════════════════════════════════════════

/**
 * 依赖检查器
 */
export class DependencyChecker {
  /**
   * 检查单个依赖
   */
  async check(dep: Dependency): Promise<DependencyCheckResult> {
    const checkCmd = dep.checkCommand || this.getCheckCommand(dep);
    
    try {
      const { stdout } = await execAsync(checkCmd, { timeout: 5000 });
      
      // 解析版本
      const version = this.parseVersion(stdout, dep);
      
      return {
        name: dep.name,
        installed: true,
        version,
        path: stdout.trim().split('\n')[0],
      };
    } catch {
      return {
        name: dep.name,
        installed: false,
      };
    }
  }
  
  /**
   * 批量检查依赖
   */
  async checkAll(deps: Dependency[]): Promise<DependencyCheckResult[]> {
    const results: DependencyCheckResult[] = [];
    
    for (const dep of deps) {
      const result = await this.check(dep);
      results.push(result);
    }
    
    return results;
  }
  
  /**
   * 获取检查命令
   */
  private getCheckCommand(dep: Dependency): string {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    
    switch (dep.type) {
      case 'npm':
        return `npm list -g ${dep.name} 2>/dev/null || ${cmd} ${dep.name}`;
      case 'python':
        return `python3 -c "import ${dep.name}" 2>/dev/null || pip show ${dep.name}`;
      case 'system':
      case 'tool':
      default:
        return `${cmd} ${dep.name}`;
    }
  }
  
  /**
   * 解析版本号
   */
  private parseVersion(output: string, dep: Dependency): string | undefined {
    // 尝试匹配版本号
    const patterns = [
      /(\d+\.\d+\.\d+)/,
      /(\d+\.\d+)/,
      /version\s*:?\s*(\d+\.\d+\.\d+)/i,
      /v(\d+\.\d+\.\d+)/,
    ];
    
    for (const pattern of patterns) {
      const match = output.match(pattern);
      if (match) {
        return match[1];
      }
    }
    
    return undefined;
  }
}

// ═══════════════════════════════════════════════════════════════
// 依赖安装器
// ═══════════════════════════════════════════════════════════════

/**
 * 安装选项
 */
export interface InstallOptions {
  timeout?: number;
  silent?: boolean;
  force?: boolean;
  global?: boolean;
}

/**
 * 依赖安装器
 */
export class DependencyInstaller {
  private managerDetector = new PackageManagerDetector();
  
  /**
   * 安装依赖
   */
  async install(dep: Dependency, options: InstallOptions = {}): Promise<InstallResult> {
    const startTime = Date.now();
    const { timeout = 120000, silent = false } = options;
    
    logger.info(`安装依赖: ${dep.name}`);
    
    try {
      // 获取安装命令
      const installCmd = dep.installCommand || this.getInstallCommand(dep, options);
      
      if (!installCmd) {
        return {
          success: false,
          name: dep.name,
          error: '无法确定安装命令',
          duration: Date.now() - startTime,
        };
      }
      
      // 执行安装
      const { stdout, stderr } = await execAsync(installCmd, {
        timeout,
        maxBuffer: 10 * 1024 * 1024,
      });
      
      const success = !stderr.toLowerCase().includes('error');
      
      if (!silent) {
        logger.info(`安装完成: ${dep.name}`);
      }
      
      return {
        success,
        name: dep.name,
        output: stdout || stderr,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`安装失败: ${dep.name} - ${errorMsg}`);
      
      return {
        success: false,
        name: dep.name,
        error: errorMsg,
        duration: Date.now() - startTime,
      };
    }
  }
  
  /**
   * 批量安装依赖
   */
  async installAll(deps: Dependency[], options: InstallOptions = {}): Promise<InstallResult[]> {
    const results: InstallResult[] = [];
    
    for (const dep of deps) {
      const result = await this.install(dep, options);
      results.push(result);
      
      // 如果是必需依赖且安装失败，停止
      if (!result.success && dep.required) {
        logger.error(`必需依赖安装失败: ${dep.name}`);
        break;
      }
    }
    
    return results;
  }
  
  /**
   * 获取安装命令
   */
  private getInstallCommand(dep: Dependency, options: InstallOptions): string | null {
    const globalFlag = options.global !== false && dep.type === 'npm' ? '-g' : '';
    
    switch (dep.packageManager) {
      case 'npm':
        return `npm install ${globalFlag} ${dep.packageName || dep.name}`;
      case 'yarn':
        return `yarn global add ${dep.packageName || dep.name}`;
      case 'pnpm':
        return `pnpm add -g ${dep.packageName || dep.name}`;
      case 'pip':
      case 'pip3':
        return `pip install ${dep.packageName || dep.name}`;
      case 'apt':
        return `sudo apt-get install -y ${dep.packageName || dep.name}`;
      case 'brew':
        return `brew install ${dep.packageName || dep.name}`;
      case 'choco':
        return `choco install -y ${dep.packageName || dep.name}`;
      default:
        return null;
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 环境管理器
// ═══════════════════════════════════════════════════════════════

/**
 * 环境管理器配置
 */
export interface EnvironmentManagerConfig {
  autoInstall?: boolean;
  requiredDependencies?: Dependency[];
  packageManagers?: PackageManager[];
}

/**
 * 环境管理器
 */
export class EnvironmentManager {
  private managerDetector = new PackageManagerDetector();
  private checker = new DependencyChecker();
  private installer = new DependencyInstaller();
  private config: EnvironmentManagerConfig;
  
  constructor(config: EnvironmentManagerConfig = {}) {
    this.config = {
      autoInstall: config.autoInstall ?? false,
      requiredDependencies: config.requiredDependencies || COMMON_DEPENDENCIES,
    };
  }
  
  /**
   * 初始化环境
   */
  async initialize(): Promise<EnvironmentStatus> {
    logger.info('初始化环境...');
    
    // 检测包管理器
    const packageManagers = await this.managerDetector.detect();
    
    // 检查依赖
    const checkResults = await this.checker.checkAll(this.config.requiredDependencies!);
    
    // 找出缺失的依赖
    const missingDependencies = this.config.requiredDependencies!.filter(
      (dep, i) => !checkResults[i].installed
    );
    
    // 自动安装
    if (this.config.autoInstall && missingDependencies.length > 0) {
      logger.info(`自动安装 ${missingDependencies.length} 个缺失依赖`);
      await this.installer.installAll(missingDependencies);
    }
    
    const healthy = missingDependencies.length === 0;
    
    return {
      healthy,
      missingDependencies,
      installedDependencies: checkResults.filter(r => r.installed),
      platform: process.platform,
      packageManagers,
    };
  }
  
  /**
   * 检查特定依赖
   */
  async checkDependency(name: string): Promise<DependencyCheckResult> {
    const dep = this.config.requiredDependencies?.find(d => d.name === name);
    if (!dep) {
      return { name, installed: false };
    }
    return this.checker.check(dep);
  }
  
  /**
   * 安装特定依赖
   */
  async installDependency(name: string, options?: InstallOptions): Promise<InstallResult> {
    const dep = this.config.requiredDependencies?.find(d => d.name === name);
    if (!dep) {
      return {
        success: false,
        name,
        error: '依赖未定义',
        duration: 0,
      };
    }
    return this.installer.install(dep, options);
  }
  
  /**
   * 确保依赖已安装
   */
  async ensureDependency(name: string): Promise<boolean> {
    const checkResult = await this.checkDependency(name);
    
    if (checkResult.installed) {
      return true;
    }
    
    const installResult = await this.installDependency(name);
    return installResult.success;
  }
  
  /**
   * 添加自定义依赖
   */
  addDependency(dep: Dependency): void {
    if (!this.config.requiredDependencies) {
      this.config.requiredDependencies = [];
    }
    this.config.requiredDependencies.push(dep);
  }
  
  /**
   * 获取环境状态
   */
  async getStatus(): Promise<EnvironmentStatus> {
    return this.initialize();
  }
}

// ═══════════════════════════════════════════════════════════════
// 全局实例
// ═══════════════════════════════════════════════════════════════

let globalEnvironmentManager: EnvironmentManager | null = null;

export function getEnvironmentManager(): EnvironmentManager {
  if (!globalEnvironmentManager) {
    globalEnvironmentManager = new EnvironmentManager();
  }
  return globalEnvironmentManager;
}

export function resetEnvironmentManager(): void {
  globalEnvironmentManager = null;
}

// ═══════════════════════════════════════════════════════════════
// 便捷函数
// ═══════════════════════════════════════════════════════════════

/**
 * 检查依赖是否已安装
 */
export async function isInstalled(name: string): Promise<boolean> {
  const result = await getEnvironmentManager().checkDependency(name);
  return result.installed;
}

/**
 * 确保依赖已安装
 */
export async function ensureInstalled(name: string): Promise<boolean> {
  return getEnvironmentManager().ensureDependency(name);
}

/**
 * 安装依赖
 */
export async function install(name: string): Promise<InstallResult> {
  return getEnvironmentManager().installDependency(name);
}
