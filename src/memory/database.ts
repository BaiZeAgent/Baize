/**
 * 数据库管理模块 - 使用sql.js (纯JavaScript SQLite实现)
 */
import initSqlJs, { Database as SqlJsDatabase, SqlJsStatic } from 'sql.js';
import path from 'path';
import fs from 'fs';
import { getLogger } from '../observability/logger';

const logger = getLogger('database');

/**
 * 数据库管理器
 */
export class BaizeDatabase {
  private db: SqlJsDatabase | null = null;
  private sql: SqlJsStatic | null = null;
  private dbPath: string;
  private initialized = false;

  constructor(dbPath: string = 'data/baize.db') {
    this.dbPath = dbPath;
  }

  /**
   * 初始化数据库
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // 初始化sql.js
      this.sql = await initSqlJs();
      
      // 确保目录存在
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 尝试加载现有数据库
      if (fs.existsSync(this.dbPath)) {
        const buffer = fs.readFileSync(this.dbPath);
        this.db = new this.sql.Database(buffer);
        logger.info(`数据库加载成功: ${this.dbPath}`);
      } else {
        this.db = new this.sql.Database();
        logger.info(`数据库创建成功: ${this.dbPath}`);
      }

      // 创建表结构
      this.createTables();
      this.initialized = true;
      logger.info('数据库初始化完成');
    } catch (error) {
      logger.error(`数据库初始化失败: ${error}`);
      throw error;
    }
  }

  /**
   * 创建表结构
   */
  private createTables(): void {
    const schema = `
      -- 情景记忆表
      CREATE TABLE IF NOT EXISTS episodic_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_episodic_time ON episodic_memory(timestamp);
      CREATE INDEX IF NOT EXISTS idx_episodic_type ON episodic_memory(type);

      -- 声明式记忆表
      CREATE TABLE IF NOT EXISTS declarative_memory (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        confidence REAL DEFAULT 0.5,
        times_reinforced INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      -- 程序性记忆表
      CREATE TABLE IF NOT EXISTS procedural_memory (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      -- 主动任务表
      CREATE TABLE IF NOT EXISTS proactive_tasks (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        trigger_config TEXT NOT NULL,
        action_config TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_run_at TEXT,
        next_run_at TEXT
      );

      -- 任务执行历史
      CREATE TABLE IF NOT EXISTS task_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        status TEXT,
        result TEXT,
        FOREIGN KEY (task_id) REFERENCES proactive_tasks(id)
      );

      -- 自进化历史
      CREATE TABLE IF NOT EXISTS evolution_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        request_id TEXT,
        type TEXT,
        target TEXT,
        description TEXT,
        result TEXT
      );

      -- 信任记录表
      CREATE TABLE IF NOT EXISTS trust_records (
        operation TEXT PRIMARY KEY,
        success_count INTEGER DEFAULT 0,
        failure_count INTEGER DEFAULT 0,
        last_success_at TEXT,
        skip_confirm INTEGER DEFAULT 0
      );

      -- 确认历史表
      CREATE TABLE IF NOT EXISTS confirmation_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        action TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `;

    try {
      this.db!.run(schema);
      this.save();
      logger.info('数据库表结构创建完成');
    } catch (error) {
      logger.error(`创建表结构失败: ${error}`);
      throw error;
    }
  }

  /**
   * 保存数据库到文件
   */
  save(): void {
    if (this.db && this.dbPath) {
      const data = this.db.export();
      const buffer = Buffer.from(data);
      fs.writeFileSync(this.dbPath, buffer);
    }
  }

  /**
   * 关闭数据库
   */
  close(): void {
    if (this.db) {
      this.save();
      this.db.close();
      this.db = null;
      this.initialized = false;
      logger.info('数据库已关闭');
    }
  }

  /**
   * 执行SQL（无返回）
   */
  run(sql: string, params: (string | number | null)[] = []): void {
    this.ensureInitialized();
    try {
      this.db!.run(sql, params);
      this.save();
    } catch (error) {
      logger.error(`SQL执行失败: ${sql}, ${error}`);
      throw error;
    }
  }

  /**
   * 查询单条
   */
  get<T = Record<string, unknown>>(sql: string, params: (string | number | null)[] = []): T | undefined {
    this.ensureInitialized();
    try {
      const stmt = this.db!.prepare(sql);
      stmt.bind(params);
      if (stmt.step()) {
        const row = stmt.getAsObject();
        stmt.free();
        return row as T;
      }
      stmt.free();
      return undefined;
    } catch (error) {
      logger.error(`SQL查询失败: ${sql}, ${error}`);
      throw error;
    }
  }

  /**
   * 查询多条
   */
  all<T = Record<string, unknown>>(sql: string, params: (string | number | null)[] = []): T[] {
    this.ensureInitialized();
    try {
      const results: T[] = [];
      const stmt = this.db!.prepare(sql);
      stmt.bind(params);
      while (stmt.step()) {
        results.push(stmt.getAsObject() as T);
      }
      stmt.free();
      return results;
    } catch (error) {
      logger.error(`SQL查询失败: ${sql}, ${error}`);
      throw error;
    }
  }

  /**
   * 确保已初始化
   */
  private ensureInitialized(): void {
    if (!this.initialized || !this.db) {
      throw new Error('数据库未初始化，请先调用 initialize()');
    }
  }
}

// 全局实例
let dbInstance: BaizeDatabase | null = null;

/**
 * 获取数据库实例
 */
export function getDatabase(): BaizeDatabase {
  if (!dbInstance) {
    dbInstance = new BaizeDatabase();
  }
  return dbInstance;
}

/**
 * 初始化数据库
 */
export async function initDatabase(dbPath?: string): Promise<BaizeDatabase> {
  dbInstance = new BaizeDatabase(dbPath);
  await dbInstance.initialize();
  return dbInstance;
}
