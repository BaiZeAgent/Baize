/**
 * 智能路由器 - OpenClaw 风格
 * 
 * 核心逻辑：
 * 1. 根据技能 when_to_use 关键词直接匹配
 * 2. 不匹配则让 LLM 根据技能文档判断
 */

import { LLMMessage } from '../../types';
import { getLLMManager } from '../../llm';
import { getSkillRegistry } from '../../skills/registry';
import { getLogger } from '../../observability/logger';

const logger = getLogger('core:router');

/**
 * 路由决策结果
 */
export interface RouteDecision {
  action: 'reply' | 'tool' | 'plan';
  content?: string;
  toolName?: string;
  toolParams?: Record<string, unknown>;
  reason?: string;
}

/**
 * 路由上下文
 */
export interface RouteContext {
  userInput: string;
  sessionId?: string;
  historySummary?: string;
}

/**
 * 智能路由器
 */
export class SmartRouter {
  private llm = getLLMManager();
  private skillRegistry = getSkillRegistry();

  /**
   * 路由决策
   */
  async route(context: RouteContext): Promise<RouteDecision> {
    const { userInput } = context;
    const input = userInput.toLowerCase();

    logger.debug(`[router] input=${userInput.slice(0, 50)}...`);

    // 1. 根据技能 when_to_use 关键词匹配
    const skills = this.skillRegistry.getAll();
    
    for (const skill of skills) {
      if (skill.whenToUse) {
        const keywords = skill.whenToUse.toLowerCase().split(/\s+/).filter(k => k.length > 0);
        for (const keyword of keywords) {
          if (input.includes(keyword)) {
            logger.info(`[router-match] skill=${skill.name} keyword=${keyword}`);
            return {
              action: 'tool',
              toolName: skill.name,
              toolParams: {},
            };
          }
        }
      }
    }

    // 2. 简单问候直接回复
    const greetings = ['你好', '您好', 'hi', 'hello', '嗨', '早上好', '晚上好'];
    if (greetings.some(g => input.includes(g)) && input.length < 20) {
      return {
        action: 'reply',
        content: '你好！有什么可以帮助你的吗？',
      };
    }

    // 3. 复杂情况让 LLM 判断
    return this.llmRoute(userInput, skills);
  }

  /**
   * LLM 路由判断
   */
  private async llmRoute(userInput: string, skills: any[]): Promise<RouteDecision> {
    const skillsDesc = skills.map(s => {
      let desc = `- ${s.name}: ${s.description}`;
      if (s.whenToUse) {
        desc += ` (触发词: ${s.whenToUse})`;
      }
      return desc;
    }).join('\n');

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是白泽的路由器。根据用户输入选择最合适的处理方式。

## 可用技能
${skillsDesc}

## 返回格式（只返回JSON）
{"action": "reply", "content": "直接回复内容"}
{"action": "tool", "toolName": "技能名", "toolParams": {}}
{"action": "plan", "reason": "需要规划的原因"}`
      },
      { role: 'user', content: userInput }
    ];

    try {
      const response = await this.llm.chat(messages, { temperature: 0.1 });
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        logger.info(`[router-llm] action=${parsed.action}`);
        return parsed;
      }
    } catch (error) {
      logger.error(`[router-error] ${error}`);
    }

    return { action: 'plan', reason: '无法判断' };
  }
}

// 全局实例
let routerInstance: SmartRouter | null = null;

export function getSmartRouter(): SmartRouter {
  if (!routerInstance) {
    routerInstance = new SmartRouter();
  }
  return routerInstance;
}

export function resetSmartRouter(): void {
  routerInstance = null;
}
