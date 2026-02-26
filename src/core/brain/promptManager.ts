/**
 * 提示词管理器
 * 
 * 分层架构，按需加载，优化Token消耗：
 * - Layer 1: 核心人格（常驻，~50 tokens）
 * - Layer 2: 决策规则（按场景，~100 tokens）
 * - Layer 3: 技能定义（按需，~50 tokens/技能）
 * - Layer 4: 上下文摘要（追问时，~50 tokens）
 */

import { getSkillRegistry } from '../../skills/registry';
import { getLogger } from '../../observability/logger';
import { DecisionType, PromptBuildOptions } from '../../types/stream';

const logger = getLogger('core:prompt');

/**
 * 提示词管理器
 */
export class PromptManager {
  // === Layer 1: 核心人格（常驻） ===
  private corePersonality = `你是白泽，一个智能助手。

## 输出格式（必须严格遵守）
只输出一个JSON对象，不要输出其他任何内容。
必须包含 "action" 字段，值为以下之一：
- "ask_missing" - 缺少参数
- "tool_call" - 调用工具
- "reply" - 直接回答
- "unable" - 无法完成`;

  // === Layer 2: 决策规则（按场景） ===
  private decisionRules = {
    simple: `## 决策规则

根据用户输入选择一个action：

1. ask_missing - 用户想用工具但没提供必要参数
   输出: {"action": "ask_missing", "missing": ["缺少的参数名"], "question": "询问用户的话"}

2. tool_call - 用户提供了完整参数，可以调用工具
   输出: {"action": "tool_call", "tool": "工具名", "params": {"参数名": "参数值"}}

3. reply - 简单闲聊，不需要工具
   输出: {"action": "reply", "response": "回复内容"}

4. unable - 没有对应工具
   输出: {"action": "unable", "message": "说明原因"}

注意：tool和params必须用英文键名！`,

    complex: `## 决策规则

1. 检查用户是否提供了必要参数
2. 选择正确的action
3. 只输出JSON，键名用英文`,

    followUp: `## 决策规则（追问）

结合上下文判断：
- 如果上下文有答案，直接回答
- 如果需要新查询，使用上下文中的参数
- 只输出JSON格式`
  };

  // === Layer 3: 技能定义缓存 ===
  private skillDefinitions: Map<string, string> = new Map();

  /**
   * 构建提示词
   */
  buildPrompt(options: PromptBuildOptions): string {
    const parts: string[] = [];

    // Layer 1: 核心人格（始终加载）
    parts.push(this.corePersonality);

    // Layer 2: 决策规则
    parts.push('\n' + this.decisionRules[options.decisionType]);

    // Layer 3: 技能定义（按需）
    if (options.skills && options.skills.length > 0) {
      parts.push('\n## 可用工具\n');
      for (const skillName of options.skills) {
        parts.push(this.getSkillDefinition(skillName));
      }
    }

    // Layer 4: 上下文摘要（追问时）
    if (options.contextSummary) {
      parts.push('\n## 上下文\n' + options.contextSummary);
    }

    const prompt = parts.join('\n');
    logger.debug(`构建提示词: ${prompt.length} chars, ~${Math.ceil(prompt.length / 4)} tokens`);
    
    return prompt;
  }

  /**
   * 获取技能定义（带缓存）
   */
  private getSkillDefinition(skillName: string): string {
    if (!this.skillDefinitions.has(skillName)) {
      const skill = getSkillRegistry().get(skillName);
      if (skill) {
        this.skillDefinitions.set(skillName, this.formatSkillDefinition(skill));
      }
    }
    return this.skillDefinitions.get(skillName) || '';
  }

  /**
   * 格式化技能定义（精简版）
   */
  private formatSkillDefinition(skill: any): string {
    const props = skill.inputSchema?.properties || {};
    const required = skill.inputSchema?.required || [];
    
    let params = '';
    if (Object.keys(props).length > 0) {
      params = Object.entries(props)
        .map(([key, prop]: [string, any]) => {
          const isRequired = required.includes(key);
          return `${key}${isRequired ? '*' : ''}: ${prop.description || prop.type || ''}`;
        })
        .join(', ');
    }
    
    // 如果没有inputSchema，从描述推断
    if (!params && skill.description) {
      // 天气技能特殊处理
      if (skill.name === 'weather') {
        params = 'location*: 城市名称';
      }
    }
    
    const paramsStr = params ? `参数: ${params}` : '';
    
    return `### ${skill.name}
${skill.description}
${paramsStr}
`;
  }

  /**
   * 预加载技能定义
   */
  preloadSkills(skillNames: string[]): void {
    for (const name of skillNames) {
      this.getSkillDefinition(name);
    }
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.skillDefinitions.clear();
  }
}

// 单例
let instance: PromptManager | null = null;

export function getPromptManager(): PromptManager {
  if (!instance) {
    instance = new PromptManager();
  }
  return instance;
}

export function resetPromptManager(): void {
  instance = null;
}
