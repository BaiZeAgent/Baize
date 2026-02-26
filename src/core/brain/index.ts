/**
 * 大脑 - OpenClaw 风格
 * 
 * 核心逻辑：
 * 1. 路由判断 -> 2. 执行技能 -> 3. LLM 处理结果
 */

import fs from 'fs';
import path from 'path';
import { getSmartRouter } from '../router';
import { getExecutor } from '../../executor';
import { getLLMManager } from '../../llm';
import { getSkillRegistry } from '../../skills/registry';
import { getLogger } from '../../observability/logger';
import { LLMMessage } from '../../types';
import { StreamEvent, StreamEventData } from '../../types/stream';

const logger = getLogger('core:brain');

export type IntentType = 'greeting' | 'farewell' | 'thanks' | 'chat' | 'task';

export interface Decision {
  intent: IntentType;
  action: 'reply' | 'execute';
  response?: string;
  skillName?: string;
  skillResult?: string;
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

    try {
      // 1. 路由判断
      const decision = await this.router.route({ userInput });
      
      yield {
        type: 'thinking',
        timestamp: Date.now(),
        data: { stage: 'decide', message: `决策: ${decision.action}` }
      };

      if (decision.action === 'reply') {
        // 直接回复
        yield* this.streamContent(decision.content || '好的');
        this.history.push({ role: 'assistant', content: decision.content || '' });
      } 
      else if (decision.action === 'tool') {
        // 执行技能
        const toolName = decision.toolName || '';
        yield {
          type: 'tool_call',
          timestamp: Date.now(),
          data: { tool: toolName, params: decision.toolParams || {}, reason: decision.reason || '' }
        };

        const result = await this.executor.executeSkill(
          toolName,
          decision.toolParams || {}
        );

        yield {
          type: 'tool_result',
          timestamp: Date.now(),
          data: { tool: toolName, success: result.success, duration: result.duration }
        };

        // LLM 处理结果
        const response = await this.processResult(
          userInput,
          decision.toolName!,
          result.output || result.error || ''
        );

        yield* this.streamContent(response);
        this.history.push({ role: 'assistant', content: response });
      }
      else {
        // 复杂任务，让 LLM 处理
        const response = await this.handleComplex(userInput);
        yield* this.streamContent(response);
        this.history.push({ role: 'assistant', content: response });
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
   * 处理用户输入（非流式）
   */
  async process(userInput: string): Promise<Decision> {
    logger.info(`大脑处理: ${userInput.slice(0, 50)}...`);

    this.history.push({ role: 'user', content: userInput });

    // 路由判断
    const decision = await this.router.route({ userInput });

    if (decision.action === 'reply') {
      this.history.push({ role: 'assistant', content: decision.content || '' });
      return {
        intent: 'chat',
        action: 'reply',
        response: decision.content,
        confidence: 0.9,
        reason: decision.reason || '直接回复',
      };
    }

    if (decision.action === 'tool') {
      const result = await this.executor.executeSkill(
        decision.toolName!,
        decision.toolParams || {}
      );

      const response = await this.processResult(
        userInput,
        decision.toolName!,
        result.output || result.error || ''
      );

      this.history.push({ role: 'assistant', content: response });

      return {
        intent: 'task',
        action: 'execute',
        skillName: decision.toolName,
        skillResult: result.output,
        response,
        confidence: 0.9,
        reason: `执行技能: ${decision.toolName}`,
      };
    }

    // 复杂任务
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
   * LLM 处理技能结果
   */
  private async processResult(
    userInput: string,
    skillName: string,
    rawResult: string
  ): Promise<string> {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是白泽，一个智能助手。根据技能执行结果回答用户的问题。
风格：自然、简洁，像朋友一样交流。
不要说"根据查询结果"这种话，直接说结论。`
      },
      {
        role: 'user',
        content: `用户问题: ${userInput}\n\n技能: ${skillName}\n结果: ${rawResult}\n\n请用自然语言回答：`
      }
    ];

    const response = await this.llm.chat(messages, { temperature: 0.7 });
    return response.content;
  }

  /**
   * 处理复杂任务
   */
  private async handleComplex(userInput: string): Promise<string> {
    const skills = this.skillRegistry.getAll();
    const skillsDesc = skills.map(s => `- ${s.name}: ${s.description}`).join('\n');

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是白泽，一个智能助手。

${this.soulContent ? `---\n${this.soulContent}\n---\n` : ''}

## 可用技能
${skillsDesc}

## 规则
1. 如果需要使用技能，返回 JSON: {"skill": "技能名", "params": {...}}
2. 如果可以直接回答，直接回复用户
3. 如果没有相关技能，诚实说明`
      },
      ...this.history.slice(-10).map(h => ({ role: h.role, content: h.content })),
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
