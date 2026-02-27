/**
 * 浏览器自动化技能
 * 
 * 将 BrowserTool 包装为技能，以便被 ReAct 执行器调用
 */

import { Skill } from './base';
import { SkillResult, SkillContext, RiskLevel } from '../types';
import { BrowserTool } from '../tools/browser';
import { getLogger } from '../observability/logger';

const logger = getLogger('skill:browser');

/**
 * 浏览器自动化技能
 */
export class BrowserSkill extends Skill {
  private browserTool = new BrowserTool();

  get name(): string {
    return 'browser';
  }

  get description(): string {
    return this.browserTool.description;
  }

  get whenToUse(): string {
    return `当用户需要以下操作时使用浏览器自动化：
- 访问网页、浏览网站
- 点击按钮、链接
- 填写表单、输入文本
- 提取网页内容
- 截取网页截图
- 执行网页自动化任务`;
  }

  get capabilities(): string[] {
    return [
      'browser_automation',
      'web_navigation',
      'web_scraping',
      'form_filling',
      'screenshot',
      'click',
      'typing',
      'scrolling',
    ];
  }

  get riskLevel(): RiskLevel {
    return RiskLevel.MEDIUM;
  }

  get inputSchema(): Record<string, unknown> {
    return this.browserTool.parameters;
  }

  async run(params: Record<string, unknown>, context: SkillContext): Promise<SkillResult> {
    logger.info('执行浏览器技能', { action: params.action });
    
    const result = await this.browserTool.execute(params, context);
    
    return {
      success: result.success,
      data: result.data as unknown as Record<string, unknown> || {},
      message: result.success 
        ? (result.data as any)?.message || '浏览器操作成功'
        : undefined,
      error: result.error,
    };
  }
}

// 全局实例
let browserSkillInstance: BrowserSkill | null = null;

/**
 * 获取浏览器技能实例
 */
export function getBrowserSkill(): BrowserSkill {
  if (!browserSkillInstance) {
    browserSkillInstance = new BrowserSkill();
  }
  return browserSkillInstance;
}

/**
 * 重置浏览器技能（测试用）
 */
export function resetBrowserSkill(): void {
  browserSkillInstance = null;
}
