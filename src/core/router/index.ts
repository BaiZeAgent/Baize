/**
 * 智能路由器 - 双层决策机制
 *
 * 核心功能：
 * 1. 单次LLM调用判断任务复杂度
 * 2. 简单任务走快速路径（直接执行）
 * 3. 复杂任务走规划路径（六阶段思考）
 *
 * 设计原则：
 * - 不硬编码规则，让LLM自己判断
 * - 描述"什么情况需要规划"，而非列举规则
 * - 不确定时默认走规划路径，确保安全
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
  /** 决策类型 */
  action: 'reply' | 'tool' | 'plan';
  /** 直接回复内容（action=reply时） */
  content?: string;
  /** 工具名称（action=tool时） */
  toolName?: string;
  /** 工具参数（action=tool时） */
  toolParams?: Record<string, unknown>;
  /** 规划原因（action=plan时） */
  reason?: string;
}

/**
 * 路由上下文
 */
export interface RouteContext {
  /** 用户输入 */
  userInput: string;
  /** 会话ID */
  sessionId?: string;
  /** 历史对话摘要 */
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
   * 单次LLM调用，让LLM自己判断任务复杂度
   */
  async route(context: RouteContext): Promise<RouteDecision> {
    const { userInput, historySummary } = context;

    logger.debug(`[router-start] input=${userInput.slice(0, 50)}...`);

    // 构建技能列表描述
    const skillsDescription = this.buildSkillsDescription();

    // 构建系统提示
    const systemPrompt = this.buildSystemPrompt(skillsDescription, historySummary);

    // 构建消息
    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userInput },
    ];

    try {
      // 单次LLM调用
      const response = await this.llm.chat(messages, { temperature: 0.1 });
      const decision = this.parseDecision(response.content);

      logger.info(`[router-decision] action=${decision.action}`, {
        toolName: decision.toolName,
        reason: decision.reason,
      });

      return decision;
    } catch (error) {
      logger.error(`[router-error] ${error}`);
      // 出错时默认走规划路径，确保安全
      return {
        action: 'plan',
        reason: '路由决策失败，降级到规划路径',
      };
    }
  }

  /**
   * 构建技能列表描述
   */
  private buildSkillsDescription(): string {
    const skills = this.skillRegistry.getAll();

    if (skills.length === 0) {
      return '暂无可用技能';
    }

    return skills
      .map((s) => `- ${s.name}: ${s.description}`)
      .join('\n');
  }

  /**
   * 构建系统提示
   *
   * 关键：描述"什么情况需要规划"，而非硬编码规则
   */
  private buildSystemPrompt(
    skillsDescription: string,
    historySummary?: string
  ): string {
    let prompt = `你是白泽的智能路由器。分析用户需求，选择最合适的处理方式。

## 可用技能
${skillsDescription}

## 选择标准

### 直接回复 (reply)
当你可以直接回答，不需要外部信息或操作时。
例如：问候、感谢、简单问答、知识解释。

### 调用工具 (tool)
当需要单一明确的操作，且你清楚该调用哪个工具时。
例如：读取文件、查询天气、执行命令。

### 需要规划 (plan)
当你不确定如何完成，或存在以下情况时：
- 需要多个步骤，且步骤之间有依赖关系
- 需要根据中间结果决定下一步
- 涉及高风险操作，需要评估
- 任务复杂度超出单次工具调用
- 需要协调多个资源

## 重要规则
1. 优先选择简单路径（reply > tool > plan）
2. 不确定时选择"需要规划"
3. 只返回JSON，不要解释

## 返回格式
{"action": "reply", "content": "回复内容"}
{"action": "tool", "toolName": "工具名", "toolParams": {...}}
{"action": "plan", "reason": "为什么需要规划"}`;

    if (historySummary) {
      prompt += `\n\n## 最近对话摘要\n${historySummary}`;
    }

    return prompt;
  }

  /**
   * 解析LLM返回的决策
   */
  private parseDecision(content: string): RouteDecision {
    // 尝试提取JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      // 没有JSON，当作直接回复
      return {
        action: 'reply',
        content: content,
      };
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]);

      // 验证action字段
      const action = parsed.action as string;

      if (action === 'reply') {
        return {
          action: 'reply',
          content: parsed.content as string || '',
        };
      }

      if (action === 'tool') {
        return {
          action: 'tool',
          toolName: parsed.toolName as string,
          toolParams: parsed.toolParams as Record<string, unknown> || {},
        };
      }

      if (action === 'plan') {
        return {
          action: 'plan',
          reason: parsed.reason as string || '需要规划',
        };
      }

      // 未知action，走规划路径
      return {
        action: 'plan',
        reason: `未知action类型: ${action}`,
      };
    } catch (error) {
      // JSON解析失败，当作直接回复
      return {
        action: 'reply',
        content: content,
      };
    }
  }
}

// 全局实例
let routerInstance: SmartRouter | null = null;

/**
 * 获取智能路由器实例
 */
export function getSmartRouter(): SmartRouter {
  if (!routerInstance) {
    routerInstance = new SmartRouter();
  }
  return routerInstance;
}

/**
 * 重置路由器实例（测试用）
 */
export function resetSmartRouter(): void {
  routerInstance = null;
}
