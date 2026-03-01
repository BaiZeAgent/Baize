/**
 * 智能路由器 V2 - 深度意图理解 (修复版)
 */

import { LLMMessage } from '../../types';
import { getLLMManager } from '../../llm';
import { getSkillRegistry } from '../../skills/registry';
import { getToolRegistry } from '../../tools';
import { getLogger } from '../../observability/logger';
import { getEnhancedMemory } from '../../memory/v3';
import { runHook } from '../../hooks';
import { checkToolPolicy, PolicyResult, DEFAULT_POLICY_CONFIG } from '../../policy';

const logger = getLogger('core:router-v2');

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

export interface IntentHierarchy {
  surface: string;
  deep: string;
  execution: string;
  type: IntentType;
  urgency: number;
  complexity: number;
}

export type IntentType = 
  | 'information'
  | 'action'
  | 'creation'
  | 'analysis'
  | 'conversation'
  | 'clarification'
  | 'multi_step'
  | 'unknown';

export interface CandidatePlan {
  id: string;
  description: string;
  toolName: string;
  toolParams: Record<string, unknown>;
  confidence: number;
  estimatedSuccessRate: number;
  estimatedDuration: number;
  reasoning: string;
  risks: string[];
  fallbackId?: string;
}

export interface RouteDecisionV2 {
  action: 'reply' | 'tool' | 'plan' | 'clarify' | 'multi_tool' | 'approval_required';
  selectedPlan?: CandidatePlan;
  candidates?: CandidatePlan[];
  intent?: IntentHierarchy;
  content?: string;
  reason?: string;
  confidence: number;
  requiresConfirmation: boolean;
  clarificationQuestions?: string[];
  approvalRequest?: {
    id: string;
    type: string;
    operation: string;
    risk: string;
    message: string;
  };
}

export interface RouteContextV2 {
  userInput: string;
  sessionId?: string;
  userId?: string;
  workspaceDir?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  userPreferences?: Record<string, unknown>;
  taskContext?: {
    ongoingTask?: string;
    previousTools?: string[];
    failedAttempts?: string[];
  };
}

interface RouterHistory {
  userInput: string;
  intent: IntentHierarchy;
  selectedPlan: CandidatePlan;
  success: boolean;
  timestamp: number;
}

// ═══════════════════════════════════════════════════════════════
// 智能路由器 V2
// ═══════════════════════════════════════════════════════════════

export class IntelligentRouter {
  private llm = getLLMManager();
  private skillRegistry = getSkillRegistry();
  private toolRegistry = getToolRegistry();
  private memory = getEnhancedMemory();
  
  private routerHistory: RouterHistory[] = [];
  private maxHistorySize = 100;
  private toolSuccessRates: Map<string, { success: number; total: number }> = new Map();
  
  async route(context: RouteContextV2): Promise<RouteDecisionV2> {
    const { userInput, history = [], sessionId = 'default', userId, workspaceDir = process.cwd() } = context;
    
    logger.info(`[智能路由] 开始分析: ${userInput.slice(0, 50)}...`);
    const startTime = Date.now();
    
    try {
      // 第一阶段：深度意图理解
      const intent = await this.analyzeIntent(userInput, history);
      
      logger.info(`[意图分析] 表面: ${intent.surface}`);
      logger.info(`[意图分析] 深层: ${intent.deep}`);
      logger.info(`[意图分析] 类型: ${intent.type}, 复杂度: ${intent.complexity}`);
      
      // 简单对话直接回复
      if (intent.type === 'conversation' && intent.complexity <= 2) {
        return this.createConversationReply(userInput, intent);
      }
      
      // 需要澄清的请求
      if (intent.type === 'clarification') {
        return {
          action: 'clarify',
          intent,
          confidence: 0.9,
          requiresConfirmation: false,
          clarificationQuestions: await this.generateClarificationQuestions(userInput, intent),
        };
      }
      
      // 第二阶段：生成候选方案
      const candidates = await this.generateCandidates(userInput, intent, history);
      
      if (candidates.length === 0) {
        return {
          action: 'reply',
          content: '抱歉，我暂时没有找到合适的工具来处理您的请求。您可以换一种方式描述，或者告诉我您具体想要达到什么目标。',
          intent,
          confidence: 0.5,
          requiresConfirmation: false,
          reason: '无可用工具',
        };
      }
      
      // 第三阶段：评估和选择最佳方案
      const selectedPlan = await this.selectBestPlan(candidates, intent, context);
      
      logger.info(`[方案选择] 选中: ${selectedPlan.toolName}, 置信度: ${selectedPlan.confidence.toFixed(2)}`);
      
      // 第四阶段：策略检查和决策
      if (selectedPlan.confidence < 0.5) {
        return {
          action: 'clarify',
          intent,
          candidates,
          confidence: selectedPlan.confidence,
          requiresConfirmation: true,
          clarificationQuestions: [
            `我理解您想要${intent.deep}，建议使用${selectedPlan.toolName}工具，但我不太确定这是否是您想要的。请确认或提供更多信息。`
          ],
        };
      }
      
      // 检查策略
      const policyResult = await this.checkPolicy(selectedPlan.toolName, selectedPlan.toolParams, sessionId);
      
      if (!policyResult.allowed) {
        return {
          action: 'reply',
          content: `操作被阻止: ${policyResult.reason}`,
          intent,
          confidence: 1.0,
          requiresConfirmation: false,
          reason: policyResult.reason,
        };
      }
      
      if (policyResult.requiresApproval && policyResult.approvalRequest) {
        return {
          action: 'approval_required',
          selectedPlan,
          intent,
          confidence: selectedPlan.confidence,
          requiresConfirmation: true,
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
      
      // 多步骤任务
      if (intent.type === 'multi_step' && intent.complexity >= 7) {
        return {
          action: 'plan',
          selectedPlan,
          candidates,
          intent,
          confidence: selectedPlan.confidence,
          requiresConfirmation: true,
          reason: '复杂任务需要规划执行',
        };
      }
      
      // 记录路由历史
      this.recordRouting(userInput, intent, selectedPlan);
      
      const duration = Date.now() - startTime;
      logger.info(`[智能路由] 决策完成: ${selectedPlan.toolName}, 耗时: ${duration}ms`);
      
      return {
        action: 'tool',
        selectedPlan,
        candidates,
        intent,
        confidence: selectedPlan.confidence,
        requiresConfirmation: selectedPlan.confidence < 0.7,
        reason: selectedPlan.reasoning,
      };
      
    } catch (error) {
      logger.error(`[智能路由] 错误: ${error}`);
      return {
        action: 'reply',
        content: '抱歉，处理您的请求时出现了问题。请稍后再试。',
        confidence: 0,
        requiresConfirmation: false,
        reason: String(error),
      };
    }
  }
  
  private async analyzeIntent(
    userInput: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<IntentHierarchy> {
    const historyText = history.slice(-5).map(h => 
      `${h.role === 'user' ? '用户' : '助手'}: ${h.content.slice(0, 100)}`
    ).join('\n');
    
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个意图分析专家。分析用户输入，提取多层次意图。

## 分析维度

1. **表面意图**：用户字面表达的需求
2. **深层意图**：用户真正想要达到的目标
3. **执行意图**：具体需要执行的操作
4. **意图类型**：information/action/creation/analysis/conversation/clarification/multi_step/unknown
5. **紧急程度**：1-10
6. **复杂度**：1-10

## 输出格式（JSON）

{
  "surface": "表面意图描述",
  "deep": "深层意图描述",
  "execution": "执行意图描述",
  "type": "意图类型",
  "urgency": 数字,
  "complexity": 数字
}`
      },
      {
        role: 'user',
        content: `对话历史：\n${historyText || '(无历史)'}\n\n当前输入：\n${userInput}\n\n请分析用户的意图。`
      }
    ];
    
    try {
      const response = await this.llm.chat(messages, { temperature: 0.2 });
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          surface: parsed.surface || userInput,
          deep: parsed.deep || parsed.surface || userInput,
          execution: parsed.execution || '',
          type: parsed.type || 'unknown',
          urgency: parsed.urgency || 5,
          complexity: parsed.complexity || 5,
        };
      }
    } catch (error) {
      logger.error(`[意图分析] 错误: ${error}`);
    }
    
    return {
      surface: userInput,
      deep: userInput,
      execution: '',
      type: 'unknown',
      urgency: 5,
      complexity: 5,
    };
  }
  
  private async generateCandidates(
    userInput: string,
    intent: IntentHierarchy,
    history: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<CandidatePlan[]> {
    // 获取所有可用工具
    interface ToolInfo {
      name: string;
      description: string;
      whenToUse?: string;
      inputSchema?: any;
    }
    
    const tools: ToolInfo[] = this.toolRegistry.getAll().map((t: any) => ({
      name: t.name,
      description: t.description,
    }));
    
    const skills: ToolInfo[] = this.skillRegistry.getAll().map((s: any) => ({
      name: s.name,
      description: s.description,
      whenToUse: s.whenToUse,
      inputSchema: s.inputSchema,
    }));
    
    const allTools: ToolInfo[] = [...tools, ...skills];
    
    if (allTools.length === 0) {
      return [];
    }
    
    const toolsDesc = allTools.map(t => {
      let desc = `- ${t.name}: ${t.description}`;
      if (t.whenToUse) {
        desc += ` [适用: ${t.whenToUse}]`;
      }
      if (t.inputSchema?.properties) {
        const params = Object.keys(t.inputSchema.properties).join(', ');
        desc += ` [参数: ${params}]`;
      }
      return desc;
    }).join('\n');
    
    const historyText = history.slice(-3).map(h => 
      `${h.role === 'user' ? '用户' : '助手'}: ${h.content.slice(0, 50)}`
    ).join('\n');
    
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个任务规划专家。根据用户意图，生成多个候选执行方案。

## 可用工具
${toolsDesc}

## 对话历史
${historyText || '(无历史)'}

## 用户意图分析
- 表面意图: ${intent.surface}
- 深层意图: ${intent.deep}
- 执行意图: ${intent.execution}
- 类型: ${intent.type}
- 复杂度: ${intent.complexity}

## 输出格式（JSON数组）

[
  {
    "id": "plan_1",
    "description": "方案描述",
    "toolName": "工具名称",
    "toolParams": {},
    "confidence": 0.0-1.0,
    "estimatedSuccessRate": 0.0-1.0,
    "estimatedDuration": 秒数,
    "reasoning": "选择理由",
    "risks": ["风险1"]
  }
]

生成2-5个候选方案，按置信度从高到低排序。`
      },
      {
        role: 'user',
        content: `请为以下请求生成候选方案：\n\n${userInput}`
      }
    ];
    
    try {
      const response = await this.llm.chat(messages, { temperature: 0.3 });
      const jsonMatch = response.content.match(/\[[\s\S]*\]/);
      
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        const candidates: CandidatePlan[] = [];
        
        for (const plan of parsed) {
          const toolExists = allTools.some(t => t.name === plan.toolName);
          
          if (!toolExists) {
            logger.warn(`[候选方案] 工具不存在: ${plan.toolName}`);
            continue;
          }
          
          const historicalRate = this.getToolSuccessRate(plan.toolName);
          const adjustedConfidence = plan.confidence * 0.7 + historicalRate * 0.3;
          
          candidates.push({
            id: plan.id || `plan_${candidates.length + 1}`,
            description: plan.description || '',
            toolName: plan.toolName,
            toolParams: plan.toolParams || {},
            confidence: adjustedConfidence,
            estimatedSuccessRate: plan.estimatedSuccessRate || 0.8,
            estimatedDuration: plan.estimatedDuration || 5,
            reasoning: plan.reasoning || '',
            risks: plan.risks || [],
            fallbackId: plan.fallbackId,
          });
        }
        
        candidates.sort((a, b) => b.confidence - a.confidence);
        
        return candidates;
      }
    } catch (error) {
      logger.error(`[候选方案生成] 错误: ${error}`);
    }
    
    return [];
  }
  
  private async selectBestPlan(
    candidates: CandidatePlan[],
    intent: IntentHierarchy,
    context: RouteContextV2
  ): Promise<CandidatePlan> {
    if (candidates.length === 0) {
      throw new Error('无候选方案');
    }
    
    if (candidates.length === 1) {
      return candidates[0];
    }
    
    let bestPlan = candidates[0];
    let bestScore = this.calculatePlanScore(candidates[0], intent, context);
    
    for (let i = 1; i < candidates.length; i++) {
      const score = this.calculatePlanScore(candidates[i], intent, context);
      if (score > bestScore) {
        bestScore = score;
        bestPlan = candidates[i];
      }
    }
    
    return bestPlan;
  }
  
  private calculatePlanScore(
    plan: CandidatePlan,
    intent: IntentHierarchy,
    context: RouteContextV2
  ): number {
    let score = 0;
    
    score += plan.confidence * 0.4;
    score += plan.estimatedSuccessRate * 0.3;
    
    const efficiencyScore = Math.max(0, 1 - plan.estimatedDuration / 60);
    score += efficiencyScore * 0.15;
    
    const riskScore = Math.max(0, 1 - plan.risks.length * 0.2);
    score += riskScore * 0.15;
    
    if (intent.urgency >= 8 && plan.estimatedDuration < 10) {
      score += 0.1;
    }
    
    const historicalRate = this.getToolSuccessRate(plan.toolName);
    if (historicalRate > 0.8) {
      score += 0.05;
    }
    
    return score;
  }
  
  private createConversationReply(userInput: string, intent: IntentHierarchy): RouteDecisionV2 {
    const replies: Record<string, string[]> = {
      greeting: [
        '你好！有什么我可以帮助你的吗？',
        '嗨！今天想聊点什么？',
        '你好呀！有什么问题随时问我。',
      ],
      thanks: [
        '不客气！有其他需要帮助的吗？',
        '很高兴能帮到你！',
        '随时为你服务！',
      ],
      farewell: [
        '再见！有需要随时找我。',
        '拜拜！祝你有美好的一天。',
        '下次见！',
      ],
    };
    
    let replyType = 'greeting';
    const input = userInput.toLowerCase();
    
    if (input.includes('谢谢') || input.includes('感谢') || input.includes('thanks')) {
      replyType = 'thanks';
    } else if (input.includes('再见') || input.includes('拜拜') || input.includes('bye')) {
      replyType = 'farewell';
    }
    
    const replyList = replies[replyType] || replies.greeting;
    const content = replyList[Math.floor(Math.random() * replyList.length)];
    
    return {
      action: 'reply',
      content,
      intent,
      confidence: 0.95,
      requiresConfirmation: false,
    };
  }
  
  private async generateClarificationQuestions(
    userInput: string,
    intent: IntentHierarchy
  ): Promise<string[]> {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个沟通专家。用户的需求不够明确，生成2-3个澄清问题。

用户表面意图: ${intent.surface}
用户深层意图: ${intent.deep}

输出JSON数组格式：["问题1", "问题2"]`
      },
      {
        role: 'user',
        content: userInput,
      },
    ];
    
    try {
      const response = await this.llm.chat(messages, { temperature: 0.5 });
      const jsonMatch = response.content.match(/\[[\s\S]*\]/);
      
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      logger.error(`[澄清问题生成] 错误: ${error}`);
    }
    
    return ['请提供更多详细信息，以便我更好地帮助你。'];
  }
  
  private async checkPolicy(
    toolName: string,
    toolParams: Record<string, unknown>,
    sessionId: string
  ): Promise<PolicyResult> {
    return checkToolPolicy(toolName, toolParams, DEFAULT_POLICY_CONFIG);
  }
  
  private recordRouting(
    userInput: string,
    intent: IntentHierarchy,
    selectedPlan: CandidatePlan
  ): void {
    this.routerHistory.push({
      userInput,
      intent,
      selectedPlan,
      success: true,
      timestamp: Date.now(),
    });
    
    if (this.routerHistory.length > this.maxHistorySize) {
      this.routerHistory = this.routerHistory.slice(-this.maxHistorySize);
    }
  }
  
  updateToolResult(toolName: string, success: boolean): void {
    const stats = this.toolSuccessRates.get(toolName) || { success: 0, total: 0 };
    stats.total++;
    if (success) stats.success++;
    this.toolSuccessRates.set(toolName, stats);
    
    const lastRecord = this.routerHistory[this.routerHistory.length - 1];
    if (lastRecord && lastRecord.selectedPlan.toolName === toolName) {
      lastRecord.success = success;
    }
  }
  
  private getToolSuccessRate(toolName: string): number {
    const stats = this.toolSuccessRates.get(toolName);
    if (!stats || stats.total === 0) return 0.5;
    return stats.success / stats.total;
  }
  
  getStats(): {
    totalRoutings: number;
    successRate: number;
    toolStats: Record<string, { success: number; total: number; rate: number }>;
  } {
    const successCount = this.routerHistory.filter(r => r.success).length;
    
    const toolStats: Record<string, { success: number; total: number; rate: number }> = {};
    for (const [tool, stats] of this.toolSuccessRates) {
      toolStats[tool] = {
        ...stats,
        rate: stats.total > 0 ? stats.success / stats.total : 0,
      };
    }
    
    return {
      totalRoutings: this.routerHistory.length,
      successRate: this.routerHistory.length > 0 ? successCount / this.routerHistory.length : 0,
      toolStats,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// 全局实例
// ═══════════════════════════════════════════════════════════════

let intelligentRouterInstance: IntelligentRouter | null = null;

export function getIntelligentRouter(): IntelligentRouter {
  if (!intelligentRouterInstance) {
    intelligentRouterInstance = new IntelligentRouter();
  }
  return intelligentRouterInstance;
}

export function resetIntelligentRouter(): void {
  intelligentRouterInstance = null;
}
