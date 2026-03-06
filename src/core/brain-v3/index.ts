/**
 * 统一大脑 V3 - 真正的智能助手核心 (增强版)
 * 
 * 整合组件：
 * 1. 智能路由器 - 深度意图理解
 * 2. 任务规划器 - 复杂任务分解
 * 3. 增强记忆 - 语义记忆和上下文
 * 4. 元认知引擎 - 自我反思和学习
 * 5. 统一执行器 - L1-L4层执行能力
 */

import fs from 'fs';
import path from 'path';
import { LLMMessage, SkillResult, RiskLevel } from '../../types';
import { getLLMManager } from '../../llm';
import { getLogger } from '../../observability/logger';
import { StreamEvent } from '../../types/stream';
import { getIntelligentRouter, RouteDecisionV2 } from '../router/intelligent-router';
import { getTaskPlanner, ExecutionPlan, ExecutionContext, PlannedTask } from '../planner';
import { getEnhancedMemory } from '../../memory/v3';
import { getMetacognition } from '../metacognition';
import { getSkillRegistry } from '../../skills/registry';
import { getToolRegistry } from '../../tools';
import { Skill } from '../../skills/base';
import { BaseTool, ToolResult } from '../../tools/base';
import { SkillLoader } from '../../skills/loader';
import { registerBuiltinSkills } from '../../skills/builtins';
import { getUnifiedExecutor } from '../executor';

const logger = getLogger('core:brain-v3');

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

export interface BrainV3Config {
  maxIterations?: number;
  enableMetacognition?: boolean;
  enableLearning?: boolean;
  enableReflection?: boolean;
  useUnifiedExecutor?: boolean;  // 是否使用统一执行器
}

export interface ProcessingResult {
  success: boolean;
  response: string;
  intent?: any;
  plan?: ExecutionPlan;
  reflections?: string[];
  confidence: number;
  duration: number;
}

// ═══════════════════════════════════════════════════════════════
// 统一大脑 V3
// ═══════════════════════════════════════════════════════════════

export class UnifiedBrainV3 {
  private llm = getLLMManager();
  private router = getIntelligentRouter();
  private planner = getTaskPlanner();
  private memory = getEnhancedMemory();
  private meta = getMetacognition();
  private skillRegistry = getSkillRegistry();
  private toolRegistry = getToolRegistry();
  private unifiedExecutor = getUnifiedExecutor();
  
  private config: BrainV3Config;
  private soulContent: string = '';
  
  private static skillsLoaded = false;
  private static skillsLoading = false;
  
  constructor(config: BrainV3Config = {}) {
    this.config = {
      maxIterations: config.maxIterations ?? 10,
      enableMetacognition: config.enableMetacognition ?? true,
      enableLearning: config.enableLearning ?? true,
      enableReflection: config.enableReflection ?? true,
      useUnifiedExecutor: config.useUnifiedExecutor ?? true,  // 默认启用
    };
    
    this.loadSoul();
  }
  
  private loadSoul(): void {
    const soulPaths = [
      path.join(process.cwd(), 'config', 'SOUL.md'),
      path.join(process.cwd(), 'SOUL.md'),
    ];
    
    for (const soulPath of soulPaths) {
      if (fs.existsSync(soulPath)) {
        this.soulContent = fs.readFileSync(soulPath, 'utf-8');
        logger.info(`[大脑V3] 已加载 SOUL.md: ${soulPath}`);
        return;
      }
    }
  }
  
  private async ensureSkillsLoaded(): Promise<void> {
    if (UnifiedBrainV3.skillsLoaded) return;
    
    if (UnifiedBrainV3.skillsLoading) {
      while (UnifiedBrainV3.skillsLoading) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return;
    }
    
    UnifiedBrainV3.skillsLoading = true;
    
    try {
      registerBuiltinSkills();
      
      const loader = new SkillLoader();
      const skills = await loader.loadAll();
      for (const skill of skills) {
        this.skillRegistry.register(skill);
      }
      
      UnifiedBrainV3.skillsLoaded = true;
      logger.info(`[大脑V3] 技能加载完成，共 ${this.skillRegistry.size} 个技能`);
    } catch (error) {
      logger.error(`[大脑V3] 技能加载失败: ${error}`);
    } finally {
      UnifiedBrainV3.skillsLoading = false;
    }
  }
  
  /**
   * 统一执行方法 - 处理 Skill 和 Tool
   */
  private async executeSkillOrTool(
    name: string,
    params: Record<string, unknown>,
    context: { sessionId: string; conversationId: string }
  ): Promise<{ success: boolean; message: string; error?: string; data?: any }> {
    const skill = this.skillRegistry.get(name);
    const tool = this.toolRegistry.get(name);
    
    if (skill) {
      // 执行 Skill
      const result: SkillResult = await skill.run(params, {
        sessionId: context.sessionId,
        conversationId: context.conversationId,
      });
      return {
        success: result.success,
        message: result.message || '',
        error: result.error,
        data: result.data,
      };
    } else if (tool) {
      // 执行 Tool
      const result: ToolResult = await tool.safeExecute(params, {
        sessionId: context.sessionId,
        conversationId: context.conversationId,
      });
      return {
        success: result.success,
        message: result.success ? JSON.stringify(result.data) : '',
        error: result.error,
        data: result.data,
      };
    } else {
      return {
        success: false,
        message: '',
        error: `工具不存在: ${name}`,
      };
    }
  }
  
  /**
   * 流式处理 - 主入口
   */
  async *processStream(
    userInput: string,
    sessionId: string = 'default'
  ): AsyncGenerator<StreamEvent> {
    await this.ensureSkillsLoaded();
    
    const startTime = Date.now();
    logger.info(`[大脑V3] 开始处理: ${userInput.slice(0, 50)}...`);
    
    this.memory.recordEvent('user_input', userInput);
    this.memory.setContext(userInput);
    
    try {
      // ═══════════════════════════════════════════════════════════
      // 使用统一执行器（新功能）
      // ═══════════════════════════════════════════════════════════
      if (this.config.useUnifiedExecutor) {
        yield* this.processWithUnifiedExecutor(userInput, sessionId, startTime);
        return;
      }
      
      // ═══════════════════════════════════════════════════════════
      // 原有流程（保留兼容性）
      // ═══════════════════════════════════════════════════════════
      
      // 第一阶段：深度意图理解
      yield {
        type: 'thinking',
        timestamp: Date.now(),
        data: { stage: 'intent_analysis', message: '正在理解您的意图...' }
      };
      
      const routeDecision = await this.router.route({
        userInput,
        sessionId,
        history: [],
      });
      
      yield {
        type: 'thinking',
        timestamp: Date.now(),
        data: { 
          stage: 'intent_understood', 
          message: `理解: ${routeDecision.intent?.deep || userInput}` 
        }
      };
      
      // 第二阶段：能力边界检查
      if (this.config.enableMetacognition) {
        const boundaryCheck = await this.meta.checkBoundary(userInput);
        
        if (!boundaryCheck.withinCapability) {
          yield {
            type: 'thinking',
            timestamp: Date.now(),
            data: { 
              stage: 'boundary_check', 
              message: `检测到能力限制: ${boundaryCheck.missingCapabilities.join(', ')}` 
            }
          };
          
          const response = await this.handleOutOfCapability(boundaryCheck, userInput);
          yield* this.streamContent(response);
          return;
        }
      }
      
      // 第三阶段：执行决策
      switch (routeDecision.action) {
        case 'reply':
          yield* this.streamContent(routeDecision.content || '好的');
          this.memory.recordEvent('assistant_reply', routeDecision.content || '');
          break;
          
        case 'clarify':
          yield* this.handleClarification(routeDecision);
          break;
          
        case 'tool':
          yield* this.executeSingleTool(routeDecision, userInput, sessionId);
          break;
          
        case 'plan':
          yield* this.executeComplexTask(routeDecision, userInput, sessionId);
          break;
          
        default:
          yield* this.handleUnknown(userInput);
      }
      
      // 第四阶段：反思和学习
      if (this.config.enableReflection) {
        this.reflectAsync(userInput, startTime);
      }
      
      yield {
        type: 'done',
        timestamp: Date.now(),
        data: { duration: Date.now() - startTime }
      };
      
    } catch (error) {
      logger.error(`[大脑V3] 处理错误: ${error}`);
      
      yield {
        type: 'error',
        timestamp: Date.now(),
        data: { code: 'PROCESSING_ERROR', message: String(error) }
      };
    }
  }
  
  /**
   * 使用统一执行器处理（新功能）
   */
  private async *processWithUnifiedExecutor(
    userInput: string,
    sessionId: string,
    startTime: number
  ): AsyncGenerator<StreamEvent> {
    logger.info(`[大脑V3] 使用统一执行器处理`);
    
    try {
      // 使用统一执行器的流式执行
      for await (const event of this.unifiedExecutor.executeStream(userInput, {
        sessionId,
        conversationId: sessionId,
      })) {
        yield event;
      }
      
      // 记录到记忆系统
      this.memory.recordEvent('assistant_reply', '执行完成');
      
      // 反思
      if (this.config.enableReflection) {
        this.reflectAsync(userInput, startTime);
      }
      
    } catch (error) {
      logger.error(`[大脑V3] 统一执行器错误: ${error}`);
      
      yield {
        type: 'error',
        timestamp: Date.now(),
        data: { code: 'EXECUTOR_ERROR', message: String(error) }
      };
    }
  }
  
  /**
   * 非流式处理
   */
  async process(userInput: string, sessionId: string = 'default'): Promise<ProcessingResult> {
    const startTime = Date.now();
    
    await this.ensureSkillsLoaded();
    
    let response = '';
    let intent: any;
    let plan: ExecutionPlan | undefined;
    let confidence = 0.5;
    
    try {
      // 使用统一执行器
      if (this.config.useUnifiedExecutor) {
        const result = await this.unifiedExecutor.execute(userInput, {
          sessionId,
          conversationId: sessionId,
        });
        
        return {
          success: result.success,
          response: result.output?.output || result.validation.summary,
          intent: result.analysis.taskType,
          confidence: result.validation.score,
          duration: result.totalDuration,
        };
      }
      
      // 原有流程
      const routeDecision = await this.router.route({
        userInput,
        sessionId,
        history: [],
      });
      
      intent = routeDecision.intent;
      
      if (this.config.enableMetacognition) {
        const boundaryCheck = await this.meta.checkBoundary(userInput);
        if (!boundaryCheck.withinCapability) {
          response = await this.handleOutOfCapability(boundaryCheck, userInput);
          return {
            success: false,
            response,
            intent,
            confidence: 0.3,
            duration: Date.now() - startTime,
          };
        }
      }
      
      switch (routeDecision.action) {
        case 'reply':
          response = routeDecision.content || '好的';
          confidence = routeDecision.confidence;
          break;
          
        case 'clarify':
          response = routeDecision.clarificationQuestions?.join('\n') || '请提供更多信息';
          confidence = routeDecision.confidence;
          break;
          
        case 'tool':
          const toolResult = await this.executeTool(routeDecision, sessionId);
          response = toolResult.message;
          confidence = routeDecision.confidence * (toolResult.success ? 1 : 0.5);
          break;
          
        case 'plan':
          const planResult = await this.executePlan(routeDecision, userInput, sessionId);
          response = planResult.finalMessage;
          plan = planResult.plan;
          confidence = routeDecision.confidence * (planResult.success ? 1 : 0.7);
          break;
          
        default:
          response = await this.handleUnknownSync(userInput);
          confidence = 0.4;
      }
      
      this.memory.recordEvent('assistant_reply', response);
      
      if (this.config.enableLearning) {
        await this.memory.learnPreference(userInput, response);
      }
      
      return {
        success: true,
        response,
        intent,
        plan,
        confidence,
        duration: Date.now() - startTime,
      };
      
    } catch (error) {
      return {
        success: false,
        response: `处理失败: ${error}`,
        intent,
        confidence: 0,
        duration: Date.now() - startTime,
      };
    }
  }
  
  // ═══════════════════════════════════════════════════════════════
  // 私有方法
  // ═══════════════════════════════════════════════════════════════
  
  private async *executeSingleTool(
    decision: RouteDecisionV2,
    userInput: string,
    sessionId: string
  ): AsyncGenerator<StreamEvent> {
    const plan = decision.selectedPlan;
    if (!plan) {
      yield* this.streamContent('抱歉，无法确定如何处理您的请求。');
      return;
    }
    
    yield {
      type: 'tool_call',
      timestamp: Date.now(),
      data: {
        toolCallId: `tc_${Date.now()}`,
        tool: plan.toolName,
        params: plan.toolParams,
        reason: plan.reasoning,
      }
    };
    
    const toolStartTime = Date.now();
    
    try {
      const result = await this.executeSkillOrTool(
        plan.toolName,
        plan.toolParams,
        { sessionId, conversationId: sessionId }
      );
      
      const duration = Date.now() - toolStartTime;
      
      yield {
        type: 'tool_result',
        timestamp: Date.now(),
        data: {
          toolCallId: `tc_${Date.now()}`,
          tool: plan.toolName,
          success: result.success,
          duration,
          output: result.message,
          error: result.error,
        }
      };
      
      this.router.updateToolResult(plan.toolName, result.success);
      
      const processedResponse = await this.processToolResult(userInput, plan.toolName, result);
      yield* this.streamContent(processedResponse);
      
      this.memory.recordLearning(
        `工具执行: ${plan.toolName}`,
        JSON.stringify(plan.toolParams),
        result.success ? 'success' : 'failure',
        result.error || result.message
      );
      
    } catch (error) {
      yield {
        type: 'tool_result',
        timestamp: Date.now(),
        data: {
          toolCallId: `tc_${Date.now()}`,
          tool: plan.toolName,
          success: false,
          duration: Date.now() - toolStartTime,
          error: String(error),
        }
      };
      
      yield* this.streamContent(`执行失败: ${error}`);
    }
  }
  
  private async *executeComplexTask(
    decision: RouteDecisionV2,
    userInput: string,
    sessionId: string
  ): AsyncGenerator<StreamEvent> {
    yield {
      type: 'thinking',
      timestamp: Date.now(),
      data: { stage: 'planning', message: '正在规划任务...' }
    };
    
    const context: ExecutionContext = {
      sessionId,
      completedTasks: new Map(),
      variables: {},
      userInput,
      intent: decision.intent,
    };
    
    const plan = await this.planner.createPlan(userInput, decision.intent!, context);
    
    yield {
      type: 'thinking',
      timestamp: Date.now(),
      data: { 
        stage: 'plan_created', 
        message: `已创建计划: ${plan.tasks.length} 个任务` 
      }
    };
    
    const result = await this.planner.executePlan(plan, context);
    
    yield* this.streamContent(result.finalMessage);
    
    this.memory.recordLearning(
      '复杂任务',
      userInput,
      result.success ? 'success' : 'partial',
      result.adjustments.join('; ')
    );
  }
  
  private async *handleClarification(decision: RouteDecisionV2): AsyncGenerator<StreamEvent> {
    const questions = decision.clarificationQuestions || ['请提供更多信息'];
    
    yield* this.streamContent('为了更好地帮助您，我需要了解一些信息：\n\n');
    
    for (let i = 0; i < questions.length; i++) {
      yield* this.streamContent(`${i + 1}. ${questions[i]}\n`);
    }
  }
  
  private async handleOutOfCapability(
    boundaryCheck: any,
    userInput: string
  ): Promise<string> {
    let response = '抱歉，这个请求超出了我目前的能力范围。\n\n';
    
    if (boundaryCheck.missingCapabilities.length > 0) {
      response += `缺失的能力: ${boundaryCheck.missingCapabilities.join(', ')}\n\n`;
    }
    
    if (boundaryCheck.suggestedAlternatives.length > 0) {
      response += `您可以尝试:\n`;
      for (const alt of boundaryCheck.suggestedAlternatives) {
        response += `- ${alt}\n`;
      }
    }
    
    return response;
  }
  
  private async *handleUnknown(userInput: string): AsyncGenerator<StreamEvent> {
    const response = await this.handleUnknownSync(userInput);
    yield* this.streamContent(response);
  }
  
  private async handleUnknownSync(userInput: string): Promise<string> {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是白泽，一个智能助手。

${this.soulContent ? `---\n${this.soulContent}\n---\n` : ''}

## 可用工具
${this.skillRegistry.getAll().map(s => `- ${s.name}: ${s.description}`).join('\n')}

## 规则
1. 如果需要使用工具，返回 JSON: {"tool": "工具名", "params": {...}}
2. 如果可以直接回答，直接回复用户
3. 诚实回答，不要编造能力
4. 回答要自然、简洁`
      },
      { role: 'user', content: userInput }
    ];
    
    const response = await this.llm.chat(messages, { temperature: 0.7 });
    return response.content;
  }
  
  private async processToolResult(
    userInput: string,
    toolName: string,
    result: any
  ): Promise<string> {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是白泽，一个智能助手。根据工具执行结果回答用户的问题。
风格：自然、简洁，像朋友一样交流。
不要说"根据查询结果"这种话，直接说结论。`
      },
      {
        role: 'user',
        content: `用户问题: ${userInput}\n\n工具: ${toolName}\n结果: ${result.message || result.error || ''}\n\n请用自然语言回答：`
      }
    ];
    
    const response = await this.llm.chat(messages, { temperature: 0.7 });
    return response.content;
  }
  
  private async executeTool(
    decision: RouteDecisionV2,
    sessionId: string
  ): Promise<{ success: boolean; message: string }> {
    const plan = decision.selectedPlan;
    if (!plan) {
      return { success: false, message: '无法确定执行方案' };
    }
    
    try {
      const result = await this.executeSkillOrTool(
        plan.toolName,
        plan.toolParams,
        { sessionId, conversationId: sessionId }
      );
      
      this.router.updateToolResult(plan.toolName, result.success);
      
      return {
        success: result.success,
        message: result.message || result.error || '执行完成',
      };
    } catch (error) {
      return {
        success: false,
        message: String(error),
      };
    }
  }
  
  private async executePlan(
    decision: RouteDecisionV2,
    userInput: string,
    sessionId: string
  ): Promise<any> {
    const context: ExecutionContext = {
      sessionId,
      completedTasks: new Map(),
      variables: {},
      userInput,
      intent: decision.intent,
    };
    
    const plan = await this.planner.createPlan(userInput, decision.intent!, context);
    return this.planner.executePlan(plan, context);
  }
  
  private reflectAsync(userInput: string, startTime: number): void {
    // ═══════════════════════════════════════════════════════════════
    // 优化：禁用异步反思（节省 LLM 调用）
    // 如需启用，可设置环境变量 BAIZE_ENABLE_REFLECTION=true
    // ═══════════════════════════════════════════════════════════════
    if (process.env.BAIZE_ENABLE_REFLECTION !== 'true') {
      return;
    }
    
    setTimeout(async () => {
      try {
        const duration = Date.now() - startTime;
        await this.meta.reflect(
          userInput,
          [`处理完成，耗时 ${duration}ms`],
          'success'
        );
      } catch (error) {
        logger.error(`[大脑V3] 反思错误: ${error}`);
      }
    }, 0);
  }
  
  private async *streamContent(content: string): AsyncGenerator<StreamEvent> {
    const parts = content.split(/(?<=[。！？.！？\n])/);
    
    for (const part of parts) {
      if (!part.trim()) continue;
      yield {
        type: 'content',
        timestamp: Date.now(),
        data: { text: part, isDelta: true }
      };
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  
  async getSelfAssessment(): Promise<string> {
    return this.meta.generateSelfReport();
  }
  
  getRouterStats(): any {
    return this.router.getStats();
  }
  
  getMemoryStats(): any {
    return this.memory.getStats();
  }
  
  /**
   * 获取执行器统计信息（新功能）
   */
  getExecutorStats(): any {
    return this.unifiedExecutor.getStats();
  }
}

// ═══════════════════════════════════════════════════════════════
// 全局实例
// ═══════════════════════════════════════════════════════════════

let brainV3Instance: UnifiedBrainV3 | null = null;

export function getBrainV3(): UnifiedBrainV3 {
  if (!brainV3Instance) {
    brainV3Instance = new UnifiedBrainV3();
  }
  return brainV3Instance;
}

export function resetBrainV3(): void {
  brainV3Instance = null;
}
