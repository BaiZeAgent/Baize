/**
 * 能力缺口检测器 - OpenClaw 风格
 * 
 * 核心逻辑：
 * 1. 让 LLM 判断用户需求是否能被现有技能满足
 * 2. 如果不能，识别缺失的能力
 * 3. 不使用硬编码映射，完全由 LLM 理解
 */

import { getLogger } from '../../observability/logger';
import { getLLMManager } from '../../llm';
import { CapabilityGap, SkillInfo } from '../../types';

const logger = getLogger('evolution:gap');

/**
 * 能力缺口检测器
 */
export class CapabilityGapDetector {
  private llm = getLLMManager();

  /**
   * 检测能力缺口
   */
  async detect(userInput: string, availableSkills: SkillInfo[]): Promise<CapabilityGap | null> {
    logger.debug('开始检测能力缺口', { input: userInput.slice(0, 50) });

    // 构建技能列表描述
    const skillsDesc = availableSkills.length > 0
      ? availableSkills.map(s => {
          let desc = `- ${s.name}: ${s.description}`;
          if (s.whenToUse) {
            desc += ` (适用: ${s.whenToUse})`;
          }
          if (s.capabilities && s.capabilities.length > 0) {
            desc += ` [能力: ${s.capabilities.join(', ')}]`;
          }
          return desc;
        }).join('\n')
      : '(无已安装技能)';

    const prompt = `你是白泽的能力缺口检测器。分析用户需求是否能被现有技能满足。

## 用户需求
${userInput}

## 现有技能
${skillsDesc}

## 任务
1. 判断用户需求是否能被现有技能满足
2. 如果不能，识别缺失的能力

## 返回格式（只返回JSON，不要解释）
如果能满足：
{"hasGap": false}

如果不能：
{"hasGap": true, "missingCapabilities": ["能力1", "能力2"], "suggestedSkillNames": ["建议技能名"], "confidence": 0.8}`;

    try {
      const response = await this.llm.chat([
        { role: 'user', content: prompt }
      ], { temperature: 0.1 });

      // 解析 JSON
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.debug('无法解析缺口检测结果');
        return null;
      }

      const result = JSON.parse(jsonMatch[0]);

      if (!result.hasGap) {
        logger.debug('无能力缺口');
        return null;
      }

      const gap: CapabilityGap = {
        id: `gap_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        detectedAt: new Date(),
        userInput,
        understanding: {
          literalMeaning: userInput,
          implicitIntent: '',
          context: {},
          constraints: [],
          coreNeed: userInput,
        },
        missingCapabilities: result.missingCapabilities || [],
        suggestedSkills: result.suggestedSkillNames || [],
        confidence: result.confidence || 0.5,
        resolution: 'pending',
      };

      logger.info('检测到能力缺口', {
        missing: gap.missingCapabilities,
        suggested: gap.suggestedSkills,
        confidence: Math.round(gap.confidence * 100) + '%',
      });

      return gap;

    } catch (error) {
      logger.error(`能力缺口检测失败: ${error}`);
      return null;
    }
  }

  /**
   * 生成用户提示消息
   */
  generatePrompt(gap: CapabilityGap): string {
    const missing = gap.missingCapabilities.join('、');
    const suggested = gap.suggestedSkills.length > 0 
      ? `\n\n建议安装的技能: ${gap.suggestedSkills.join('、')}` 
      : '';

    return `我发现缺少以下能力: ${missing}${suggested}

是否需要我：
1. 从技能市场搜索并安装
2. 尝试用其他方式解决
3. 暂时忽略

请告诉我你的选择。`;
  }

  /**
   * 检查是否需要用户确认
   */
  needsConfirmation(gap: CapabilityGap): boolean {
    return gap.confidence < 0.8;
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

export function resetGapDetector(): void {
  gapDetector = null;
}
