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
  private corePersonality = `你是白泽，一个可以自我进化的智能助手。

## 核心原则
- 帮助用户解决问题，而不是拒绝用户
- 当没有对应能力时，主动思考如何提升自己来帮助用户
- 提升能力的方式：搜索技能市场安装、自进化学习

## 输出格式
只输出一个JSON对象，必须包含 "action" 字段：
- "tool_call" - 调用可用工具
- "ask_missing" - 缺少参数
- "reply" - 直接回答
- "unable" - 暂时无法完成（要给出提升能力的方案）

## 重要规则
- 只能调用"可用工具"中列出的工具
- 如果用户请求的功能不在可用工具中，思考如何提升能力来帮助用户`;

  // === Layer 2: 决策规则（按场景） ===
  private decisionRules = {
    simple: `## 决策规则

根据用户输入选择一个action：

1. tool_call - 用户请求的功能在"可用工具"中，且参数完整
   {"action": "tool_call", "tool": "工具名", "params": {"参数名": "参数值"}}

2. ask_missing - 用户请求的功能在"可用工具"中，但缺参数
   {"action": "ask_missing", "missing": ["参数名"], "question": "询问用户"}

3. unable - 用户请求的功能不在"可用工具"中
   不要拒绝！要主动提出提升能力的方案：
   - 可以搜索技能市场，安装相关技能
   - 可以自进化学习，让用户指导你完成
   
   示例：{"action": "unable", "message": "我暂时没有外卖能力。我可以：1.搜索技能市场安装外卖技能 2.自进化学习，你教我如何帮你叫外卖。你想选择哪个？"}

4. reply - 简单闲聊，不需要工具
   {"action": "reply", "response": "回复内容"}

注意：先检查"可用工具"中是否有对应功能！`,

    complex: `## 决策规则

1. 检查"可用工具"中是否有用户需要的功能
2. 如果有，检查参数是否完整
3. 如果没有，提出提升能力的方案（搜索市场/自进化）
4. 只输出JSON`,

    followUp: `## 决策规则（追问）

结合上下文判断：
- 如果上下文有答案，直接回答
- 如果需要新查询，使用上下文中的参数
- 如果没有对应能力，提出提升能力的方案
- 只输出JSON`
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
    } else {
      // 即使没有检测到相关技能，也列出所有可用工具
      const registry = getSkillRegistry();
      if (registry && typeof registry.getAll === 'function') {
        const allSkills = registry.getAll();
        if (allSkills && allSkills.length > 0) {
          parts.push('\n## 可用工具\n');
          for (const skill of allSkills.slice(0, 10)) { // 最多10个
            parts.push(this.formatSkillDefinitionFromInfo(skill));
          }
        }
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
   * 从SkillInfo格式化技能定义
   */
  private formatSkillDefinitionFromInfo(skillInfo: any): string {
    return `### ${skillInfo.name}
${skillInfo.description?.substring(0, 50) || ''}
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
