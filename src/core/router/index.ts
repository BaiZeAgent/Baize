/**
 * 智能路由器 - 企业级版本
 */

import { LLMMessage } from '../../types';
import { getLLMManager } from '../../llm';
import { getSkillRegistry } from '../../skills/registry';
import { getToolRegistry } from '../../tools';
import { getLogger } from '../../observability/logger';
import { runHook } from '../../hooks';
import { checkToolPolicy, PolicyResult, DEFAULT_POLICY_CONFIG } from '../../policy';
import { getApprovalManager, ApprovalResult } from '../../approval';

const logger = getLogger('core:router');

export interface RouteDecision {
  action: 'reply' | 'tool' | 'plan' | 'approval_required';
  content?: string;
  toolName?: string;
  toolParams?: Record<string, unknown>;
  reason?: string;
  requiresApproval?: boolean;
  approvalRequest?: {
    id: string;
    type: string;
    operation: string;
    risk: string;
    message: string;
  };
}

export interface RouteContext {
  userInput: string;
  sessionId?: string;
  userId?: string;
  workspaceDir?: string;
  historySummary?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export class SmartRouter {
  private llm = getLLMManager();
  private skillRegistry = getSkillRegistry();
  private toolRegistry = getToolRegistry();
  
  async route(context: RouteContext): Promise<RouteDecision> {
    const { userInput, history = [], sessionId = 'default', userId, workspaceDir = process.cwd() } = context;
    const input = userInput.toLowerCase();
    
    logger.debug(`[router] input=${userInput.slice(0, 50)}...`);
    
    // 1. 运行前置钩子
    const hookResult = await runHook('before_model_resolve', {
      sessionId,
      userId,
      workspaceDir,
      userInput,
      metadata: {},
    });
    
    if (!hookResult.proceed) {
      return {
        action: 'reply',
        content: hookResult.error || '请求被阻止',
        reason: '钩子拦截',
      };
    }
    
    // 2. 简单问候直接回复
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
    
    // 3. LLM 路由判断
    const decision = await this.llmRoute(userInput, history, sessionId, workspaceDir);
    
    // 4. 如果是工具调用，检查策略
    if (decision.action === 'tool' && decision.toolName) {
      const policyResult = await this.checkPolicy(decision.toolName, decision.toolParams || {}, sessionId);
      
      if (!policyResult.allowed) {
        return {
          action: 'reply',
          content: `操作被阻止: ${policyResult.reason}`,
          reason: policyResult.reason,
        };
      }
      
      if (policyResult.requiresApproval && policyResult.approvalRequest) {
        return {
          action: 'approval_required',
          toolName: decision.toolName,
          toolParams: decision.toolParams,
          requiresApproval: true,
          approvalRequest: {
            id: policyResult.approvalRequest.id,
            type: policyResult.approvalRequest.type,
            operation: policyResult.approvalRequest.operation,
            risk: policyResult.approvalRequest.risk,
            message: policyResult.approvalRequest.message,
          },
          reason: '需要用户审批',
        };
      }
      
      if (policyResult.modifiedParams) {
        decision.toolParams = policyResult.modifiedParams;
      }
    }
    
    return decision;
  }
  
  private async llmRoute(
    userInput: string, 
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    sessionId: string,
    workspaceDir: string
  ): Promise<RouteDecision> {
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

## 返回格式（只返回JSON）
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
        
        if (parsed.action === 'tool' && parsed.toolName) {
          const exists = this.toolRegistry.has(parsed.toolName) || 
                         this.skillRegistry.get(parsed.toolName);
          
          if (!exists) {
            return { action: 'plan', reason: `工具不存在: ${parsed.toolName}` };
          }
          
          const hookResult = await runHook('before_tool_call', {
            sessionId,
            workspaceDir,
            userInput,
            toolName: parsed.toolName,
            toolParams: parsed.toolParams || {},
            metadata: {},
          });
          
          if (!hookResult.proceed) {
            return {
              action: 'reply',
              content: hookResult.error || '工具调用被阻止',
              reason: '钩子拦截',
            };
          }
          
          return {
            action: 'tool',
            toolName: parsed.toolName,
            toolParams: parsed.toolParams || parsed.params || {},
            reason: parsed.reason,
          };
        }
        
        return parsed;
      }
    } catch (error) {
      logger.error(`[router-error] ${error}`);
    }
    
    return { action: 'plan', reason: '无法判断' };
  }
  
  private async checkPolicy(
    toolName: string,
    toolParams: Record<string, unknown>,
    sessionId: string
  ): Promise<PolicyResult> {
    return checkToolPolicy(toolName, toolParams, DEFAULT_POLICY_CONFIG);
  }
  
  async handleApproval(approvalId: string, approved: boolean, reason?: string): Promise<boolean> {
    const manager = getApprovalManager();
    if (approved) {
      return manager.approve(approvalId, 'user', reason);
    } else {
      return manager.deny(approvalId, reason);
    }
  }
}

let routerInstance: SmartRouter | null = null;

export function getSmartRouter(): SmartRouter {
  if (!routerInstance) routerInstance = new SmartRouter();
  return routerInstance;
}

export function resetSmartRouter(): void {
  routerInstance = null;
}
