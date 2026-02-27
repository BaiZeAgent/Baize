/**
 * 大脑 - ReAct 模式
 * 
 * 实现 OpenClaw 风格的 ReAct 循环：
 * 1. Thought (思考): LLM 分析当前状态
 * 2. Action (行动): 执行工具/技能
 * 3. Observation (观察): 获取执行结果
 * 4. 循环直到完成或失败
 */

import fs from 'fs';
import path from 'path';
import { getSmartRouter } from '../router';
import { getExecutor } from '../../executor';
import { getLLMManager } from '../../llm';
import { getSkillRegistry } from '../../skills/registry';
import { getToolRegistry } from '../../tools';
import { getGapDetector } from '../../evolution/gap';
import { getMemory } from '../../memory';
import { getLogger } from '../../observability/logger';
import { LLMMessage, CapabilityGap } from '../../types';
import { StreamEvent } from '../../types/stream';
import { SkillLoader } from '../../skills/loader';
import { registerBuiltinSkills } from '../../skills/builtins';

const logger = getLogger('core:brain');

export type IntentType = 'greeting' | 'farewell' | 'thanks' | 'chat' | 'task';

export interface Decision {
  intent: IntentType;
  action: 'reply' | 'execute' | 'gap_detected';
  response?: string;
  skillName?: string;
  skillResult?: string;
  capabilityGap?: CapabilityGap;
  confidence: number;
  reason: string;
}

/**
 * ReAct 状态
 */
interface ReActState {
  thought: string;
  action: string;
  actionInput: Record<string, unknown>;
  observation?: string;
  finished: boolean;
  response?: string;
}

/**
 * 大脑
 */
export class Brain {
  private router = getSmartRouter();
  private executor = getExecutor();
  private llm = getLLMManager();
  private skillRegistry = getSkillRegistry();
  private toolRegistry = getToolRegistry();
  private gapDetector = getGapDetector();
  private memory = getMemory();
  private history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  private soulContent: string = '';
  
  // ReAct 配置
  private maxIterations: number = 5;
  private iterationCount: number = 0;
  
  // 技能加载状态
  private static skillsLoaded = false;
  private static skillsLoading = false;

  constructor() {
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
        logger.info(`已加载 SOUL.md: ${soulPath}`);
        return;
      }
    }
  }

  /**
   * 确保技能已加载
   * 延迟加载技能，避免在构造函数中加载
   */
  private async ensureSkillsLoaded(): Promise<void> {
    if (Brain.skillsLoaded) return;
    
    // 防止重复加载
    if (Brain.skillsLoading) {
      // 等待加载完成
      while (Brain.skillsLoading) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return;
    }
    
    Brain.skillsLoading = true;
    
    try {
      // 注册内置技能
      registerBuiltinSkills();
      
      // 加载外部技能
      const loader = new SkillLoader();
      const skills = await loader.loadAll();
      for (const skill of skills) {
        this.skillRegistry.register(skill);
      }
      
      Brain.skillsLoaded = true;
      logger.info(`技能加载完成，共 ${this.skillRegistry.size} 个技能`);
    } catch (error) {
      logger.error(`技能加载失败: ${error}`);
    } finally {
      Brain.skillsLoading = false;
    }
  }

  /**
   * 流式处理 - ReAct 模式
   */
  async *processStream(userInput: string, sessionId: string = 'default'): AsyncGenerator<StreamEvent> {
    // 确保技能已加载
    await this.ensureSkillsLoaded();
    
    const startTime = Date.now();
    
    logger.info(`处理: ${userInput.slice(0, 50)}...`);

    this.history.push({ role: 'user', content: userInput });
    if (this.history.length > 20) {
      this.history = this.history.slice(-20);
    }

    this.memory.recordEpisode('conversation', `用户: ${userInput}`);

    try {
      // 1. 初始路由判断
      const decision = await this.router.route({ 
        userInput, 
        history: this.history 
      });
      
      yield {
        type: 'thinking',
        timestamp: Date.now(),
        data: { stage: 'decide', message: `决策: ${decision.action}` }
      };

      if (decision.action === 'reply') {
        // 直接回复
        const content = decision.content || '好的';
        yield* this.streamContent(content);
        this.history.push({ role: 'assistant', content });
        this.memory.recordEpisode('conversation', `白泽: ${content}`);
      } 
      else if (decision.action === 'tool') {
        // ReAct 循环执行
        yield* this.reActLoop(userInput, decision.toolName || '', decision.toolParams || {});
      }
      else {
        // plan - 让 LLM 处理
        yield* this.handlePlan(userInput);
      }

      yield {
        type: 'done',
        timestamp: Date.now(),
        data: { duration: Date.now() - startTime }
      };

    } catch (error) {
      logger.error(`处理失败: ${error}`);
      yield {
        type: 'error',
        timestamp: Date.now(),
        data: { code: 'ERROR', message: String(error) }
      };
    }
  }

  /**
   * ReAct 循环
   */
  private async *reActLoop(
    userInput: string, 
    initialTool: string, 
    initialParams: Record<string, unknown>
  ): AsyncGenerator<StreamEvent> {
    this.iterationCount = 0;
    let currentState: ReActState = {
      thought: '',
      action: initialTool,
      actionInput: initialParams,
      observation: '',
      finished: false,
    };

    const reactHistory: string[] = [];

    while (!currentState.finished && this.iterationCount < this.maxIterations) {
      this.iterationCount++;
      
      yield {
        type: 'thinking',
        timestamp: Date.now(),
        data: { stage: 'thought', message: `思考中... (迭代 ${this.iterationCount}/${this.maxIterations})` }
      };

      // 1. Thought - 思考下一步
      if (this.iterationCount > 1 || !currentState.action) {
        const thought = await this.think(userInput, reactHistory);
        currentState = { ...currentState, ...thought };
      }

      if (currentState.finished) {
        // 任务完成
        const response = currentState.response || '任务已完成';
        yield* this.streamContent(response);
        this.history.push({ role: 'assistant', content: response });
        this.memory.recordEpisode('conversation', `白泽: ${response}`);
        return;
      }

      // 2. Action - 执行行动
      yield {
        type: 'tool_call',
        timestamp: Date.now(),
        data: { tool: currentState.action, params: currentState.actionInput }
      };

      const observation = await this.executeAction(currentState.action, currentState.actionInput);
      
      // 3. Observation - 观察结果
      yield {
        type: 'tool_result',
        timestamp: Date.now(),
        data: { tool: currentState.action, success: observation.success, duration: observation.duration }
      };

      currentState.observation = observation.output;

      // 记录到历史
      reactHistory.push(`Thought: ${currentState.thought}`);
      reactHistory.push(`Action: ${currentState.action}`);
      reactHistory.push(`Observation: ${observation.output}`);

      // 4. 验证结果
      const validation = await this.validateResult(userInput, observation, currentState.action);
      
      if (validation.needsRetry && this.iterationCount < this.maxIterations) {
        // 需要重试
        yield {
          type: 'thinking',
          timestamp: Date.now(),
          data: { stage: 'retry', message: `结果不理想，尝试其他方案...` }
        };
        currentState.action = validation.alternativeAction || '';
        currentState.actionInput = validation.alternativeParams || {};
        continue;
      }

      if (validation.finished) {
        // 任务完成
        currentState.finished = true;
        currentState.response = validation.response;
      }
    }

    // 返回最终结果
    if (!currentState.finished) {
      // 达到最大迭代次数
      const response = await this.summarizeResult(userInput, reactHistory);
      yield* this.streamContent(response);
      this.history.push({ role: 'assistant', content: response });
    } else if (currentState.response) {
      yield* this.streamContent(currentState.response);
      this.history.push({ role: 'assistant', content: currentState.response });
    }
  }

  /**
   * Thought - 思考下一步
   * 
   * v3.2.1 优化：提供完整的技能参数模式
   */
  private async think(userInput: string, history: string[]): Promise<ReActState> {
    const tools = this.toolRegistry.getAll();
    const skills = this.skillRegistry.getAll();
    
    // 生成详细的技能描述，包含参数模式
    const skillsDesc = skills.map(s => {
      const schema = s.inputSchema as {
        required?: string[];
        properties?: Record<string, {
          type?: string;
          enum?: string[];
          description?: string;
        }>;
      };
      
      let paramDesc = '';
      if (schema?.properties) {
        const props = Object.entries(schema.properties).map(([name, prop]) => {
          const required = schema.required?.includes(name) ? '（必填）' : '';
          const enumValues = prop.enum ? ` [可选值: ${prop.enum.join(', ')}]` : '';
          return `    - ${name}${required}: ${prop.description || prop.type || '未知'}${enumValues}`;
        }).join('\n');
        paramDesc = `\n  参数:\n${props}`;
      }
      
      return `${s.name}: ${s.description}${paramDesc}`;
    }).join('\n\n');

    const toolsDescSimple = tools.map(t => `${t.name}: ${t.description}`).join('\n');

    const historyText = history.join('\n');

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个智能助手的思考模块。使用 ReAct 模式处理任务。

## 可用技能（带参数说明）

${skillsDesc}

## 可用工具

${toolsDescSimple}

## 关键规则

1. **参数必须精确**：使用技能时，必须使用参数说明中列出的可选值
2. **action 参数**：如果参数说明中有 [可选值: xxx, yyy]，必须使用其中的值
3. 分析当前状态和用户目标
4. 决定下一步行动
5. 如果任务已完成，设置 finished=true 并给出回复

## 返回格式

返回 JSON:
{
  "thought": "当前思考（分析应该使用什么参数）",
  "action": "技能名称",
  "actionInput": { "action": "必须使用可选值中的值", "path": "路径" },
  "finished": false,
  "response": "如果finished=true，这里是最终回复"
}`
      },
      {
        role: 'user',
        content: `用户目标: ${userInput}

历史记录:
${historyText || '(无)'}

请思考下一步，确保参数正确。`
      }
    ];

    try {
      const response = await this.llm.chat(messages, { temperature: 0.1 });
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        // 验证并自动修正参数
        result.actionInput = this.validateAndCorrectParams(result.action, result.actionInput || {});
        return result;
      }
    } catch (error) {
      logger.error(`思考失败: ${error}`);
    }

    return { thought: '继续尝试', action: 'reply', actionInput: {}, observation: '', finished: true, response: '抱歉，我无法完成这个任务。' };
  }

  /**
   * 验证并自动修正参数
   */
  private validateAndCorrectParams(skillName: string, params: Record<string, unknown>): Record<string, unknown> {
    const skill = this.skillRegistry.get(skillName);
    if (!skill) return params;

    const schema = skill.inputSchema as {
      properties?: Record<string, { enum?: string[] }>;
    };

    if (!schema?.properties) return params;

    const correctedParams = { ...params };

    for (const [paramName, prop] of Object.entries(schema.properties)) {
      if (prop.enum && params[paramName] !== undefined) {
        const currentValue = String(params[paramName]);
        if (!prop.enum.includes(currentValue)) {
          // 自动修正为第一个有效值
          correctedParams[paramName] = prop.enum[0];
          logger.info(`自动修正参数: ${paramName} 从 "${currentValue}" 改为 "${prop.enum[0]}"`);
        }
      }
    }

    return correctedParams;
  }

  /**
   * 执行行动
   * 
   * v3.2.1 优化：增加参数验证和自动修正
   */
  private async executeAction(
    action: string, 
    actionInput: Record<string, unknown>
  ): Promise<{ success: boolean; output: string; duration: number }> {
    const startTime = Date.now();

    if (action === 'reply') {
      return { success: true, output: String(actionInput.message || ''), duration: Date.now() - startTime };
    }

    const isTool = this.toolRegistry.has(action);
    const isSkill = !!this.skillRegistry.get(action);

    if (!isTool && !isSkill) {
      return { success: false, output: `工具不存在: ${action}`, duration: Date.now() - startTime };
    }

    // 先验证参数
    let params = { ...actionInput };
    
    if (isSkill) {
      // 先进行参数验证
      params = this.validateAndCorrectParams(action, params);
    }

    const result = await this.executor.executeSkill(action, params);

    // 如果失败且是参数错误，尝试自动修正
    if (!result.success && result.error) {
      const errorMsg = result.error;
      if (errorMsg.includes('未知操作') || errorMsg.includes('参数值错误')) {
        // 尝试从错误中提取正确值
        const correctedParams = this.correctParamsFromError(action, params, errorMsg);
        if (correctedParams) {
          logger.info(`参数错误自动重试: ${action}`, { 
            original: params, 
            corrected: correctedParams 
          });
          
          const retryResult = await this.executor.executeSkill(action, correctedParams);
          return {
            success: retryResult.success,
            output: retryResult.output || retryResult.error || '',
            duration: Date.now() - startTime,
          };
        }
      }
    }

    return {
      success: result.success,
      output: result.output || result.error || '',
      duration: result.duration || Date.now() - startTime,
    };
  }

  /**
   * 从错误消息中修正参数
   */
  private correctParamsFromError(
    skillName: string, 
    params: Record<string, unknown>,
    errorMsg: string
  ): Record<string, unknown> | null {
    const skill = this.skillRegistry.get(skillName);
    if (!skill) return null;

    const schema = skill.inputSchema as {
      properties?: Record<string, { enum?: string[] }>;
    };
    if (!schema?.properties) return null;

    const correctedParams = { ...params };
    let hasCorrection = false;

    // 检测"未知操作"错误
    const unknownOpMatch = errorMsg.match(/未知操作:\s*(\w+)/i);
    if (unknownOpMatch && schema.properties.action?.enum) {
      correctedParams.action = schema.properties.action.enum[0];
      hasCorrection = true;
      logger.info(`修正未知操作: ${unknownOpMatch[1]} -> ${correctedParams.action}`);
    }

    // 检测参数值错误
    const enumMatch = errorMsg.match(/可选值:\s*([^\n]+)/i);
    const paramMatch = errorMsg.match(/参数值错误:\s*(\w+)/);
    
    if (enumMatch && paramMatch) {
      const validOptions = enumMatch[1].split(',').map(s => s.trim()).filter(s => s);
      const paramName = paramMatch[1];
      if (validOptions.length > 0) {
        correctedParams[paramName] = validOptions[0];
        hasCorrection = true;
        logger.info(`修正参数错误: ${paramName} -> ${validOptions[0]}`);
      }
    }

    return hasCorrection ? correctedParams : null;
  }

  /**
   * 验证结果
   */
  private async validateResult(
    userInput: string, 
    observation: { success: boolean; output: string },
    action: string
  ): Promise<{ finished: boolean; needsRetry: boolean; response?: string; alternativeAction?: string; alternativeParams?: Record<string, unknown> }> {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个结果验证器。判断执行结果是否完成了用户的目标。

返回 JSON:
{
  "finished": true/false,
  "needsRetry": true/false,
  "reason": "判断原因",
  "response": "如果finished=true，给用户的回复",
  "alternativeAction": "如果needsRetry=true，建议的其他工具",
  "alternativeParams": {}
}

规则:
1. 如果执行成功且完成了用户目标，finished=true
2. 如果执行失败或结果不符合预期，needsRetry=true
3. 不要编造结果，诚实判断`
      },
      {
        role: 'user',
        content: `用户目标: ${userInput}

执行工具: ${action}
执行结果: ${observation.output}
执行状态: ${observation.success ? '成功' : '失败'}

请判断是否完成了用户目标。`
      }
    ];

    try {
      const response = await this.llm.chat(messages, { temperature: 0.1 });
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      logger.error(`验证失败: ${error}`);
    }

    // 默认：如果执行成功就认为完成
    return {
      finished: observation.success,
      needsRetry: !observation.success,
      response: observation.output,
    };
  }

  /**
   * 总结结果
   */
  private async summarizeResult(userInput: string, history: string[]): Promise<string> {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个智能助手。根据执行历史，给用户一个诚实的回复。

规则:
1. 如果任务完成，告诉用户结果
2. 如果任务未完成，诚实说明
3. 不要编造结果`
      },
      {
        role: 'user',
        content: `用户目标: ${userInput}

执行历史:
${history.join('\n')}

请给用户一个回复。`
      }
    ];

    const response = await this.llm.chat(messages, { temperature: 0.7 });
    return response.content;
  }

  /**
   * 处理 plan 动作
   */
  private async *handlePlan(userInput: string): AsyncGenerator<StreamEvent> {
    const response = await this.handleComplex(userInput);
    
    const needsCapability = response.includes('需要') && 
                           (response.includes('能力') || response.includes('技能'));
    
    if (needsCapability) {
      const gap = await this.gapDetector.detect(
        userInput, 
        this.skillRegistry.getAll().map(s => s.toInfo())
      );
      
      if (gap) {
        yield {
          type: 'thinking',
          timestamp: Date.now(),
          data: { stage: 'gap_detected', message: `检测到能力缺口: ${gap.missingCapabilities.join(', ')}` }
        };
        
        const gapResponse = this.gapDetector.generatePrompt(gap);
        yield* this.streamContent(gapResponse);
        this.history.push({ role: 'assistant', content: gapResponse });
        return;
      }
    }
    
    yield* this.streamContent(response);
    this.history.push({ role: 'assistant', content: response });
  }

  /**
   * 处理用户输入（非流式）
   */
  async process(userInput: string): Promise<Decision> {
    // 确保技能已加载
    await this.ensureSkillsLoaded();
    
    logger.info(`大脑处理: ${userInput.slice(0, 50)}...`);

    this.history.push({ role: 'user', content: userInput });
    this.memory.recordEpisode('conversation', `用户: ${userInput}`);

    const decision = await this.router.route({ 
      userInput, 
      history: this.history 
    });

    if (decision.action === 'reply') {
      const content = decision.content || '好的';
      this.history.push({ role: 'assistant', content });
      return {
        intent: 'chat',
        action: 'reply',
        response: content,
        confidence: 0.9,
        reason: decision.reason || '直接回复',
      };
    }

    if (decision.action === 'tool') {
      // 使用 ReAct 循环
      let result = '';
      for await (const event of this.reActLoop(userInput, decision.toolName || '', decision.toolParams || {})) {
        if (event.type === 'content') {
          result += (event.data as any).text || '';
        }
      }
      
      return {
        intent: 'task',
        action: 'execute',
        response: result,
        confidence: 0.9,
        reason: `ReAct 循环完成 (${this.iterationCount} 次迭代)`,
      };
    }

    const response = await this.handleComplex(userInput);
    this.history.push({ role: 'assistant', content: response });
    
    return {
      intent: 'chat',
      action: 'reply',
      response,
      confidence: 0.8,
      reason: '复杂任务处理',
    };
  }

  /**
   * 处理复杂任务
   */
  private async handleComplex(userInput: string): Promise<string> {
    const tools = this.toolRegistry.getAll();
    const skills = this.skillRegistry.getAll();
    
    const toolsDesc = [...tools.map(t => `- ${t.name}: ${t.description}`), 
                       ...skills.map(s => `- ${s.name}: ${s.description}`)].join('\n');

    const historyText = this.history.slice(-10).map(h => 
      `${h.role === 'user' ? '用户' : '白泽'}: ${h.content}`
    ).join('\n');

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是白泽，一个智能助手。

${this.soulContent ? `---\n${this.soulContent}\n---\n` : ''}

## 可用工具
${toolsDesc}

## 对话历史
${historyText}

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

  /**
   * 流式输出内容
   */
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

  getHistory(): Array<{ role: 'user' | 'assistant'; content: string }> {
    return [...this.history];
  }

  clearHistory(): void {
    this.history = [];
  }

  /**
   * 重置技能加载状态（用于测试或重新加载技能）
   */
  static resetSkillsLoaded(): void {
    Brain.skillsLoaded = false;
    Brain.skillsLoading = false;
  }
}

let brainInstance: Brain | null = null;

export function getBrain(): Brain {
  if (!brainInstance) {
    brainInstance = new Brain();
  }
  return brainInstance;
}

export function resetBrain(): void {
  brainInstance = null;
  Brain.resetSkillsLoaded();
}
