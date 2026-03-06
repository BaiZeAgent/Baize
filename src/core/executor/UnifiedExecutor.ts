/**
 * 统一执行器 - 整合L1-L4层
 */

import { getLogger } from '../../observability/logger';
import { getLLMManager } from '../../llm';
import { getSkillRegistry } from '../../skills/registry';
import { getToolRegistry } from '../../tools';
import { getEnhancedMemory } from '../../memory/v3';
import { Skill } from '../../skills/base';
import { ToolResult } from '../../tools/base';
import { StreamEvent } from '../../types/stream';
import {
  FullExecutionResult,
  TaskAnalysis,
  ExecutionStrategy,
  ExecutionPlan,
  ExecutionContext,
  ExecutionOutput,
  GoalDefinition,
  FailureDiagnosis,
  OverallValidation,
  ExecutionExperience,
} from './types';
import { getExperienceStore } from './ExperienceStore';
import { getFailureDiagnoser } from './FailureDiagnoser';
import { getGoalDefiner } from './GoalDefiner';
import { getResultValidator } from './ResultValidator';

const logger = getLogger('executor:unified');

export class UnifiedExecutor {
  private llm = getLLMManager();
  private skillRegistry = getSkillRegistry();
  private toolRegistry = getToolRegistry();
  private memory = getEnhancedMemory();
  
  private experienceStore = getExperienceStore();
  private failureDiagnoser = getFailureDiagnoser();
  private goalDefiner = getGoalDefiner();
  private resultValidator = getResultValidator();
  
  private planCounter = 0;
  
  async execute(
    userInput: string,
    context: ExecutionContext
  ): Promise<FullExecutionResult> {
    const startTime = Date.now();
    
    logger.info(`[统一执行器] 开始执行: ${userInput.slice(0, 50)}...`);
    
    try {
      // 阶段1：任务分析
      const analysis = await this.goalDefiner.analyzeTask(userInput);
      
      logger.info(`[统一执行器] 任务分析完成: 复杂度=${analysis.complexity}, 类型=${analysis.taskType}`);
      
      // 阶段2：策略选择
      const strategy = this.selectStrategy(analysis);
      
      logger.info(`[统一执行器] 策略选择: ${strategy.type}, 原因: ${strategy.reason}`);
      
      // 阶段3：执行
      const maxAttempts = 3;
      let attempt = 0;
      let plan: ExecutionPlan | null = null;
      let output: ExecutionOutput | null = null;
      let validation: OverallValidation | null = null;
      let diagnosis: FailureDiagnosis | undefined = undefined;
      
      // 生成初始计划
      plan = await this.generatePlan(userInput, analysis, strategy);
      
      while (attempt < maxAttempts && plan) {
        attempt++;
        
        logger.info(`[统一执行器] 执行尝试 ${attempt}/${maxAttempts}`);
        
        // 执行计划
        output = await this.executePlan(plan, context);
        
        // 验证结果
        const goal: GoalDefinition = {
          userInput,
          intent: analysis.taskType,
          deepGoal: analysis.similarExperiences[0]?.experience.intent || userInput,
          successCriteria: analysis.successCriteria,
          risks: [],
          confidence: 0.8,
        };
        
        validation = await this.resultValidator.validate(output, goal);
        
        if (validation.passed) {
          logger.info(`[统一执行器] 执行成功，尝试次数: ${attempt}`);
          
          const experience = this.createExperience(
            userInput, analysis, plan, output, validation, undefined, attempt
          );
          await this.experienceStore.save(experience);
          
          return {
            success: true,
            userInput,
            analysis,
            strategy,
            plan,
            output,
            validation,
            attempts: attempt,
            totalDuration: Date.now() - startTime,
            experienceRecorded: true,
            timestamp: Date.now(),
          };
        }
        
        // 失败，诊断原因
        diagnosis = await this.failureDiagnoser.diagnose(
          plan, output, goal, validation.results, attempt
        );
        
        logger.info(`[统一执行器] 诊断结果: ${diagnosis.causeType} - ${diagnosis.rootCause}`);
        
        // 尝试修正
        if (diagnosis.canFix && attempt < maxAttempts) {
          const correctedPlan = await this.failureDiagnoser.generateCorrection(
            diagnosis, plan, goal
          );
          
          if (correctedPlan) {
            plan = {
              id: `plan_${++this.planCounter}_${Date.now()}`,
              tool: correctedPlan.tool,
              params: correctedPlan.params,
              reasoning: correctedPlan.reason,
              risks: [],
            };
            
            logger.info(`[统一执行器] 方案已修正: ${plan.tool}`);
            continue;
          }
        }
        
        break;
      }
      
      // 执行失败
      const finalOutput: ExecutionOutput = output || {
        success: false,
        tool: plan?.tool || 'unknown',
        params: plan?.params || {},
        error: '执行失败',
        duration: 0,
      };
      
      const finalValidation: OverallValidation = validation || {
        passed: false,
        results: [],
        summary: '执行失败',
        score: 0,
      };
      
      const finalPlan: ExecutionPlan = plan || {
        id: `plan_${Date.now()}`,
        tool: 'unknown',
        params: {},
        reasoning: '',
        risks: [],
      };
      
      const experience = this.createExperience(
        userInput, analysis, finalPlan, finalOutput, finalValidation, diagnosis, attempt
      );
      await this.experienceStore.save(experience);
      
      return {
        success: false,
        userInput,
        analysis,
        strategy,
        plan: finalPlan,
        output: finalOutput,
        validation: finalValidation,
        diagnosis,
        attempts: attempt,
        totalDuration: Date.now() - startTime,
        experienceRecorded: true,
        timestamp: Date.now(),
      };
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`[统一执行器] 执行错误: ${errorMsg}`);
      
      return {
        success: false,
        userInput,
        analysis: {
          userInput,
          features: {
            requiresMultipleSteps: false,
            involvesExternalSystem: false,
            requiresObservation: false,
            hasTimeDependency: false,
            hasConditionalBranches: false,
            requiresPrecision: false,
            involvesBrowser: false,
            involvesFileSystem: false,
            involvesNetwork: false,
          },
          complexity: 'simple',
          taskType: 'unknown',
          successCriteria: [],
          similarExperiences: [],
          riskLevel: 'low',
        },
        strategy: { type: 'direct', reason: '默认策略' },
        plan: {
          id: `plan_${Date.now()}`,
          tool: 'unknown',
          params: {},
          reasoning: '',
          risks: [],
        },
        output: {
          success: false,
          tool: 'unknown',
          params: {},
          error: errorMsg,
          duration: 0,
        },
        validation: {
          passed: false,
          results: [],
          summary: errorMsg,
          score: 0,
        },
        attempts: 1,
        totalDuration: Date.now() - startTime,
        experienceRecorded: false,
        timestamp: Date.now(),
      };
    }
  }
  
  async *executeStream(
    userInput: string,
    context: ExecutionContext
  ): AsyncGenerator<StreamEvent> {
    const startTime = Date.now();
    
    // ═══════════════════════════════════════════════════════════════
    // 快速分类：先用小模型判断是简单聊天还是复杂任务
    // 这一步只需要 ~200ms，避免对简单任务做完整分析
    // ═══════════════════════════════════════════════════════════════
    
    const quickClass = await this.quickClassify(userInput);
    
    logger.info(`[统一执行器] 快速分类: ${quickClass.type} (${quickClass.confidence.toFixed(2)})`);
    
    // 如果是简单聊天且置信度高，直接回复
    if (quickClass.type === 'simple' && quickClass.confidence > 0.7) {
      yield {
        type: 'thinking',
        timestamp: Date.now(),
        data: { stage: 'quick_reply' as any, message: '简单对话，直接回复' }
      };
      
      const response = await this.generateDirectResponse(userInput);
      
      yield {
        type: 'content',
        timestamp: Date.now(),
        data: { text: response, isDelta: false }
      };
      
      yield {
        type: 'done',
        timestamp: Date.now(),
        data: { duration: Date.now() - startTime }
      };
      
      return;
    }
    
    // ═══════════════════════════════════════════════════════════════
    // 复杂任务：走完整分析流程
    // ═══════════════════════════════════════════════════════════════
    
    yield {
      type: 'thinking',
      timestamp: Date.now(),
      data: { stage: 'task_analysis' as any, message: '正在分析任务...' }
    };
    
    try {
      const analysis = await this.goalDefiner.analyzeTask(userInput);
      
      yield {
        type: 'thinking',
        timestamp: Date.now(),
        data: { stage: 'analysis_complete' as any, message: `分析完成: 复杂度=${analysis.complexity}` }
      };
      
      const strategy = this.selectStrategy(analysis);
      
      yield {
        type: 'thinking',
        timestamp: Date.now(),
        data: { stage: 'strategy_selected' as any, message: `策略: ${strategy.type}` }
      };
      
      // 对于 direct 策略或简单任务类型，直接用 LLM 回复，不调用工具
      if (strategy.type === 'direct' || ['greeting', 'thanks', 'chat'].includes(analysis.taskType)) {
        const response = await this.generateDirectResponse(userInput);
        
        yield {
          type: 'content',
          timestamp: Date.now(),
          data: { text: response, isDelta: false }
        };
        
        yield {
          type: 'done',
          timestamp: Date.now(),
          data: { duration: Date.now() - startTime }
        };
        
        return;
      }
      
      const plan = await this.generatePlan(userInput, analysis, strategy);
      
      yield {
        type: 'tool_call',
        timestamp: Date.now(),
        data: {
          toolCallId: `tc_${Date.now()}`,
          tool: plan.tool,
          params: plan.params,
          reason: plan.reasoning,
        }
      };
      
      const toolStartTime = Date.now();
      const output = await this.executePlan(plan, context);
      
      yield {
        type: 'tool_result',
        timestamp: Date.now(),
        data: {
          toolCallId: `tc_${Date.now()}`,
          tool: plan.tool,
          success: output.success,
          duration: Date.now() - toolStartTime,
          output: output.output,
          error: output.error,
        }
      };
      
      const goal: GoalDefinition = {
        userInput,
        intent: analysis.taskType,
        deepGoal: userInput,
        successCriteria: analysis.successCriteria,
        risks: [],
        confidence: 0.8,
      };
      
      const validation = await this.resultValidator.validate(output, goal);
      
      const experience = this.createExperience(
        userInput, analysis, plan, output, validation, undefined, 1
      );
      await this.experienceStore.save(experience);
      
      const response = await this.generateResponse(userInput, plan.tool, output, validation);
      
      yield {
        type: 'content',
        timestamp: Date.now(),
        data: { text: response, isDelta: false }
      };
      
      yield {
        type: 'done',
        timestamp: Date.now(),
        data: { duration: Date.now() - startTime }
      };
      
    } catch (error) {
      yield {
        type: 'error',
        timestamp: Date.now(),
        data: { code: 'EXECUTION_ERROR', message: String(error) }
      };
    }
  }
  
  /**
   * 快速分类 - 用小模型判断任务类型
   * 目标：在 ~200ms 内完成分类，避免对简单任务做完整分析
   */
  private async quickClassify(userInput: string): Promise<{ type: 'simple' | 'complex'; confidence: number; reason?: string }> {
    // 1. 先用规则快速判断（0ms）
    const ruleResult = this.quickClassifyByRules(userInput);
    if (ruleResult.confidence > 0.9) {
      return ruleResult;
    }
    
    // 2. 用 LLM 快速分类（~200ms）
    try {
      const response = await this.llm.chat([
        {
          role: 'system',
          content: `你是任务分类器。判断用户输入是"简单"还是"复杂"。

简单：问候、闲聊、问答、情感交流，不需要调用工具
复杂：需要执行操作、调用工具、多步骤任务

只输出JSON：{"type":"simple或complex","confidence":0.0-1.0}`
        },
        { role: 'user', content: userInput }
      ], { temperature: 0.1, maxTokens: 50 });
      
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          type: parsed.type === 'complex' ? 'complex' : 'simple',
          confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5))
        };
      }
    } catch (error) {
      logger.debug(`[统一执行器] 快速分类失败: ${error}`);
    }
    
    // 默认：简单
    return { type: 'simple', confidence: 0.5 };
  }
  
  /**
   * 规则快速分类 - 0ms
   */
  private quickClassifyByRules(userInput: string): { type: 'simple' | 'complex'; confidence: number; reason?: string } {
    const input = userInput.toLowerCase().trim();
    const len = input.length;
    
    // 极短问候
    const greetings = ['你好', '您好', 'hi', 'hello', 'hey', '嗨', '哈喽', '早上好', '下午好', '晚上好'];
    if (len < 15 && greetings.some(g => input.includes(g))) {
      return { type: 'simple', confidence: 0.95, reason: '简单问候' };
    }
    
    // 感谢
    const thanks = ['谢谢', '感谢', 'thanks', 'thank you', '多谢'];
    if (len < 20 && thanks.some(t => input.includes(t))) {
      return { type: 'simple', confidence: 0.95, reason: '感谢' };
    }
    
    // 明确的工具关键词
    const toolKeywords = [
      '读取文件', '写入文件', '创建文件', '删除文件', '编辑文件',
      '搜索', '打开浏览器', '点击', '截图', '填表',
      '执行命令', '运行脚本', '安装',
      '查询天气', '获取时间', '计算'
    ];
    
    if (toolKeywords.some(k => input.includes(k))) {
      return { type: 'complex', confidence: 0.85, reason: '包含工具关键词' };
    }
    
    // 明确的聊天关键词
    const chatKeywords = [
      '你好吗', '怎么样', '你觉得', '你认为',
      '什么是', '为什么', '怎么理解', '解释一下',
      '帮我写', '帮我改', '帮我翻译'
    ];
    
    if (chatKeywords.some(k => input.includes(k))) {
      return { type: 'simple', confidence: 0.8, reason: '聊天/问答' };
    }
    
    // 无法确定
    return { type: 'simple', confidence: 0.5, reason: '无法确定' };
  }
  
  private selectStrategy(analysis: TaskAnalysis): ExecutionStrategy {
    const { complexity, taskType, similarExperiences } = analysis;
    
    const highConfidenceSuccess = similarExperiences.find(
      e => e.experience.result === 'success' && e.similarity > 0.9
    );
    if (highConfidenceSuccess) {
      return { 
        type: 'experience_based', 
        experience: highConfidenceSuccess.experience,
        reason: '找到高置信度成功经验'
      };
    }
    
    if (complexity === 'simple') {
      return { type: 'direct', reason: '简单任务，直接执行' };
    }
    
    if (taskType === 'browser_automation') {
      return { type: 'perception_loop', reason: '浏览器自动化任务需要感知循环' };
    }
    
    if (analysis.riskLevel === 'high') {
      return { type: 'human_collaboration', reason: '高风险任务需要人工确认' };
    }
    
    if (complexity === 'very_complex') {
      return { type: 'multi_agent', reason: '非常复杂的任务需要多智能体协作' };
    }
    
    return { type: 'experience_based', reason: '默认使用经验驱动策略' };
  }
  
  private async generatePlan(
    userInput: string,
    analysis: TaskAnalysis,
    strategy: ExecutionStrategy
  ): Promise<ExecutionPlan> {
    if (strategy.type === 'experience_based' && strategy.experience) {
      return {
        id: `plan_${++this.planCounter}_${Date.now()}`,
        tool: strategy.experience.tool,
        params: strategy.experience.params,
        reasoning: `复用成功经验: ${strategy.experience.id}`,
        risks: [],
        basedOnExperience: strategy.experience.id,
      };
    }
    
    const skills = this.skillRegistry.getAll();
    const tools = this.toolRegistry.getAll();
    
    const allTools = [
      ...skills.map(s => ({
        name: s.name,
        description: s.description,
        inputSchema: s.inputSchema,
      })),
      ...tools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: {},
      })),
    ];
    
    let experiencePrompt = '';
    if (analysis.similarExperiences.length > 0) {
      const successes = analysis.similarExperiences.filter(e => e.experience.result === 'success');
      const failures = analysis.similarExperiences.filter(e => e.experience.result === 'failure');
      
      if (successes.length > 0) {
        experiencePrompt += `\n成功案例:\n${successes.slice(0, 2).map(e => 
          `- 输入: ${e.experience.userInput.slice(0, 50)}\n  工具: ${e.experience.tool}`
        ).join('\n')}\n`;
      }
      
      if (failures.length > 0) {
        experiencePrompt += `\n失败案例（请避免）:\n${failures.slice(0, 2).map(e => 
          `- 输入: ${e.experience.userInput.slice(0, 50)}\n  工具: ${e.experience.tool}`
        ).join('\n')}\n`;
      }
    }
    
    const toolsDesc = allTools.map(t => `- ${t.name}: ${t.description}`).join('\n');
    
    const prompt = `请为以下任务生成执行计划。

用户请求: ${userInput}
任务类型: ${analysis.taskType}
复杂度: ${analysis.complexity}

成功标准:
${analysis.successCriteria.map((c, i) => `${i + 1}. ${c.description}`).join('\n')}

可用工具:
${toolsDesc}
${experiencePrompt}
请输出JSON格式：
{
  "tool": "工具名称",
  "params": { "参数名": "参数值" },
  "reasoning": "选择原因",
  "risks": ["风险"]
}`;

    try {
      const response = await this.llm.chat([
        { role: 'system', content: '你是一个任务执行专家，擅长选择合适的工具和参数。' },
        { role: 'user', content: prompt },
      ], { temperature: 0.2 });
      
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        const toolExists = allTools.some(t => t.name === parsed.tool);
        if (!toolExists) {
          logger.warn(`[统一执行器] 工具不存在: ${parsed.tool}`);
        }
        
        return {
          id: `plan_${++this.planCounter}_${Date.now()}`,
          tool: parsed.tool || (allTools[0]?.name || 'unknown'),
          params: parsed.params || {},
          reasoning: parsed.reasoning || '',
          expectedOutput: parsed.expectedOutput,
          risks: parsed.risks || [],
        };
      }
    } catch (error) {
      logger.error(`[统一执行器] 生成计划失败: ${error}`);
    }
    
    return {
      id: `plan_${++this.planCounter}_${Date.now()}`,
      tool: allTools[0]?.name || 'unknown',
      params: {},
      reasoning: '默认计划',
      risks: [],
    };
  }
  
  private async executePlan(
    plan: ExecutionPlan,
    context: ExecutionContext
  ): Promise<ExecutionOutput> {
    const startTime = Date.now();
    
    logger.info(`[统一执行器] 执行计划: ${plan.tool}`);
    
    try {
      const skill = this.skillRegistry.get(plan.tool);
      if (skill) {
        const result = await this.executeSkill(skill, plan.params, context);
        return {
          success: result.success,
          tool: plan.tool,
          params: plan.params,
          output: result.message,
          error: result.error,
          data: result.data,
          duration: Date.now() - startTime,
        };
      }
      
      const tool = this.toolRegistry.get(plan.tool);
      if (tool) {
        const result = await this.executeTool(tool, plan.params, context);
        return {
          success: result.success,
          tool: plan.tool,
          params: plan.params,
          output: result.success ? JSON.stringify(result.data) : '',
          error: result.error,
          data: result.data as Record<string, unknown> | undefined,
          duration: Date.now() - startTime,
        };
      }
      
      return {
        success: false,
        tool: plan.tool,
        params: plan.params,
        error: `工具不存在: ${plan.tool}`,
        duration: Date.now() - startTime,
      };
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      return {
        success: false,
        tool: plan.tool,
        params: plan.params,
        error: errorMsg,
        duration: Date.now() - startTime,
      };
    }
  }
  
  private async executeSkill(
    skill: Skill,
    params: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<{ success: boolean; message?: string; error?: string; data?: any }> {
    try {
      const result = await skill.run(params, {
        sessionId: context.sessionId,
        conversationId: context.conversationId,
        userId: context.userId,
      });
      
      return {
        success: result.success,
        message: result.message,
        error: result.error,
        data: result.data,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  private async executeTool(
    tool: any,
    params: Record<string, unknown>,
    context: ExecutionContext
  ): Promise<ToolResult> {
    try {
      const result = await tool.safeExecute(params, {
        sessionId: context.sessionId,
        conversationId: context.conversationId,
      });
      
      return result;
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        data: {},
        duration: 0,
      };
    }
  }
  
  private createExperience(
    userInput: string,
    analysis: TaskAnalysis,
    plan: ExecutionPlan,
    output: ExecutionOutput,
    validation: OverallValidation,
    diagnosis?: FailureDiagnosis,
    attempts?: number
  ): ExecutionExperience {
    return {
      id: `exp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userInput,
      intent: analysis.taskType,
      tool: plan.tool,
      params: plan.params,
      result: output.success ? 'success' : 'failure',
      output: output.output,
      error: output.error,
      successCriteria: analysis.successCriteria,
      validationResults: validation.results,
      diagnosis,
      duration: output.duration,
      timestamp: Date.now(),
      sessionId: '',
      verified: false,
      confidence: validation.score,
    };
  }
  
  private async generateResponse(
    userInput: string,
    tool: string,
    output: ExecutionOutput,
    validation: OverallValidation
  ): Promise<string> {
    const prompt = `根据执行结果回答用户的问题。

用户问题: ${userInput}
执行工具: ${tool}
执行结果: ${output.success ? '成功' : '失败'}
输出内容: ${output.output?.slice(0, 500) || '(无)'}
错误信息: ${output.error || '(无)'}
验证结果: ${validation.summary}

请用自然语言回答用户，风格要自然、简洁。`;

    try {
      const response = await this.llm.chat([
        { role: 'system', content: '你是白泽，一个智能助手。回答要自然、简洁，像朋友一样交流。' },
        { role: 'user', content: prompt },
      ], { temperature: 0.7 });
      
      return response.content;
    } catch (error) {
      if (output.success) {
        return output.output || '执行成功';
      } else {
        return `执行失败: ${output.error || '未知错误'}`;
      }
    }
  }
  
  /**
   * 直接回复（不调用工具）
   */
  private async generateDirectResponse(userInput: string): Promise<string> {
    try {
      const response = await this.llm.chat([
        { 
          role: 'system', 
          content: `你是白泽，一个友好、智能的助手。
回答要自然、简洁，像朋友一样交流。
如果是问候，友好地回应。
如果是问题，尽力回答。`
        },
        { role: 'user', content: userInput }
      ], { temperature: 0.7 });
      
      return response.content;
    } catch (error) {
      // 降级处理
      if (userInput.includes('你好') || userInput.includes('hi') || userInput.includes('hello')) {
        return '你好！有什么我可以帮助你的吗？';
      }
      return '抱歉，我暂时无法处理这个请求。';
    }
  }
  
  getStats() {
    return this.experienceStore.getStats();
  }
}

let unifiedExecutorInstance: UnifiedExecutor | null = null;

export function getUnifiedExecutor(): UnifiedExecutor {
  if (!unifiedExecutorInstance) {
    unifiedExecutorInstance = new UnifiedExecutor();
  }
  return unifiedExecutorInstance;
}

export function resetUnifiedExecutor(): void {
  unifiedExecutorInstance = null;
}
