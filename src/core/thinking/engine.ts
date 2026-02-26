/**
 * 思考引擎 - OpenClaw 风格
 * 
 * 核心逻辑：
 * 1. 路由器判断是否需要调用技能
 * 2. 如果需要，直接执行技能
 * 3. 让 LLM 处理结果并回复
 */

import { getSmartRouter, RouteDecision } from '../router';
import { getExecutor } from '../../executor';
import { getLLMManager } from '../../llm';
import { getSkillRegistry } from '../../skills/registry';
import { getLogger } from '../../observability/logger';
import { LLMMessage } from '../../types';

const logger = getLogger('core:thinking');

/**
 * 思考结果
 */
export interface ThinkingResult {
  needSkill: boolean;
  skillName?: string;
  skillResult?: string;
  directResponse?: string;
  duration: number;
}

/**
 * 思考引擎
 */
export class ThinkingEngine {
  private router = getSmartRouter();
  private executor = getExecutor();
  private llm = getLLMManager();
  private skillRegistry = getSkillRegistry();

  /**
   * 处理用户输入
   */
  async think(userInput: string): Promise<ThinkingResult> {
    const startTime = Date.now();
    
    logger.info(`[think] input=${userInput.slice(0, 50)}...`);

    // 1. 路由判断
    const decision = await this.router.route({ userInput });
    
    logger.info(`[route] action=${decision.action}`);

    switch (decision.action) {
      case 'reply':
        return {
          needSkill: false,
          directResponse: decision.content || '好的',
          duration: Date.now() - startTime,
        };

      case 'tool':
        // 执行技能
        const result = await this.executor.executeSkill(
          decision.toolName!,
          decision.toolParams || {}
        );
        
        return {
          needSkill: true,
          skillName: decision.toolName,
          skillResult: result.success 
            ? result.output 
            : `执行失败: ${result.error}`,
          duration: Date.now() - startTime,
        };

      case 'plan':
      default:
        // 复杂任务，让 LLM 处理
        const response = await this.handleComplex(userInput);
        return {
          needSkill: false,
          directResponse: response,
          duration: Date.now() - startTime,
        };
    }
  }

  /**
   * 处理复杂任务
   */
  private async handleComplex(userInput: string): Promise<string> {
    const skills = this.skillRegistry.getAll();
    const skillsDesc = skills.map(s => `- ${s.name}: ${s.description}`).join('\n');

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是白泽，一个智能助手。

## 可用技能
${skillsDesc}

## 规则
1. 如果需要使用技能，返回 JSON: {"skill": "技能名", "params": {...}}
2. 如果可以直接回答，直接回复用户`
      },
      { role: 'user', content: userInput }
    ];

    const response = await this.llm.chat(messages, { temperature: 0.7 });
    return response.content;
  }
}

// 全局实例
let engineInstance: ThinkingEngine | null = null;

export function getThinkingEngine(): ThinkingEngine {
  if (!engineInstance) {
    engineInstance = new ThinkingEngine();
  }
  return engineInstance;
}

export function resetThinkingEngine(): void {
  engineInstance = null;
}
