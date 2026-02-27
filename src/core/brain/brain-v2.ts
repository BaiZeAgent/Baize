/**
 * 大脑 V2 - OpenClaw 风格
 * 
 * 核心改进：
 * 1. 完整的 ReAct 循环
 * 2. 流式工具调用状态
 * 3. 上下文管理
 * 4. 错误恢复
 * 
 * 参考：OpenClaw pi-embedded-runner/run.ts
 */

import fs from 'fs';
import path from 'path';
import { getSmartRouter } from '../router';
import { getExecutor } from '../../executor';
import { getLLMManager } from '../../llm';
import { getSkillRegistry } from '../../skills/registry';
import { getLogger } from '../../observability/logger';
import { getMemory } from '../../memory';
import { LLMMessage, Task, RiskLevel } from '../../types';
import { StreamEvent } from '../../types/stream';
import { 
  ReActExecutorV2, 
  getReActExecutorV2,
  ExecutionHooks,
  ToolCallEvent,
  ToolResultEvent,
} from '../../executor/react-executor-v2';

const logger = getLogger('core:brain-v2');

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

export type IntentType = 'greeting' | 'farewell' | 'thanks' | 'chat' | 'task' | 'tool';

export interface DecisionV2 {
  intent: IntentType;
  action: 'reply' | 'execute' | 'react';
  response?: string;
  skillName?: string;
  skillResult?: string;
  confidence: number;
  reason: string;
  tasks?: Task[];
}

/** 流式事件类型扩展 */
export type StreamEventType = 
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'content'
  | 'done'
  | 'error'
  | 'strategy_adjust';

// ═══════════════════════════════════════════════════════════════
// 大脑 V2
// ═══════════════════════════════════════════════════════════════

export class BrainV2 {
  private router = getSmartRouter();
  private executor = getExecutor();
  private llm = getLLMManager();
  private skillRegistry = getSkillRegistry();
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
   * 流式处理 - OpenClaw 风格
   */
  async *processStream(
    userInput: string, 
    sessionId: string = 'default'
  ): AsyncGenerator<StreamEvent> {
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
        // 单个工具调用
        yield* this.executeSingleTool(
          decision.toolName || '',
          decision.toolParams || {},
          userInput,
          decision.reason
        );
      }
      else {
        // 复杂任务 - 使用 ReAct 循环
        yield* this.executeReActLoop(userInput, sessionId);
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
   * 执行单个工具
   */
  private async *executeSingleTool(
    toolName: string,
    params: Record<string, unknown>,
    userInput: string,
    reason?: string
  ): AsyncGenerator<StreamEvent> {
    const toolCallId = `tc_${Date.now()}`;
    const startTime = Date.now();

    yield {
      type: 'tool_call',
      timestamp: Date.now(),
      data: { 
        toolCallId,
        tool: toolName, 
        params, 
        reason: reason || '' 
      }
    };

    const result = await this.executor.executeSkill(toolName, params);
    const duration = Date.now() - startTime;

    yield {
      type: 'tool_result',
      timestamp: Date.now(),
      data: { 
        toolCallId,
        tool: toolName, 
        success: result.success, 
        duration,
        output: result.output,
        error: result.error,
      }
    };

    // LLM 处理结果
    const response = await this.processResult(
      userInput,
      toolName,
      result.output || result.error || ''
    );

    yield* this.streamContent(response);
    this.history.push({ role: 'assistant', content: response });
  }

  /**
   * 执行 ReAct 循环 - OpenClaw 风格
   */
  private async *executeReActLoop(
    userInput: string,
    sessionId: string
  ): AsyncGenerator<StreamEvent> {
    // 1. 分析任务，生成初始任务列表
    const initialTasks = await this.analyzeTasks(userInput);
    
    if (initialTasks.length === 0) {
      // 没有需要执行的任务，直接对话
      const response = await this.handleComplex(userInput);
      yield* this.streamContent(response);
      this.history.push({ role: 'assistant', content: response });
      return;
    }

    // 2. 构建执行钩子
    const hooks: ExecutionHooks = {
      beforeToolCall: async (event: ToolCallEvent) => {
        // 在流中发送工具调用开始事件
        logger.debug(`工具调用开始: ${event.toolName}`);
      },
      afterToolCall: async (event: ToolResultEvent) => {
        // 在流中发送工具调用结束事件
        logger.debug(`工具调用结束: ${event.toolName}, 成功: ${event.success}`);
      },
      onThinking: async (message: string) => {
        logger.debug(`思考: ${message}`);
      },
      onContent: async (text: string) => {
        logger.debug(`内容: ${text.slice(0, 50)}...`);
      },
      onError: async (error: string) => {
        logger.error(`错误: ${error}`);
      },
    };

    // 3. 执行 ReAct 循环
    const reactExecutor = getReActExecutorV2();
    const result = await reactExecutor.execute(
      initialTasks,
      [], // 并行组（暂不使用）
      { sessionId, hooks, userIntent: userInput },
      userInput
    );

    // 4. 流式输出结果
    // 先输出工具调用摘要
    for (const toolCall of result.toolCalls) {
      yield {
        type: 'tool_call',
        timestamp: Date.now(),
        data: {
          toolCallId: toolCall.toolCallId,
          tool: toolCall.toolName,
          success: toolCall.success,
          duration: toolCall.duration,
        }
      };
      
      yield {
        type: 'tool_result',
        timestamp: Date.now(),
        data: {
          toolCallId: toolCall.toolCallId,
          tool: toolCall.toolName,
          success: toolCall.success,
          duration: toolCall.duration,
          error: toolCall.error,
        }
      };
    }

    // 如果有策略调整
    if (result.strategyAdjusted) {
      yield {
        type: 'strategy_adjust',
        timestamp: Date.now(),
        data: { message: '执行过程中调整了策略' }
      };
    }

    // 输出最终消息
    yield* this.streamContent(result.finalMessage);
    this.history.push({ role: 'assistant', content: result.finalMessage });

    // 记录到记忆
    this.memory.recordEpisode('task_execution', JSON.stringify({
      userIntent: userInput,
      tasks: result.taskResults.length,
      success: result.success,
      iterations: result.iterations,
    }));
  }

  /**
   * 分析任务，生成初始任务列表
   * 
   * v3.2.1 优化：提供完整的技能参数模式，确保 LLM 生成正确的参数
   */
  private async analyzeTasks(userInput: string): Promise<Task[]> {
    const skills = this.skillRegistry.getAll();
    
    // 生成详细的技能描述，包含参数模式
    const skillsDesc = skills.map(s => {
      const schema = s.inputSchema as {
        required?: string[];
        properties?: Record<string, {
          type?: string;
          enum?: string[];
          description?: string;
          default?: unknown;
        }>;
      };
      
      let paramDesc = '';
      if (schema?.properties) {
        const props = Object.entries(schema.properties).map(([name, prop]) => {
          const required = schema.required?.includes(name) ? '（必填）' : '';
          const enumValues = prop.enum ? ` [可选值: ${prop.enum.join(', ')}]` : '';
          const defaultVal = prop.default !== undefined ? ` [默认: ${prop.default}]` : '';
          return `    - ${name}${required}: ${prop.description || prop.type || '未知'}${enumValues}${defaultVal}`;
        }).join('\n');
        paramDesc = `\n  参数:\n${props}`;
      }
      
      return `### ${s.name}
  ${s.description}${paramDesc}`;
    }).join('\n\n');

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个任务分析器。分析用户需求，生成需要执行的任务列表。

## 可用技能

${skillsDesc}

## 输出格式

输出 JSON 格式：
{
  "tasks": [
    {
      "id": "task_1",
      "skillName": "技能名称",
      "params": {
        "action": "操作类型（必须使用技能支持的值）",
        "其他参数": "值"
      },
      "description": "任务描述"
    }
  ],
  "thinking": "你的分析过程"
}

## 关键规则

1. **参数必须准确**：仔细阅读每个技能的参数说明，特别是 action 参数的可选值
2. **action 参数**：必须使用技能定义中列出的可选值，不要自己创造新的 action
3. 只列出需要调用技能的任务
4. 如果不需要调用技能，返回空数组
5. 参数要具体、可执行`,
      },
      {
        role: 'user',
        content: `用户需求: ${userInput}\n\n请仔细分析需要执行的任务，确保参数正确。`,
      },
    ];

    try {
      const response = await this.llm.chat(messages, { temperature: 0.3 });
      const result = this.parseJSON(response.content);
      
      if (Array.isArray(result.tasks) && result.tasks.length > 0) {
        return result.tasks.map((t: any, i: number) => ({
          id: t.id || `task_${i + 1}`,
          description: t.description || '',
          type: t.skillName || 'unknown',
          skillName: t.skillName,
          params: t.params || {},
          riskLevel: RiskLevel.LOW,
          dependencies: [],
        }));
      }
    } catch (error) {
      logger.error('任务分析失败', { error });
    }

    return [];
  }

  /**
   * 处理用户输入（非流式）
   */
  async process(userInput: string): Promise<DecisionV2> {
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

  /**
   * 解析 JSON
   */
  private parseJSON(text: string): Record<string, unknown> {
    try {
      return JSON.parse(text);
    } catch {
      const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) ||
                        text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[1] || jsonMatch[0]);
        } catch {
          // ignore
        }
      }
      return {};
    }
  }

  getHistory(): Array<{ role: 'user' | 'assistant'; content: string }> {
    return [...this.history];
  }

  clearHistory(): void {
    this.history = [];
  }
}

// ═══════════════════════════════════════════════════════════════
// 全局实例
// ═══════════════════════════════════════════════════════════════

let brainV2Instance: BrainV2 | null = null;

export function getBrainV2(): BrainV2 {
  if (!brainV2Instance) {
    brainV2Instance = new BrainV2();
  }
  return brainV2Instance;
}

export function resetBrainV2(): void {
  brainV2Instance = null;
}
