/**
 * 文件监控系统 - 自动同步与变更检测
 * 
 * 提供文件系统监控：
 * 1. 文件变更检测
 * 2. 自动索引更新
 * 3. 增量同步
 */

import { getLogger } from '../observability/logger';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

const logger = getLogger('watcher');

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

/**
 * 文件变更类型
 */
export type FileChangeType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';

/**
 * 文件变更事件
 */
export interface FileChangeEvent {
  type: FileChangeType;
  path: string;
  timestamp: number;
  stats?: fs.Stats;
}

/**
 * 监控配置
 */
export interface WatcherConfig {
  // 监控路径
  paths: string[];
  
  // 忽略模式
  ignore?: RegExp[];
  
  // 是否递归
  recursive?: boolean;
  
  // 防抖延迟 (ms)
  debounceMs?: number;
  
  // 是否持久化
  persistent?: boolean;
}

/**
 * 监控统计
 */
export interface WatcherStats {
  watchedPaths: number;
  totalFiles: number;
  totalDirs: number;
  events: number;
  startTime: number;
}

// ═══════════════════════════════════════════════════════════════
// 文件监控器
// ═══════════════════════════════════════════════════════════════

/**
 * 文件监控器
 */
export class FileWatcher extends EventEmitter {
  private config: Required<WatcherConfig>;
  private watchers: Map<string, fs.FSWatcher> = new Map();
  private fileHashes: Map<string, string> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private stats: WatcherStats;
  private running: boolean = false;
  
  constructor(config: WatcherConfig) {
    super();
    
    this.config = {
      paths: config.paths,
      ignore: config.ignore || [/node_modules/, /\.git/, /dist/, /\.DS_Store/],
      recursive: config.recursive !== false,
      debounceMs: config.debounceMs || 100,
      persistent: config.persistent !== false,
    };
    
    this.stats = {
      watchedPaths: 0,
      totalFiles: 0,
      totalDirs: 0,
      events: 0,
      startTime: 0,
    };
  }
  
  /**
   * 开始监控
   */
  async start(): Promise<void> {
    if (this.running) return;
    
    this.running = true;
    this.stats.startTime = Date.now();
    
    for (const watchPath of this.config.paths) {
      await this.watchPath(watchPath);
    }
    
    logger.info(`文件监控启动: ${this.config.paths.length} 个路径`);
  }
  
  /**
   * 停止监控
   */
  stop(): void {
    if (!this.running) return;
    
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    
    this.watchers.clear();
    this.running = false;
    
    logger.info('文件监控停止');
  }
  
  /**
   * 监控路径
   */
  private async watchPath(watchPath: string): Promise<void> {
    if (!fs.existsSync(watchPath)) {
      logger.warn(`路径不存在: ${watchPath}`);
      return;
    }
    
    // 检查是否忽略
    if (this.shouldIgnore(watchPath)) {
      return;
    }
    
    const stats = fs.statSync(watchPath);
    
    if (stats.isDirectory()) {
      this.stats.totalDirs++;
      this.stats.watchedPaths++;
      
      // 创建目录监控
      const watcher = fs.watch(watchPath, { persistent: this.config.persistent }, (event, filename) => {
        this.handleEvent(watchPath, event, filename);
      });
      
      this.watchers.set(watchPath, watcher);
      
      // 递归监控子目录
      if (this.config.recursive) {
        const entries = fs.readdirSync(watchPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(watchPath, entry.name);
          if (entry.isDirectory() && !this.shouldIgnore(fullPath)) {
            await this.watchPath(fullPath);
          } else if (entry.isFile()) {
            this.stats.totalFiles++;
            this.fileHashes.set(fullPath, this.getFileHash(fullPath));
          }
        }
      }
    } else {
      this.stats.totalFiles++;
      this.fileHashes.set(watchPath, this.getFileHash(watchPath));
    }
  }
  
  /**
   * 处理文件系统事件
   */
  private handleEvent(dir: string, event: string, filename: string | null): void {
    if (!filename) return;
    
    const fullPath = path.join(dir, filename);
    
    // 检查是否忽略
    if (this.shouldIgnore(fullPath)) return;
    
    // 防抖
    const existingTimer = this.debounceTimers.get(fullPath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    
    this.debounceTimers.set(fullPath, setTimeout(() => {
      this.debounceTimers.delete(fullPath);
      this.processEvent(fullPath, event);
    }, this.config.debounceMs));
  }
  
  /**
   * 处理事件
   */
  private processEvent(fullPath: string, event: string): void {
    const exists = fs.existsSync(fullPath);
    const oldHash = this.fileHashes.get(fullPath);
    
    let changeType: FileChangeType;
    
    if (event === 'rename') {
      if (exists) {
        if (oldHash) {
          changeType = 'change';
        } else {
          changeType = fs.statSync(fullPath).isDirectory() ? 'addDir' : 'add';
        }
      } else {
        if (oldHash) {
          changeType = 'unlink';
          this.fileHashes.delete(fullPath);
        } else {
          changeType = 'unlinkDir';
        }
      }
    } else {
      changeType = 'change';
    }
    
    // 更新哈希
    if (exists && (changeType === 'add' || changeType === 'change')) {
      const newHash = this.getFileHash(fullPath);
      if (oldHash === newHash && changeType === 'change') {
        // 内容未变，忽略
        return;
      }
      this.fileHashes.set(fullPath, newHash);
    }
    
    // 更新统计
    this.stats.events++;
    
    // 发送事件
    const changeEvent: FileChangeEvent = {
      type: changeType,
      path: fullPath,
      timestamp: Date.now(),
      stats: exists ? fs.statSync(fullPath) : undefined,
    };
    
    this.emit('change', changeEvent);
    this.emit(changeType, changeEvent);
    
    logger.debug(`文件变更: ${changeType} ${fullPath}`);
    
    // 如果是新增目录，开始监控
    if (changeType === 'addDir' && this.config.recursive) {
      this.watchPath(fullPath).catch(() => {});
    }
  }
  
  /**
   * 检查是否应该忽略
   */
  private shouldIgnore(filePath: string): boolean {
    for (const pattern of this.config.ignore) {
      if (pattern.test(filePath)) {
        return true;
      }
    }
    return false;
  }
  
  /**
   * 获取文件哈希
   */
  private getFileHash(filePath: string): string {
    try {
      const stats = fs.statSync(filePath);
      return `${stats.size}-${stats.mtimeMs}`;
    } catch {
      return '';
    }
  }
  
  /**
   * 获取统计信息
   */
  getStats(): WatcherStats {
    return { ...this.stats };
  }
  
  /**
   * 是否正在运行
   */
  isRunning(): boolean {
    return this.running;
  }
}

// ═══════════════════════════════════════════════════════════════
// 索引同步器
// ═══════════════════════════════════════════════════════════════

/**
 * 索引同步器
 * 
 * 将文件变更同步到搜索索引
 */
export class IndexSynchronizer extends EventEmitter {
  private watcher: FileWatcher;
  private indexedFiles: Map<string, { hash: string; indexedAt: number }> = new Map();
  
  constructor(watcher: FileWatcher) {
    super();
    this.watcher = watcher;
    
    // 监听文件变更
    watcher.on('change', (event: FileChangeEvent) => {
      this.handleChange(event);
    });
  }
  
  /**
   * 处理文件变更
   */
  private async handleChange(event: FileChangeEvent): Promise<void> {
    const { type, path: filePath } = event;
    
    switch (type) {
      case 'add':
      case 'change':
        await this.indexFile(filePath);
        break;
      case 'unlink':
        await this.removeFile(filePath);
        break;
      case 'addDir':
        await this.indexDirectory(filePath);
        break;
      case 'unlinkDir':
        await this.removeDirectory(filePath);
        break;
    }
  }
  
  /**
   * 索引文件
   */
  private async indexFile(filePath: string): Promise<void> {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const hash = this.getContentHash(content);
      
      // 检查是否需要更新
      const existing = this.indexedFiles.get(filePath);
      if (existing && existing.hash === hash) {
        return;
      }
      
      // 发送索引事件
      this.emit('index', { path: filePath, content, hash });
      
      this.indexedFiles.set(filePath, {
        hash,
        indexedAt: Date.now(),
      });
      
      logger.debug(`索引文件: ${filePath}`);
    } catch (error) {
      logger.warn(`索引文件失败: ${filePath} - ${error}`);
    }
  }
  
  /**
   * 移除文件
   */
  private async removeFile(filePath: string): Promise<void> {
    this.indexedFiles.delete(filePath);
    this.emit('remove', { path: filePath });
    logger.debug(`移除文件: ${filePath}`);
  }
  
  /**
   * 索引目录
   */
  private async indexDirectory(dirPath: string): Promise<void> {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isFile()) {
        await this.indexFile(fullPath);
      }
    }
    
    logger.debug(`索引目录: ${dirPath}`);
  }
  
  /**
   * 移除目录
   */
  private async removeDirectory(dirPath: string): Promise<void> {
    // 移除所有子文件
    for (const [filePath] of this.indexedFiles) {
      if (filePath.startsWith(dirPath)) {
        this.indexedFiles.delete(filePath);
      }
    }
    
    this.emit('removeDir', { path: dirPath });
    logger.debug(`移除目录: ${dirPath}`);
  }
  
  /**
   * 获取内容哈希
   */
  private getContentHash(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      hash = ((hash << 5) - hash) + content.charCodeAt(i);
      hash = hash & hash;
    }
    return hash.toString(16);
  }
  
  /**
   * 获取索引统计
   */
  getStats(): { totalFiles: number; lastIndexed?: number } {
    let lastIndexed = 0;
    for (const info of this.indexedFiles.values()) {
      if (info.indexedAt > lastIndexed) {
        lastIndexed = info.indexedAt;
      }
    }
    
    return {
      totalFiles: this.indexedFiles.size,
      lastIndexed: lastIndexed || undefined,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// 全局实例
// ═══════════════════════════════════════════════════════════════

let globalWatcher: FileWatcher | null = null;
let globalSynchronizer: IndexSynchronizer | null = null;

/**
 * 获取全局文件监控器
 */
export function getFileWatcher(): FileWatcher {
  if (!globalWatcher) {
    globalWatcher = new FileWatcher({
      paths: [process.cwd()],
      ignore: [/node_modules/, /\.git/, /dist/, /\.DS_Store/],
    });
  }
  return globalWatcher;
}

/**
 * 获取全局索引同步器
 */
export function getIndexSynchronizer(): IndexSynchronizer {
  if (!globalSynchronizer) {
    globalSynchronizer = new IndexSynchronizer(getFileWatcher());
  }
  return globalSynchronizer;
}

/**
 * 重置
 */
export function resetWatcher(): void {
  if (globalWatcher) {
    globalWatcher.stop();
  }
  globalWatcher = null;
  globalSynchronizer = null;
}
