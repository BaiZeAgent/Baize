/**
 * sql.js 类型声明
 * 
 * 纯JavaScript SQLite实现的类型定义
 */

declare module 'sql.js' {
  /**
   * 数据库实例
   */
  export interface Database {
    /**
     * 执行SQL语句
     */
    run(sql: string, params?: unknown[]): Database;
    
    /**
     * 执行多条SQL语句
     */
    exec(sql: string): QueryExecResult[];
    
    /**
     * 准备语句
     */
    prepare(sql: string): Statement;
    
    /**
     * 导出数据库为二进制
     */
    export(): Uint8Array;
    
    /**
     * 关闭数据库
     */
    close(): void;
    
    /**
     * 执行PRAGMA语句
     */
    pragma(pragma: string): QueryExecResult[];
  }

  /**
   * 预处理语句
   */
  export interface Statement {
    /**
     * 绑定参数
     */
    bind(params?: unknown[]): boolean;
    
    /**
     * 执行一步
     */
    step(): boolean;
    
    /**
     * 获取当前行作为对象
     */
    getAsObject(): Record<string, unknown>;
    
    /**
     * 获取当前行作为数组
     */
    get(): unknown[];
    
    /**
     * 获取列名
     */
    getColumnNames(): string[];
    
    /**
     * 释放语句
     */
    free(): boolean;
    
    /**
     * 重置语句
     */
    reset(): Statement;
    
    /**
     * 运行语句
     */
    run(params?: unknown[]): Database;
  }

  /**
   * 查询执行结果
   */
  export interface QueryExecResult {
    columns: string[];
    values: unknown[][];
  }

  /**
   * SQL.js静态实例
   */
  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number>) => Database;
  }

  /**
   * 初始化选项
   */
  export interface InitSqlJsOptions {
    /**
     * WebAssembly文件路径
     */
    locateFile?: (file: string) => string;
  }

  /**
   * 初始化函数
   */
  export default function initSqlJs(options?: InitSqlJsOptions): Promise<SqlJsStatic>;
}
