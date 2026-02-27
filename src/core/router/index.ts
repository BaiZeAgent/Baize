/**
 * 智能路由器 - OpenClaw 风格
 * 
 * 核心逻辑：
 * 1. 先让 LLM 判断用户意图和选择工具
 * 2. 如果 LLM 选择了不存在的工具，返回 plan 触发能力缺口检测
 * 3. 简单问候直接回复
 */

import { LLMMessage } from '../../types';
import { getLLMManager } from '../../llm';
import { getSkillRegistry } from '../../skills/registry';
import { getToolRegistry } from '../../tools';
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
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

/**
 * 智能路由器
 */
export class SmartRouter {
  private llm = getLLMManager();
  private skillRegistry = getSkillRegistry();
  private toolRegistry = getToolRegistry();

  /**
   * 路由决策
   */
  async route(context: RouteContext): Promise<RouteDecision> {
    const { userInput, history = [] } = context;
    const input = userInput.toLowerCase();

    logger.debug(`[router] input=${userInput.slice(0, 50)}...`);

    // 1. 简单问候直接回复
    const greetings = ['你好', '您好', 'hi', 'hello', '嗨', '早上好', '晚上好'];
    const isOnlyGreeting = greetings.some(g => input.includes(g)) && 
                           input.length < 15 && 
                           !input.includes('吗') && 
                           !input.includes('？');
    
    if (isOnlyGreeting) {
      const replies = [
        '你好！有什么可以帮助你的吗？',
        '嗨！有什么问题随时问我。',
        '你好呀！今天想聊点什么？',
      ];
      return {
        action: 'reply',
        content: replies[Math.floor(Math.random() * replies.length)],
      };
    }

    // 2. 让 LLM 判断
    return this.llmRoute(userInput, history);
  }

  /**
   * LLM 路由判断
   */
  private async llmRoute(
    userInput: string, 
    history: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<RouteDecision> {
    // 构建工具列表
    const tools = this.toolRegistry.getAll().map((t: any) => ({
      name: t.name,
      description: t.description,
      type: 'builtin' as const,
    }));

    const skills = this.skillRegistry.getAll().map((s: any) => ({
      name: s.name,
      description: s.description,
      whenToUse: s.whenToUse,
      type: 'skill' as const,
    }));

    const allTools = [...tools, ...skills];

    const toolsDesc = allTools.map((t: any) => {
      let desc = `- ${t.name}: ${t.description}`;
      if (t.whenToUse) {
        desc += ` (适用场景: ${t.whenToUse})`;
      }
      return desc;
    }).join('\n');

    // 构建历史摘要
    const historyText = history.slice(-6).map(h => 
      `${h.role === 'user' ? '用户' : '白泽'}: ${h.content}`
    ).join('\n');

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是白泽的路由器。分析用户意图并选择最合适的处理方式。

## 可用工具
${toolsDesc || '(无可用工具)'}

## 对话历史
${historyText || '(无历史)'}

## 重要规则
1. 只有当用户明确想要"使用"某个工具的功能时，才调用工具
2. 如果用户只是"询问"或"寻找"某个能力，不要调用工具，返回 plan
3. 如果用户说"找一个可以xxx的技能"，这是在询问能力，返回 plan
4. 如果用户说"帮我xxx"，这是要使用能力，可以调用工具
5. 如果用户问的是之前对话中提到的内容，直接回答，不要调用工具
6. 不要编造不存在的工具名
7. 对于简单问题（如时间、日期），如果有对应工具就调用

## 工具参数说明
- file 技能: action (read/write/create/delete/exists), path, content
- fs 技能: action (ls/mkdir/touch/rm), path
- web_search 工具: query, count, provider
- web_fetch 工具: url, timeout, maxBytes
- memory_search 工具: query, type, limit
- memory_set 工具: key, value, confidence

## 返回格式（只返回JSON，不要解释）
直接回复: {"action": "reply", "content": "回复内容"}
调用工具: {"action": "tool", "toolName": "工具名", "toolParams": {}}
需要规划: {"action": "plan", "reason": "原因"}`
      },
      { role: 'user', content: userInput }
    ];

    try {
      const response = await this.llm.chat(messages, { temperature: 0.1 });
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        // 验证工具是否存在
        if (parsed.action === 'tool' && parsed.toolName) {
          const exists = this.toolRegistry.has(parsed.toolName) || 
                         this.skillRegistry.get(parsed.toolName);
          
          logger.info(`[router] 选择工具: ${parsed.toolName}, 存在: ${!!exists}`);
          
          if (!exists) {
            // 工具不存在，返回 plan 触发能力缺口检测
            logger.warn(`[router] LLM 选择了不存在的工具: ${parsed.toolName}`);
            return { 
              action: 'plan', 
              reason: `工具不存在: ${parsed.toolName}` 
            };
          }
          
          // 确保返回 toolParams
          return {
            action: 'tool',
            toolName: parsed.toolName,
            toolParams: parsed.toolParams || parsed.params || {},
            reason: parsed.reason,
          };
        }
        
        // 处理 memory_search 和 memory_set
        if (parsed.action === 'memory_search') {
          const query = parsed.query || parsed.params?.query || parsed.toolParams?.query || '';
          if (!query) {
            // 如果没有 query，使用用户输入作为查询
            return {
              action: 'tool',
              toolName: 'memory_search',
              toolParams: {
                query: userInput,
                type: parsed.type || parsed.params?.type,
                limit: parsed.limit || parsed.params?.limit || 10,
              },
            };
          }
          return {
            action: 'tool',
            toolName: 'memory_search',
            toolParams: {
              query,
              type: parsed.type || parsed.params?.type,
              limit: parsed.limit || parsed.params?.limit || 10,
            },
          };
        }
        
        if (parsed.action === 'memory_set') {
          return {
            action: 'tool',
            toolName: 'memory_set',
            toolParams: {
              key: parsed.key || parsed.params?.key || '',
              value: parsed.value || parsed.params?.value || '',
              confidence: parsed.confidence || parsed.params?.confidence || 0.8,
            },
          };
        }
        
        logger.info(`[router-llm] action=${parsed.action}`);
        return parsed;
      }
    } catch (error) {
      logger.error(`[router-error] ${error}`);
    }

    // 默认返回 plan，让上层处理
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
