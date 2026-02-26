/**
 * 成本管理器 - 预算管理和成本追踪
 * 
 * 第十三章 成本控制
 * 
 * 功能：
 * 1. 预算配置管理
 * 2. 成本追踪记录
 * 3. 预算检查
 * 4. 告警通知
 */

import { getLogger } from '../../observability/logger';
import { CostConfig, CostRecord } from '../../types';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const logger = getLogger('cost:manager');

/**
 * 默认成本配置
 */
const DEFAULT_CONFIG: CostConfig = {
  dailyBudget: 10,          // $10/天
  perTaskBudget: 0.5,       // $0.5/任务
  alertThreshold: 80,       // 80%告警
  hardLimit: true,          // 超限拒绝
};

/**
 * 模型定价 (美元/1K tokens)
 */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'qwen-max': { input: 0.002, output: 0.006 },
  'qwen-plus': { input: 0.0004, output: 0.0012 },
  'qwen-turbo': { input: 0.0002, output: 0.0006 },
  'glm-4': { input: 0.001, output: 0.001 },
  'gpt-4': { input: 0.03, output: 0.06 },
  'gpt-3.5-turbo': { input: 0.0015, output: 0.002 },
  'default': { input: 0.001, output: 0.002 },
};

/**
 * 成本管理器
 */
export class CostManager {
  private config: CostConfig;
  private records: CostRecord[] = [];
  private dailyUsage: Map<string, number> = new Map();
  private alertSent: boolean = false;

  constructor(config: Partial<CostConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.loadFromStorage();
    logger.info('成本管理器初始化', { config: this.config });
  }

  /**
   * 获取配置
   */
  getConfig(): CostConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<CostConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('成本配置已更新', { config: this.config });
  }

  /**
   * 检查是否可以继续执行
   */
  canProceed(estimatedTokens: number = 0, model: string = 'default'): boolean {
    const today = this.getTodayKey();
    const currentUsage = this.dailyUsage.get(today) || 0;
    
    // 估算成本
    const pricing = MODEL_PRICING[model] || MODEL_PRICING['default'];
    const estimatedCost = (estimatedTokens / 1000) * pricing.input;

    // 检查是否超预算
    if (this.config.hardLimit && currentUsage + estimatedCost > this.config.dailyBudget) {
      logger.warn('预算超限，拒绝执行', {
        currentUsage,
        estimatedCost,
        dailyBudget: this.config.dailyBudget
      });
      return false;
    }

    return true;
  }

  /**
   * 记录使用
   */
  recordUsage(
    provider: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
    conversationId?: string
  ): CostRecord {
    // 计算成本
    const pricing = MODEL_PRICING[model] || MODEL_PRICING['default'];
    const inputCost = (inputTokens / 1000) * pricing.input;
    const outputCost = (outputTokens / 1000) * pricing.output;
    const totalCost = inputCost + outputCost;

    const record: CostRecord = {
      id: `cost_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      provider,
      model,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      cost: totalCost,
      timestamp: new Date(),
      conversationId,
    };

    // 记录到内存
    this.records.push(record);

    // 更新每日使用量
    const today = this.getTodayKey();
    const currentUsage = this.dailyUsage.get(today) || 0;
    this.dailyUsage.set(today, currentUsage + totalCost);

    // 持久化
    this.saveToStorage();

    // 检查告警阈值
    this.checkAlertThreshold();

    logger.info('成本记录', {
      provider,
      model,
      tokens: `${inputTokens}+${outputTokens}`,
      cost: `$${totalCost.toFixed(4)}`,
      dailyTotal: `$${(currentUsage + totalCost).toFixed(4)}`
    });

    return record;
  }

  /**
   * 检查告警阈值
   */
  private checkAlertThreshold(): void {
    if (this.alertSent) return;

    const today = this.getTodayKey();
    const currentUsage = this.dailyUsage.get(today) || 0;
    const threshold = this.config.dailyBudget * this.config.alertThreshold / 100;

    if (currentUsage >= threshold) {
      this.alertSent = true;
      logger.warn(`⚠️ 成本告警: 已使用 ${Math.round(currentUsage / this.config.dailyBudget * 100)}% 的日预算`, {
        usage: `$${currentUsage.toFixed(4)}`,
        budget: `$${this.config.dailyBudget}`,
        threshold: `${this.config.alertThreshold}%`
      });
    }
  }

  /**
   * 获取今日使用量
   */
  getTodayUsage(): number {
    const today = this.getTodayKey();
    return this.dailyUsage.get(today) || 0;
  }

  /**
   * 获取指定日期使用量
   */
  getUsageByDate(date: Date): number {
    const key = this.getDateKey(date);
    return this.dailyUsage.get(key) || 0;
  }

  /**
   * 获取使用统计
   */
  getStats(): {
    today: number;
    yesterday: number;
    thisWeek: number;
    thisMonth: number;
    total: number;
    recordCount: number;
  } {
    const today = this.getTodayKey();
    const yesterday = this.getYesterdayKey();

    // 计算本周和本月
    let thisWeek = 0;
    let thisMonth = 0;
    const now = new Date();

    for (const [key, usage] of this.dailyUsage) {
      const date = new Date(key);
      const daysDiff = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

      if (daysDiff < 7) thisWeek += usage;
      if (date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()) {
        thisMonth += usage;
      }
    }

    return {
      today: this.dailyUsage.get(today) || 0,
      yesterday: this.dailyUsage.get(yesterday) || 0,
      thisWeek,
      thisMonth,
      total: this.records.reduce((sum, r) => sum + r.cost, 0),
      recordCount: this.records.length,
    };
  }

  /**
   * 获取记录列表
   */
  getRecords(limit: number = 100): CostRecord[] {
    return this.records.slice(-limit);
  }

  /**
   * 获取按提供商分组的统计
   */
  getStatsByProvider(): Record<string, { count: number; totalCost: number; totalTokens: number }> {
    const stats: Record<string, { count: number; totalCost: number; totalTokens: number }> = {};

    for (const record of this.records) {
      if (!stats[record.provider]) {
        stats[record.provider] = { count: 0, totalCost: 0, totalTokens: 0 };
      }
      stats[record.provider].count++;
      stats[record.provider].totalCost += record.cost;
      stats[record.provider].totalTokens += record.totalTokens;
    }

    return stats;
  }

  /**
   * 获取按模型分组的统计
   */
  getStatsByModel(): Record<string, { count: number; totalCost: number; totalTokens: number }> {
    const stats: Record<string, { count: number; totalCost: number; totalTokens: number }> = {};

    for (const record of this.records) {
      if (!stats[record.model]) {
        stats[record.model] = { count: 0, totalCost: 0, totalTokens: 0 };
      }
      stats[record.model].count++;
      stats[record.model].totalCost += record.cost;
      stats[record.model].totalTokens += record.totalTokens;
    }

    return stats;
  }

  /**
   * 重置今日告警状态
   */
  resetAlert(): void {
    this.alertSent = false;
  }

  /**
   * 清空历史记录
   */
  clearHistory(): void {
    this.records = [];
    this.dailyUsage.clear();
    this.alertSent = false;
    this.saveToStorage();
    logger.info('成本历史已清空');
  }

  /**
   * 获取今日键
   */
  private getTodayKey(): string {
    return new Date().toISOString().split('T')[0];
  }

  /**
   * 获取昨日键
   */
  private getYesterdayKey(): string {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday.toISOString().split('T')[0];
  }

  /**
   * 获取日期键
   */
  private getDateKey(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  /**
   * 保存到存储
   */
  private saveToStorage(): void {
    try {
      const data = {
        records: this.records.slice(-1000), // 只保留最近1000条
        dailyUsage: Object.fromEntries(this.dailyUsage),
      };
      
      // 确保 data 目录存在
      const dataDir = join(process.cwd(), 'data');
      if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
      }
      
      const filePath = join(dataDir, 'cost_records.json');
      writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.warn('成本数据保存失败', { error });
    }
  }

  /**
   * 从存储加载
   */
  private loadFromStorage(): void {
    try {
      const filePath = join(process.cwd(), 'data', 'cost_records.json');
      if (existsSync(filePath)) {
        const data = readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(data);
        this.records = parsed.records || [];
        this.dailyUsage = new Map(Object.entries(parsed.dailyUsage || {}));
        logger.info('成本数据已加载', { 
          recordCount: this.records.length,
          dailyUsageDays: this.dailyUsage.size 
        });
      }
    } catch (error) {
      logger.warn('成本数据加载失败', { error });
    }
  }
}

// 全局实例
let costManager: CostManager | null = null;

export function getCostManager(config?: Partial<CostConfig>): CostManager {
  if (!costManager) {
    costManager = new CostManager(config);
  }
  return costManager;
}

export function resetCostManager(): void {
  costManager = null;
}
