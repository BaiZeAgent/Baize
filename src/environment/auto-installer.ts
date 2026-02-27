/**
 * 自动技能安装器
 * 
 * 当检测到能力缺口时，自动搜索和安装技能
 */

import { getLogger } from '../observability/logger';
import { getClawHubClient, ClawHubSearchResult } from '../skills/market/ClawHubClient';
import { getSkillRegistry } from '../skills/registry';
import { getLLMManager } from '../llm';
import { LLMMessage } from '../types';

const logger = getLogger('auto-installer');

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

/**
 * 能力缺口
 */
export interface CapabilityGap {
  missingCapabilities: string[];
  suggestedSkills: string[];
  reason: string;
}

/**
 * 搜索结果
 */
export interface SkillSearchResult {
  slug: string;
  displayName: string;
  summary: string;
  score: number;
  relevance: number;
}

/**
 * 安装决策
 */
export interface InstallDecision {
  shouldInstall: boolean;
  skillSlug?: string;
  confidence: number;
  reason: string;
}

/**
 * 自动安装配置
 */
export interface AutoInstallerConfig {
  enabled: boolean;
  autoInstall: boolean;          // 是否自动安装（无需确认）
  maxSearchResults: number;
  minRelevanceScore: number;
  requireApproval: boolean;      // 是否需要用户确认
}

// ═══════════════════════════════════════════════════════════════
// 默认配置
// ═══════════════════════════════════════════════════════════════

export const DEFAULT_AUTO_INSTALLER_CONFIG: AutoInstallerConfig = {
  enabled: true,
  autoInstall: false,    // 默认不自动安装，需要用户确认
  maxSearchResults: 5,
  minRelevanceScore: 0.6,
  requireApproval: true,
};

// ═══════════════════════════════════════════════════════════════
// 自动技能安装器
// ═══════════════════════════════════════════════════════════════

/**
 * 自动技能安装器
 */
export class AutoSkillInstaller {
  private clawHub = getClawHubClient();
  private skillRegistry = getSkillRegistry();
  private llm = getLLMManager();
  private config: AutoInstallerConfig;
  
  constructor(config: Partial<AutoInstallerConfig> = {}) {
    this.config = { ...DEFAULT_AUTO_INSTALLER_CONFIG, ...config };
  }
  
  /**
   * 检测能力缺口并建议技能
   */
  async detectGap(userInput: string): Promise<CapabilityGap | null> {
    // 获取当前可用技能
    const availableSkills = this.skillRegistry.getAll().map(s => s.name);
    
    // 使用 LLM 分析
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个能力分析器。分析用户请求，判断是否需要当前系统不具备的能力。

当前可用技能: ${availableSkills.join(', ') || '无'}

返回 JSON 格式:
{
  "hasGap": true/false,
  "missingCapabilities": ["能力1", "能力2"],
  "suggestedSkills": ["技能名"],
  "reason": "原因"
}`
      },
      { role: 'user', content: userInput }
    ];
    
    try {
      const response = await this.llm.chat(messages, { temperature: 0.1 });
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        if (parsed.hasGap) {
          return {
            missingCapabilities: parsed.missingCapabilities || [],
            suggestedSkills: parsed.suggestedSkills || [],
            reason: parsed.reason || '',
          };
        }
      }
    } catch (error) {
      logger.error(`能力缺口检测失败: ${error}`);
    }
    
    return null;
  }
  
  /**
   * 搜索相关技能
   */
  async searchSkills(query: string): Promise<SkillSearchResult[]> {
    const results = await this.clawHub.search(query, this.config.maxSearchResults);
    
    // 计算相关性分数
    const withRelevance = results.map(r => ({
      ...r,
      relevance: this.calculateRelevance(query, r),
    }));
    
    // 过滤低相关性结果
    return withRelevance.filter(r => r.relevance >= this.config.minRelevanceScore);
  }
  
  /**
   * 决定是否安装技能
   */
  async decideInstall(
    gap: CapabilityGap,
    searchResults: SkillSearchResult[]
  ): Promise<InstallDecision> {
    if (searchResults.length === 0) {
      return {
        shouldInstall: false,
        confidence: 0,
        reason: '未找到相关技能',
      };
    }
    
    // 选择最相关的技能
    const best = searchResults[0];
    
    // 使用 LLM 判断是否应该安装
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个技能安装决策器。判断是否应该安装某个技能。

返回 JSON 格式:
{
  "shouldInstall": true/false,
  "confidence": 0.0-1.0,
  "reason": "原因"
}`
      },
      {
        role: 'user',
        content: `缺失能力: ${gap.missingCapabilities.join(', ')}
推荐技能: ${best.slug}
技能描述: ${best.summary}
相关性: ${best.relevance}

是否应该安装此技能？`
      }
    ];
    
    try {
      const response = await this.llm.chat(messages, { temperature: 0.1 });
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          shouldInstall: parsed.shouldInstall,
          skillSlug: best.slug,
          confidence: parsed.confidence,
          reason: parsed.reason,
        };
      }
    } catch (error) {
      logger.error(`安装决策失败: ${error}`);
    }
    
    // 默认返回最佳结果
    return {
      shouldInstall: best.relevance >= 0.8,
      skillSlug: best.slug,
      confidence: best.relevance,
      reason: `相关性: ${best.relevance}`,
    };
  }
  
  /**
   * 安装技能
   */
  async installSkill(slug: string): Promise<{ success: boolean; message: string }> {
    logger.info(`安装技能: ${slug}`);
    
    const result = await this.clawHub.install(slug);
    
    if (result.success) {
      // 重新加载技能注册表
      // this.skillRegistry.reload();
      
      return {
        success: true,
        message: result.message || `技能 ${slug} 安装成功`,
      };
    }
    
    return {
      success: false,
      message: result.error || `技能 ${slug} 安装失败`,
    };
  }
  
  /**
   * 处理能力缺口（完整流程）
   */
  async handleGap(userInput: string): Promise<{
    gap: CapabilityGap | null;
    searchResults: SkillSearchResult[];
    decision: InstallDecision | null;
    installed: boolean;
    message: string;
  }> {
    if (!this.config.enabled) {
      return {
        gap: null,
        searchResults: [],
        decision: null,
        installed: false,
        message: '自动安装已禁用',
      };
    }
    
    // 1. 检测缺口
    const gap = await this.detectGap(userInput);
    
    if (!gap) {
      return {
        gap: null,
        searchResults: [],
        decision: null,
        installed: false,
        message: '未检测到能力缺口',
      };
    }
    
    // 2. 搜索技能
    const searchQuery = gap.suggestedSkills.join(' ') || gap.missingCapabilities.join(' ');
    const searchResults = await this.searchSkills(searchQuery);
    
    if (searchResults.length === 0) {
      return {
        gap,
        searchResults: [],
        decision: null,
        installed: false,
        message: `检测到能力缺口: ${gap.missingCapabilities.join(', ')}，但未找到相关技能`,
      };
    }
    
    // 3. 决定是否安装
    const decision = await this.decideInstall(gap, searchResults);
    
    if (!decision.shouldInstall) {
      return {
        gap,
        searchResults,
        decision,
        installed: false,
        message: `找到技能 ${decision.skillSlug}，但建议不安装: ${decision.reason}`,
      };
    }
    
    // 4. 检查是否需要确认
    if (this.config.requireApproval && !this.config.autoInstall) {
      return {
        gap,
        searchResults,
        decision,
        installed: false,
        message: `建议安装技能 ${decision.skillSlug}，需要用户确认`,
      };
    }
    
    // 5. 安装
    const installResult = await this.installSkill(decision.skillSlug!);
    
    return {
      gap,
      searchResults,
      decision,
      installed: installResult.success,
      message: installResult.message,
    };
  }
  
  /**
   * 计算相关性分数
   */
  private calculateRelevance(query: string, result: ClawHubSearchResult): number {
    const queryLower = query.toLowerCase();
    const nameLower = result.displayName.toLowerCase();
    const summaryLower = result.summary.toLowerCase();
    
    let score = 0;
    
    // 名称完全匹配
    if (nameLower.includes(queryLower)) {
      score += 0.5;
    }
    
    // 摘要包含关键词
    const queryWords = queryLower.split(/\s+/);
    for (const word of queryWords) {
      if (summaryLower.includes(word)) {
        score += 0.1;
      }
    }
    
    // ClawHub 自身分数
    score += result.score * 0.3;
    
    return Math.min(score, 1);
  }
  
  /**
   * 更新配置
   */
  updateConfig(config: Partial<AutoInstallerConfig>): void {
    this.config = { ...this.config, ...config };
  }
  
  /**
   * 获取配置
   */
  getConfig(): AutoInstallerConfig {
    return { ...this.config };
  }
}

// ═══════════════════════════════════════════════════════════════
// 全局实例
// ═══════════════════════════════════════════════════════════════

let globalAutoInstaller: AutoSkillInstaller | null = null;

export function getAutoInstaller(): AutoSkillInstaller {
  if (!globalAutoInstaller) {
    globalAutoInstaller = new AutoSkillInstaller();
  }
  return globalAutoInstaller;
}

export function resetAutoInstaller(): void {
  globalAutoInstaller = null;
}

// ═══════════════════════════════════════════════════════════════
// 便捷函数
// ═══════════════════════════════════════════════════════════════

/**
 * 检测能力缺口
 */
export async function detectCapabilityGap(userInput: string): Promise<CapabilityGap | null> {
  return getAutoInstaller().detectGap(userInput);
}

/**
 * 搜索技能
 */
export async function searchSkills(query: string): Promise<SkillSearchResult[]> {
  return getAutoInstaller().searchSkills(query);
}

/**
 * 处理能力缺口
 */
export async function handleCapabilityGap(userInput: string): Promise<{
  gap: CapabilityGap | null;
  installed: boolean;
  message: string;
}> {
  const result = await getAutoInstaller().handleGap(userInput);
  return {
    gap: result.gap,
    installed: result.installed,
    message: result.message,
  };
}
