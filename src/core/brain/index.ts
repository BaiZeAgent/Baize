/**
 * 大脑模块 - 核心决策中心
 * 
 * v3.1.4 更新：
 * - 修复追问处理：基于已有结果回答，不重复调用API
 * - 优化决策流程：追问检测前置
 */

import fs from 'fs';
import path from 'path';
import { ThoughtProcess, Task, RiskLevel, LLMMessage } from '../../types';
import { ThinkingEngine, ExtendedContext } from '../thinking/engine';
import { getConfirmationManager } from '../confirmation';
import { getMemory } from '../../memory';
import { getLLMManager } from '../../llm';
import { getSkillRegistry } from '../../skills/registry';
import { getLogger } from '../../observability/logger';

const logger = getLogger('core:brain');

/**
 * 意图类型
 */
export type IntentType = 'greeting' | 'farewell' | 'thanks' | 'chat' | 'task' | 'followup';

/**
 * 决策结果
 */
export interface Decision {
  intent: IntentType;
  action: 'reply' | 'execute' | 'confirm' | 'clarify';
  response?: string;
  thoughtProcess?: ThoughtProcess;
  confidence: number;
  reason: string;
  needConfirm?: boolean;
  confirmMessage?: string;
  matchedSkill?: string;
}

/**
 * 对话消息类型
 */
type MessageType = 'chat' | 'task_result';

/**
 * 对话消息
 */
interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  type: MessageType;
}

/**
 * 对话上下文
 */
interface ConversationContext {
  history: ConversationMessage[];
  lastIntent?: IntentType;
  lastTopic?: string;
  lastSkillName?: string;
  lastSkillParams?: Record<string, unknown>;
}

/**
 * 大脑 - 核心决策中心
 */
export class Brain {
  private thinkingEngine: ThinkingEngine;
  private confirmationManager = getConfirmationManager();
  private memory = getMemory();
  private llm = getLLMManager();
  private context: ConversationContext = { history: [] };
  private maxHistoryLength = 20;
  private soulContent: string = '';

  constructor() {
    this.thinkingEngine = new ThinkingEngine();
    this.loadSoul();
  }

  /**
   * 加载 SOUL.md 文件
   */
  private loadSoul(): void {
    const soulPaths = [
      path.join(process.cwd(), 'config', 'SOUL.md'),
      path.join(process.cwd(), 'SOUL.md'),
      path.join(__dirname, '..', '..', '..', 'config', 'SOUL.md'),
    ];

    for (const soulPath of soulPaths) {
      if (fs.existsSync(soulPath)) {
        try {
          this.soulContent = fs.readFileSync(soulPath, 'utf-8');
          logger.info(`已加载 SOUL.md: ${soulPath}`);
          return;
        } catch (error) {
          logger.warn(`加载 SOUL.md 失败: ${soulPath}`, { error });
        }
      }
    }
    logger.warn('未找到 SOUL.md 文件，使用默认身份');
  }

  /**
   * 构建完整的 system prompt
   */
  private buildSystemPrompt(): string {
    const skills = getSkillRegistry().getAll();
    const skillList = skills.map(s => `- ${s.name}: ${s.description}`).join('\n');

    const basePrompt = `你是白泽，一个智能助手。

## 核心身份

你是白泽，上古神兽，通万物之情，晓天下万物。你不仅仅是一个工具，你有自己的性格和特点。

## 你的能力

你可以帮助用户完成各种任务：

${skillList}

## 说话风格

- 自然、亲切，像朋友一样
- 不说"作为AI"、"我作为一个助手"这种话
- 不用过度的客套话，如"很高兴为您服务"
- 该幽默时幽默，该严肃时严肃
- 简洁高效，直接回答问题，不啰嗦

## 重要规则

1. 只回答用户当前的问题，不要回答之前已经回答过的问题
2. 如果用户之前的问题已经得到回答，不要重复回答
3. 参考对话历史理解上下文，但只针对当前问题回复
4. 不编造信息，不确定时坦诚说明`;

    if (this.soulContent) {
      return `${basePrompt}

---

${this.soulContent}`;
    }

    return basePrompt;
  }

  /**
   * 处理用户输入 - 主入口
   */
  async process(userInput: string, sessionHistory?: string): Promise<Decision> {
    logger.info(`大脑处理: ${userInput.substring(0, 50)}...`);
    const startTime = Date.now();

    // 记录用户输入
    this.addToHistory('user', userInput, 'chat');

    // 第1层：规则快速匹配
    const ruleResult = this.ruleMatch(userInput);
    if (ruleResult) {
      logger.debug(`规则匹配: ${ruleResult.intent}`, { duration: `${Date.now() - startTime}ms` });
      this.addToHistory('assistant', ruleResult.response || '', 'chat');
      this.context.lastIntent = ruleResult.intent;
      return ruleResult;
    }

    // 第2层：追问检测（新增 - 在技能匹配之前）
    const followupResult = await this.checkFollowup(userInput);
    if (followupResult) {
      logger.debug(`追问检测: ${followupResult.intent}`, { duration: `${Date.now() - startTime}ms` });
      this.addToHistory('assistant', followupResult.response || '', 'chat');
      this.context.lastIntent = 'followup';
      return followupResult;
    }

    // 第3层：技能匹配
    const skillResult = await this.matchSkill(userInput);
    if (skillResult) {
      logger.debug(`技能匹配: ${skillResult.matchedSkill}`, { duration: `${Date.now() - startTime}ms` });
      
      const extendedContext: ExtendedContext = {
        history: this.getChatHistory(),
        matchedSkill: skillResult.matchedSkill,
        lastSkillResult: this.getLastSkillResult(),
      };
      
      const thoughtProcess = await this.thinkingEngine.process(userInput, extendedContext);
      
      if (thoughtProcess.decomposition.tasks.length > 0) {
        const task = thoughtProcess.decomposition.tasks[0];
        this.context.lastSkillName = task.skillName;
        this.context.lastSkillParams = task.params;
      }
      
      this.context.lastIntent = 'task';
      this.context.lastTopic = thoughtProcess.understanding.coreNeed;
      
      return {
        intent: 'task',
        action: 'execute',
        thoughtProcess,
        confidence: 0.95,
        reason: `匹配技能: ${skillResult.matchedSkill}`,
        matchedSkill: skillResult.matchedSkill,
      };
    }

    // 第4层：上下文检查
    const contextResult = this.checkContext(userInput);
    if (contextResult) {
      logger.debug(`上下文匹配: ${contextResult.intent}`, { duration: `${Date.now() - startTime}ms` });
      const response = await this.generateContextResponse(userInput, contextResult);
      this.addToHistory('assistant', response, 'chat');
      this.context.lastIntent = contextResult.intent;
      return {
        intent: contextResult.intent,
        action: 'reply',
        response,
        confidence: 0.85,
        reason: '基于上下文理解',
      };
    }

    // 第5层：LLM意图分类
    const llmResult = await this.classifyIntent(userInput);
    logger.debug(`LLM分类: ${llmResult.intent}`, { duration: `${Date.now() - startTime}ms` });

    if (llmResult.intent === 'chat') {
      const response = await this.generateChatResponse(userInput);
      this.addToHistory('assistant', response, 'chat');
      this.context.lastIntent = 'chat';
      return {
        intent: 'chat',
        action: 'reply',
        response,
        confidence: llmResult.confidence,
        reason: 'LLM分类为对话',
      };
    }

    // 任务类型
    const extendedContext: ExtendedContext = {
      history: this.getChatHistory(),
      lastSkillResult: this.getLastSkillResult(),
    };
    
    const thoughtProcess = await this.thinkingEngine.process(userInput, extendedContext);

    const riskLevel = this.assessRisk(thoughtProcess);
    if (riskLevel === RiskLevel.HIGH || riskLevel === RiskLevel.CRITICAL) {
      return {
        intent: 'task',
        action: 'confirm',
        thoughtProcess,
        confidence: 0.9,
        reason: '高风险操作需要确认',
        needConfirm: true,
        confirmMessage: this.formatConfirmMessage(thoughtProcess),
      };
    }

    this.context.lastIntent = 'task';
    this.context.lastTopic = thoughtProcess.understanding.coreNeed;

    return {
      intent: 'task',
      action: 'execute',
      thoughtProcess,
      confidence: 0.9,
      reason: '准备执行任务',
    };
  }

  /**
   * 记录任务执行结果
   */
  recordTaskResult(result: string): void {
    this.addToHistory('assistant', result, 'task_result');
  }

  /**
   * 获取上一次技能执行结果
   */
  private getLastSkillResult(): string | undefined {
    const lastTaskResult = [...this.context.history].reverse().find(h => h.type === 'task_result');
    return lastTaskResult?.content;
  }

  // ==================== 第2层：追问检测（新增） ====================

  /**
   * 检查是否是追问，如果是则基于已有结果回答
   */
  private async checkFollowup(input: string): Promise<Decision | null> {
    // 检查是否有上一次的任务结果
    const lastSkillResult = this.getLastSkillResult();
    if (!lastSkillResult) {
      return null;
    }

    // 检查上一次是否是任务类型
    if (this.context.lastIntent !== 'task') {
      return null;
    }

    // 使用LLM判断是否是追问
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个追问检测器。判断用户输入是否是对上一次查询结果的追问。

## 上一次查询结果
${lastSkillResult.substring(0, 500)}

## 输出格式
如果是追问（基于上一次结果提问），输出JSON：
{"isFollowup": true, "reason": "原因"}

如果不是追问（需要新的查询），输出JSON：
{"isFollowup": false, "reason": "原因"}

## 追问的例子
- 上一次查询天气，用户问"会下雨吗"、"温度多少"、"需要带伞吗"
- 上一次查询时间，用户问"那明天呢"、"后天几点"
- 上一次搜索，用户问"第一个是什么"、"有更详细的吗"

## 不是追问的例子
- 完全不相关的新问题
- 需要新的数据查询

只输出JSON，不要其他内容。`,
      },
      { role: 'user', content: input },
    ];

    try {
      const response = await this.llm.chat(messages, { temperature: 0.1 });
      const result = this.parseJSON(response.content);
      
      if (result.isFollowup === true) {
        // 是追问，基于已有结果回答
        const answer = await this.answerBasedOnResult(input, lastSkillResult);
        return {
          intent: 'followup',
          action: 'reply',
          response: answer,
          confidence: 0.9,
          reason: `追问: ${result.reason}`,
        };
      }
    } catch (error) {
      logger.warn('追问检测失败', { error });
    }

    return null;
  }

  /**
   * 基于已有结果回答追问
   */
  private async answerBasedOnResult(question: string, lastResult: string): Promise<string> {
    const systemPrompt = this.buildSystemPrompt();
    
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `${systemPrompt}

## 重要
用户正在追问上一次查询的结果。你需要基于已有的数据回答，不要建议用户重新查询。

## 上一次查询结果
${lastResult}`,
      },
      { role: 'user', content: question },
    ];

    const response = await this.llm.chat(messages, { temperature: 0.7 });
    return response.content;
  }

  // ==================== 第1层：规则快速匹配 ====================

  private ruleMatch(input: string): Decision | null {
    const trimmed = input.trim().toLowerCase();

    // 问候语
    if (this.matchPatterns(trimmed, [
      /^你好[啊呀！!]*$/, /^嗨[啊呀！!]*$/, /^hello[!！]*$/i,
      /^早上好/, /^下午好/, /^晚上好/, /^hi[!！]*$/i,
      /^哈喽/, /^哈罗/
    ])) {
      return {
        intent: 'greeting',
        action: 'reply',
        response: this.getGreetingResponse(),
        confidence: 1.0,
        reason: '规则匹配：问候语',
      };
    }

    // 告别语
    if (this.matchPatterns(trimmed, [
      /^再见[啊呀！!]*$/, /^拜拜[啊呀！!]*$/, /^bye[!！]*$/i,
      /^晚安/, /^下次见/
    ])) {
      return {
        intent: 'farewell',
        action: 'reply',
        response: '再见！有什么需要随时找我。',
        confidence: 1.0,
        reason: '规则匹配：告别语',
      };
    }

    // 感谢
    if (this.matchPatterns(trimmed, [
      /^谢谢[你您]*[啊呀！!]*$/, /^感谢/, /^thanks/i, /^thank you/i
    ])) {
      return {
        intent: 'thanks',
        action: 'reply',
        response: '不客气！还有什么可以帮助你的吗？',
        confidence: 1.0,
        reason: '规则匹配：感谢',
      };
    }

    // 自我介绍询问
    if (this.matchPatterns(trimmed, [
      /^你是谁[啊呀？？!！]*$/, /^你叫什么/, /^介绍一下你自己/,
      /^你是.*什么/, /^你的名字/
    ])) {
      return {
        intent: 'chat',
        action: 'reply',
        response: '我是白泽，你的智能助手。我可以帮你处理各种任务，比如文件操作、查询信息、天气查询等。有什么我可以帮助你的吗？',
        confidence: 1.0,
        reason: '规则匹配：自我介绍',
      };
    }

    return null;
  }

  private matchPatterns(text: string, patterns: RegExp[]): boolean {
    return patterns.some(p => p.test(text));
  }

  private getGreetingResponse(): string {
    const hour = new Date().getHours();
    if (hour < 6) return '这么晚还不睡？有什么我可以帮你的吗？';
    if (hour < 12) return '早上好！有什么我可以帮助你的吗？';
    if (hour < 18) return '下午好！有什么我可以帮助你的吗？';
    return '晚上好！有什么我可以帮助你的吗？';
  }

  // ==================== 第3层：技能匹配 ====================

  private async matchSkill(input: string): Promise<{ matchedSkill: string } | null> {
    const registry = getSkillRegistry();
    const skills = registry.getAll();
    
    if (skills.length === 0) {
      return null;
    }

    const skillDescriptions = skills.map(s => {
      const caps = s.capabilities.join(', ');
      return `- ${s.name}: ${s.description} (能力: ${caps})`;
    }).join('\n');

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个技能匹配器。根据用户输入，判断是否应该调用某个技能。

## 可用技能
${skillDescriptions}

## 输出格式
如果匹配技能，输出JSON：
{"matched": true, "skill": "技能名称"}

如果不匹配任何技能，输出：
{"matched": false}

## 匹配规则
- 天气查询 -> weather 技能
- 搜索 -> brave-search 技能
- 文件操作 -> file 技能
- 时间查询 -> time 技能
- 文件系统操作 -> fs 技能

只输出JSON，不要其他内容。`,
      },
      { role: 'user', content: input },
    ];

    try {
      const response = await this.llm.chat(messages, { temperature: 0.1 });
      const result = this.parseJSON(response.content);
      
      if (result.matched && result.skill) {
        const skill = skills.find(s => s.name === result.skill);
        if (skill) {
          return { matchedSkill: result.skill as string };
        }
      }
    } catch (error) {
      logger.warn('技能匹配失败', { error });
    }

    return null;
  }

  // ==================== 第4层：上下文检查 ====================

  private checkContext(input: string): { intent: IntentType; type: string } | null {
    const trimmed = input.trim().toLowerCase();

    if (this.matchPatterns(trimmed, [
      /刚才.*什么/, /之前.*说/, /你刚才/, /我刚才/,
      /重复.*遍/, /再说.*次/, /什么意思/
    ])) {
      return { intent: 'followup', type: 'reference' };
    }

    if (this.context.lastIntent === 'task' && this.matchPatterns(trimmed, [
      /^然后/, /^接着/, /^继续/, /^还有/
    ])) {
      return { intent: 'followup', type: 'continue' };
    }

    if (this.matchPatterns(trimmed, [
      /^好[的啊呀]*$/, /^行[的啊呀]*$/, /^可以/, /^没问题/,
      /^不[要行好]/, /^算了/, /^取消/
    ])) {
      return { intent: 'followup', type: 'confirm' };
    }

    return null;
  }

  private async generateContextResponse(input: string, contextResult: { intent: IntentType; type: string }): Promise<string> {
    const chatHistory = this.getChatHistory();

    if (contextResult.type === 'reference') {
      if (chatHistory.length > 0) {
        const lastUserMsg = [...chatHistory].reverse().find(h => h.role === 'user');
        const lastAssistantMsg = [...chatHistory].reverse().find(h => h.role === 'assistant');
        
        if (input.includes('说了什么') || input.includes('说了啥')) {
          return `你刚才说"${lastUserMsg?.content || ''}"`;
        }
        if (input.includes('你刚才')) {
          return `我刚才说"${lastAssistantMsg?.content || ''}"`;
        }
      }
      return '抱歉，我没有找到之前的对话内容。';
    }

    if (contextResult.type === 'confirm') {
      if (input.startsWith('不') || input.includes('算') || input.includes('取消')) {
        return '好的，已取消。';
      }
      return '好的，请告诉我接下来需要做什么？';
    }

    const systemPrompt = this.buildSystemPrompt();
    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      ...chatHistory.slice(-4).map(h => ({
        role: h.role as 'user' | 'assistant',
        content: h.content,
      })),
      { role: 'user', content: input },
    ];

    const response = await this.llm.chat(messages, { temperature: 0.7 });
    return response.content;
  }

  // ==================== 第5层：LLM意图分类 ====================

  private async classifyIntent(input: string): Promise<{ intent: IntentType; confidence: number }> {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个意图分类器。分析用户输入，判断意图类型。

输出JSON格式：
{
  "intent": "chat" 或 "task",
  "confidence": 0.0-1.0
}

## 判断规则

intent = "chat"（对话）：
- 闲聊、问答、咨询
- 不需要执行具体操作

intent = "task"（任务）：
- 需要执行具体操作
- 文件操作、数据查询、系统操作

只输出JSON，不要其他内容。`,
      },
      { role: 'user', content: input },
    ];

    try {
      const response = await this.llm.chat(messages, { temperature: 0.1 });
      const result = this.parseJSON(response.content);
      return {
        intent: (result.intent as IntentType) || 'chat',
        confidence: (result.confidence as number) || 0.7,
      };
    } catch (error) {
      logger.warn('意图分类失败，默认为对话');
      return { intent: 'chat', confidence: 0.5 };
    }
  }

  private async generateChatResponse(input: string): Promise<string> {
    const chatHistory = this.getChatHistory();
    const systemPrompt = this.buildSystemPrompt();

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      ...chatHistory.slice(-10).map(h => ({
        role: h.role as 'user' | 'assistant',
        content: h.content,
      })),
      { role: 'user', content: input },
    ];

    const response = await this.llm.chat(messages, { temperature: 0.7 });
    return response.content;
  }

  // ==================== 辅助方法 ====================

  private getChatHistory(): Array<{ role: string; content: string }> {
    return this.context.history.map(h => ({ role: h.role, content: h.content }));
  }

  private assessRisk(thoughtProcess: ThoughtProcess): RiskLevel {
    for (const task of thoughtProcess.decomposition.tasks) {
      if (task.riskLevel === RiskLevel.CRITICAL) return RiskLevel.CRITICAL;
      if (task.riskLevel === RiskLevel.HIGH) return RiskLevel.HIGH;
    }
    if (thoughtProcess.planning?.risks?.length > 0) return RiskLevel.MEDIUM;
    return RiskLevel.LOW;
  }

  private formatConfirmMessage(thoughtProcess: ThoughtProcess): string {
    const lines = ['即将执行以下操作:', ''];
    for (const task of thoughtProcess.decomposition.tasks) {
      lines.push(`- ${task.description} [风险: ${task.riskLevel}]`);
    }
    lines.push('');
    lines.push(`原因: ${thoughtProcess.understanding.coreNeed}`);
    lines.push('');
    lines.push('是否继续？');
    return lines.join('\n');
  }

  private addToHistory(role: 'user' | 'assistant', content: string, type: MessageType): void {
    this.context.history.push({ role, content, type });
    if (this.context.history.length > this.maxHistoryLength) {
      this.context.history = this.context.history.slice(-this.maxHistoryLength);
    }
  }

  private parseJSON(text: string): Record<string, unknown> {
    try {
      return JSON.parse(text);
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch {
          // ignore
        }
      }
      return {};
    }
  }

  learn(decision: Decision, userFeedback: 'positive' | 'negative'): void {
    if (decision.thoughtProcess) {
      const operation = decision.thoughtProcess.understanding.coreNeed;
      if (userFeedback === 'positive') {
        this.memory.recordSuccess(operation);
      } else {
        this.memory.recordFailure(operation);
      }
    }
  }

  getHistory(): Array<{ role: 'user' | 'assistant'; content: string }> {
    return this.context.history.map(h => ({ role: h.role, content: h.content }));
  }

  clearHistory(): void {
    this.context = { history: [] };
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
