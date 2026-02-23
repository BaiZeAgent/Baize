/**
 * 能力缺口检测器 - 检测系统缺失的能力
 * 
 * 第九章 9.2 能力缺口检测
 * 
 * 功能：
 * 1. 分析任务需求
 * 2. 匹配现有能力
 * 3. 识别能力缺口
 * 4. 建议解决方案
 */

import { getLogger } from '../../observability/logger';
import { CapabilityGap, Understanding, SkillInfo } from '../../types';

const logger = getLogger('evolution:gap');

/**
 * 关键词到能力的映射
 */
const KEYWORD_CAPABILITY_MAP: Record<string, string[]> = {
  '天气': ['weather', 'forecast', 'temperature'],
  '股票': ['stock', 'finance', 'trading'],
  '翻译': ['translate', 'language', 'multilingual'],
  '邮件': ['email', 'mail', 'smtp'],
  '日程': ['calendar', 'schedule', 'reminder'],
  '新闻': ['news', 'rss', 'feed'],
  '地图': ['map', 'location', 'navigation'],
  '图片': ['image', 'vision', 'ocr'],
  '音频': ['audio', 'speech', 'tts', 'stt'],
  '视频': ['video', 'streaming'],
  '数据库': ['database', 'sql', 'query'],
  '网络': ['network', 'http', 'api', 'web'],
};

/**
 * 能力缺口检测器
 */
export class CapabilityGapDetector {
  /**
   * 检测能力缺口
   */
  async detect(understanding: Understanding, availableSkills: any[]): Promise<CapabilityGap | null> {
    logger.debug('开始检测能力缺口', { coreNeed: understanding.coreNeed });

    // 1. 分析任务需求
    const requiredCapabilities = this.analyzeRequirements(understanding);
    
    if (requiredCapabilities.length === 0) {
      return null; // 无法确定需求
    }

    // 2. 获取现有能力
    const availableCapabilities = this.getAvailableCapabilities(availableSkills);

    // 3. 计算缺口
    const missingCapabilities = requiredCapabilities.filter(
      cap => !availableCapabilities.some(avail => this.matches(cap, avail))
    );

    if (missingCapabilities.length === 0) {
      return null; // 无缺口
    }

    // 4. 计算置信度
    const confidence = this.calculateConfidence(understanding, missingCapabilities);

    // 5. 生成建议
    const suggestedSkills = await this.suggestSkills(missingCapabilities);

    const gap: CapabilityGap = {
      id: `gap_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      detectedAt: new Date(),
      userInput: understanding.coreNeed,
      understanding,
      missingCapabilities,
      suggestedSkills,
      confidence,
      resolution: 'pending',
    };

    logger.info('检测到能力缺口', {
      missing: missingCapabilities,
      confidence: Math.round(confidence * 100) + '%',
      suggested: suggestedSkills
    });

    return gap;
  }

  /**
   * 分析任务需求
   */
  private analyzeRequirements(understanding: Understanding): string[] {
    const requirements: string[] = [];
    const text = (understanding.coreNeed + ' ' + (understanding.literalMeaning || '')).toLowerCase();

    for (const [keyword, capabilities] of Object.entries(KEYWORD_CAPABILITY_MAP)) {
      if (text.includes(keyword.toLowerCase())) {
        requirements.push(...capabilities);
      }
    }

    // 去重
    return [...new Set(requirements)];
  }

  /**
   * 获取现有能力
   */
  private getAvailableCapabilities(skills: any[]): string[] {
    const capabilities: string[] = [];
    
    for (const skill of skills) {
      if (skill.capabilities) {
        capabilities.push(...skill.capabilities);
      }
    }

    return [...new Set(capabilities)];
  }

  /**
   * 匹配能力
   */
  private matches(required: string, available: string): boolean {
    const r = required.toLowerCase();
    const a = available.toLowerCase();
    return r === a || r.includes(a) || a.includes(r);
  }

  /**
   * 计算置信度
   */
  private calculateConfidence(understanding: Understanding, missing: string[]): number {
    // 基于关键词匹配数量计算置信度
    let score = 0.5; // 基础分

    // 如果用户明确提到"开发"或"创建"技能
    if (understanding.coreNeed.includes('开发') || 
        understanding.coreNeed.includes('创建') ||
        understanding.coreNeed.includes('新技能')) {
      score += 0.3;
    }

    // 如果有多个缺失能力，置信度降低
    if (missing.length > 3) {
      score -= 0.2;
    }

    return Math.min(1, Math.max(0, score));
  }

  /**
   * 建议技能
   */
  private async suggestSkills(missingCapabilities: string[]): Promise<string[]> {
    // 简化实现：返回缺失能力对应的技能名称
    const suggestions: string[] = [];

    for (const cap of missingCapabilities) {
      // 尝试将能力转换为技能名
      const skillName = cap.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      if (!suggestions.includes(skillName)) {
        suggestions.push(skillName);
      }
    }

    return suggestions.slice(0, 3); // 最多返回3个建议
  }

  /**
   * 检查是否需要用户确认
   */
  needsConfirmation(gap: CapabilityGap): boolean {
    return gap.confidence < 0.8;
  }

  /**
   * 生成用户提示消息
   */
  generatePrompt(gap: CapabilityGap): string {
    const missing = gap.missingCapabilities.join(', ');
    
    if (gap.confidence >= 0.8) {
      return `我发现可能需要以下能力: ${missing}\n是否需要我从技能市场安装或开发新技能？`;
    } else {
      return `我注意到可能缺少以下能力: ${missing}\n请问您是否需要我获取这些能力？`;
    }
  }
}

// 全局实例
let gapDetector: CapabilityGapDetector | null = null;

export function getGapDetector(): CapabilityGapDetector {
  if (!gapDetector) {
    gapDetector = new CapabilityGapDetector();
  }
  return gapDetector;
}
