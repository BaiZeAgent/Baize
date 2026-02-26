/**
 * 日志系统 - 统一日志配置
 */
import winston from 'winston';
import path from 'path';
import fs from 'fs';
import YAML from 'yaml';

interface LogConfig {
  level: string;
  format: string;
  file: string;
  maxSize: string;
  backupCount: number;
}

interface SystemConfig {
  logging: LogConfig;
  paths: {
    logDir: string;
  };
}

/**
 * 白泽日志管理器
 */
export class BaizeLogger {
  private static instance: winston.Logger | null = null;
  private static initialized = false;

  /**
   * 初始化日志系统
   */
  static setup(configPath: string = 'config/system.yaml'): void {
    if (this.initialized) {
      return;
    }

    const config = this.loadConfig(configPath);
    const logConfig = config.logging;
    const logDir = config.paths.logDir;

    // 创建日志目录
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    // 定义日志格式
    const customFormat = winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
        return `${timestamp} | ${level.toUpperCase().padEnd(8)} | ${message} ${metaStr}`;
      })
    );

    // 创建日志器
    this.instance = winston.createLogger({
      level: logConfig.level,
      format: customFormat,
      transports: [
        // 控制台输出
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            customFormat
          ),
        }),
        // 文件输出
        new winston.transports.File({
          filename: path.join(logDir, 'baize.log'),
          maxsize: this.parseSize(logConfig.maxSize),
          maxFiles: logConfig.backupCount,
        }),
      ],
    });

    this.initialized = true;
    this.instance?.info('日志系统初始化完成');
  }

  /**
   * 获取日志器
   */
  static getLogger(name: string): winston.Logger {
    if (!this.initialized) {
      this.setup();
    }
    
    return this.instance!.child({ module: name });
  }

  /**
   * 加载配置文件
   */
  private static loadConfig(configPath: string): SystemConfig {
    try {
      const content = fs.readFileSync(configPath, 'utf-8');
      return YAML.parse(content) as SystemConfig;
    } catch {
      return {
        logging: {
          level: 'info',
          format: 'simple',
          file: 'logs/baize.log',
          maxSize: '10MB',
          backupCount: 5,
        },
        paths: {
          logDir: 'logs',
        },
      };
    }
  }

  /**
   * 解析大小字符串
   */
  private static parseSize(sizeStr: string): number {
    const match = sizeStr.match(/^(\d+)(KB|MB|GB)?$/i);
    if (!match) {
      return 10 * 1024 * 1024;
    }
    
    const num = parseInt(match[1], 10);
    const unit = (match[2] || 'B').toUpperCase();
    
    switch (unit) {
      case 'KB': return num * 1024;
      case 'MB': return num * 1024 * 1024;
      case 'GB': return num * 1024 * 1024 * 1024;
      default: return num;
    }
  }
}

/**
 * 获取日志器的便捷函数
 */
export function getLogger(name: string): winston.Logger {
  return BaizeLogger.getLogger(name);
}
