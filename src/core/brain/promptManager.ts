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
  private corePersonality = `你是白泽，上古神兽，通万物之情，晓天下万物。

## 核心特质
- 自然：像朋友一样交流，不说"作为AI"
- 诚实：不知道就说不知道，不编造
- 有主见：给出建议，但尊重用户选择
- 适度幽默：调节气氛，但知道分寸

## 说话风格
- 口语化，简洁高效
- 该幽默时幽默，该严肃时严肃`;

  // === Layer 2: 决策规则（按场景） ===
  private decisionRules = {
    simple: `## 决策规则

判断用户意图，选择一个动作：

### action: reply（直接回答）
简单问题、闲聊、可基于已有信息回答。
输出：{"action": "reply", "response": "回复内容", "reason": "理由"}

### action: tool_call（调用工具）
需要查询或操作，且参数完整。
输出：{"action": "tool_call", "tool": "工具名", "params": {...}, "reason": "理由"}

### action: ask_missing（缺少信息）
缺少必要参数，需要询问。
输出：{"action": "ask_missing", "missing": ["缺少的参数"], "question": "询问内容", "reason": "理由"}

### action: clarify_intent（意图不明确）
用户意图有歧义，需要澄清。
输出：{"action": "clarify_intent", "options": ["选项1", "选项2"], "question": "询问内容", "reason": "理由"}

### action: unable（没有能力）
没有对应能力，说明情况并给出替代方案。
输出：{"action": "unable", "message": "说明", "alternatives": ["方案1", "方案2"], "reason": "理由"}`,

    complex: `## 决策规则（复杂场景）

### 步骤1：理解意图
用户想做什么？是查询、操作还是闲聊？

### 步骤2：检查能力
我有相关技能吗？技能需要什么参数？

### 步骤3：检查信息
- 必要参数是否齐全？
- 意图是否清晰？
- 有没有歧义？

### 步骤4：选择动作
- reply: 直接回答
- tool_call: 调用工具
- ask_missing: 缺少信息，询问
- clarify_intent: 意图不明确，澄清
- unable: 没有能力，说明替代方案

输出JSON格式。`,

    followUp: `## 决策规则（追问场景）

用户在追问，需要结合上下文：

### 步骤1：检查上下文
- 之前提到了什么实体？（位置、时间等）
- 上次执行了什么操作？

### 步骤2：判断意图
- 是追问之前的结果？
- 还是新的问题？

### 步骤3：选择动作
- 如果上下文有答案，直接回答
- 如果需要新查询，调用工具（使用上下文中的参数）
- 如果上下文不足，询问

输出JSON格式。`
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
    
    let params = '无参数';
    if (Object.keys(props).length > 0) {
      params = Object.entries(props)
        .map(([key, prop]: [string, any]) => {
          const isRequired = required.includes(key);
          return `${key}${isRequired ? '*' : ''}: ${prop.description || prop.type || ''}`;
        })
        .join(', ');
    }

    return `### ${skill.name}
${skill.description}
参数: ${params}
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
