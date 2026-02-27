/**
 * 大脑 - OpenClaw 风格
 * 
 * 核心逻辑：
 * 1. 路由判断 -> 2. 执行工具/技能 -> 3. LLM 处理结果
 * 4. 如果工具不存在/失败 -> 能力缺口检测
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
   * 流式处理
   */
  async *processStream(userInput: string, sessionId: string = 'default'): AsyncGenerator<StreamEvent> {
    const startTime = Date.now();
    
    logger.info(`处理: ${userInput.slice(0, 50)}...`);

    // 添加到历史
    this.history.push({ role: 'user', content: userInput });
    if (this.history.length > 20) {
      this.history = this.history.slice(-20);
    }

    // 记录到情景记忆
    this.memory.recordEpisode('conversation', `用户: ${userInput}`);

    try {
      // 1. 路由判断（传入历史）
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
        // 执行工具或技能
        yield* this.executeTool(userInput, decision.toolName || '', decision.toolParams || {});
      }
      else {
        // plan - 先尝试 LLM 处理，如果发现能力缺口再检测
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
   * 执行工具
   */
  private async *executeTool(
    userInput: string, 
    toolName: string, 
    toolParams: Record<string, unknown>
  ): AsyncGenerator<StreamEvent> {
    // 检查工具或技能是否存在
    const isTool = this.toolRegistry.has(toolName);
    const isSkill = !!this.skillRegistry.get(toolName);
    
    if (!isTool && !isSkill) {
      // 不存在，触发能力缺口检测
      yield* this.handleCapabilityGap(userInput);
      return;
    }

    yield {
      type: 'tool_call',
      timestamp: Date.now(),
      data: { tool: toolName, params: toolParams, reason: '' }
    };

    const result = await this.executor.executeSkill(toolName, toolParams);

    yield {
      type: 'tool_result',
      timestamp: Date.now(),
      data: { tool: toolName, success: result.success, duration: result.duration }
    };

    if (result.success) {
      // LLM 处理结果
      const response = await this.processResult(userInput, toolName, result.output || '');
      yield* this.streamContent(response);
      this.history.push({ role: 'assistant', content: response });
      this.memory.recordEpisode('conversation', `白泽: ${response}`);
    } else {
      // 执行失败
      const response = `执行 ${toolName} 时出错: ${result.error}`;
      yield* this.streamContent(response);
      this.history.push({ role: 'assistant', content: response });
    }
  }

  /**
   * 处理 plan 动作
   */
  private async *handlePlan(userInput: string): AsyncGenerator<StreamEvent> {
    // 先让 LLM 尝试处理
    const response = await this.handleComplex(userInput);
    
    // 检查 LLM 是否表示需要某个能力
    const needsCapability = response.includes('需要') && 
                           (response.includes('能力') || response.includes('技能'));
    
    if (needsCapability) {
      // LLM 表示需要某个能力，触发能力缺口检测
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
        this.memory.recordEpisode('conversation', `白泽: ${gapResponse}`);
        return;
      }
    }
    
    // 正常回复
    yield* this.streamContent(response);
    this.history.push({ role: 'assistant', content: response });
    this.memory.recordEpisode('conversation', `白泽: ${response}`);
  }

  /**
   * 处理能力缺口
   */
  private async *handleCapabilityGap(userInput: string): AsyncGenerator<StreamEvent> {
    yield {
      type: 'thinking',
      timestamp: Date.now(),
      data: { stage: 'gap_check', message: '工具不存在，检测能力缺口...' }
    };

    const gap = await this.gapDetector.detect(userInput, this.skillRegistry.getAll().map(s => s.toInfo()));
    
    if (gap) {
      const response = this.gapDetector.generatePrompt(gap);
      yield* this.streamContent(response);
      this.history.push({ role: 'assistant', content: response });
      this.memory.recordEpisode('conversation', `白泽: ${response}`);
    } else {
      const response = '抱歉，我暂时没有相关能力来完成这个任务。';
      yield* this.streamContent(response);
      this.history.push({ role: 'assistant', content: response });
    }
  }

  /**
   * 处理用户输入（非流式）
   */
  async process(userInput: string): Promise<Decision> {
    logger.info(`大脑处理: ${userInput.slice(0, 50)}...`);

    this.history.push({ role: 'user', content: userInput });
    this.memory.recordEpisode('conversation', `用户: ${userInput}`);

    // 路由判断
    const decision = await this.router.route({ 
      userInput, 
      history: this.history 
    });

    if (decision.action === 'reply') {
      const content = decision.content || '好的';
      this.history.push({ role: 'assistant', content });
      this.memory.recordEpisode('conversation', `白泽: ${content}`);
      return {
        intent: 'chat',
        action: 'reply',
        response: content,
        confidence: 0.9,
        reason: decision.reason || '直接回复',
      };
    }

    if (decision.action === 'tool') {
      const toolName = decision.toolName || '';
      const isTool = this.toolRegistry.has(toolName);
      const isSkill = !!this.skillRegistry.get(toolName);
      
      if (!isTool && !isSkill) {
        const gap = await this.gapDetector.detect(userInput, this.skillRegistry.getAll().map(s => s.toInfo()));
        const response = gap ? this.gapDetector.generatePrompt(gap) : '工具不存在';
        return {
          intent: 'task',
          action: 'gap_detected',
          capabilityGap: gap || undefined,
          response,
          confidence: 0.8,
          reason: `工具不存在: ${toolName}`,
        };
      }

      const result = await this.executor.executeSkill(toolName, decision.toolParams || {});

      if (result.success) {
        const response = await this.processResult(userInput, toolName, result.output || '');
        this.history.push({ role: 'assistant', content: response });
        this.memory.recordEpisode('conversation', `白泽: ${response}`);
        return {
          intent: 'task',
          action: 'execute',
          skillName: toolName,
          skillResult: result.output,
          response,
          confidence: 0.9,
          reason: `执行工具: ${toolName}`,
        };
      } else {
        return {
          intent: 'task',
          action: 'execute',
          skillName: toolName,
          response: `执行失败: ${result.error}`,
          confidence: 0.7,
          reason: `工具执行失败: ${result.error}`,
        };
      }
    }

    // plan - 先尝试 LLM 处理
    const response = await this.handleComplex(userInput);
    this.history.push({ role: 'assistant', content: response });
    this.memory.recordEpisode('conversation', `白泽: ${response}`);

    return {
      intent: 'chat',
      action: 'reply',
      response,
      confidence: 0.8,
      reason: '复杂任务处理',
    };
  }

  /**
   * LLM 处理技能结果
   */
  private async processResult(
    userInput: string,
    toolName: string,
    rawResult: string
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
        content: `用户问题: ${userInput}\n\n工具: ${toolName}\n结果: ${rawResult}\n\n请用自然语言回答：`
      }
    ];

    const response = await this.llm.chat(messages, { temperature: 0.7 });
    return response.content;
  }

  /**
   * 处理复杂任务
   */
  private async handleComplex(userInput: string): Promise<string> {
    const tools = this.toolRegistry.getAll();
    const skills = this.skillRegistry.getAll();
    
    const toolsDesc = [...tools.map(t => `- ${t.name}: ${t.description}`), ...skills.map(s => `- ${s.name}: ${s.description}`)].join('\n');

    // 构建历史
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
3. 如果用户问的是之前对话中提到的内容，根据历史回答
4. 如果没有相关工具，诚实说明，不要编造能力
5. 回答要自然、简洁，像朋友一样`
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
}
