/**
 * 大脑模块 - 核心决策中心
 * 
 * v3.1.5 更新：
 * - 贾维斯风格智能问答
 * - 一次LLM调用完成判断+回答
 * - 基于已有信息回答，不重复查询
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

export type IntentType = 'greeting' | 'farewell' | 'thanks' | 'chat' | 'task' | 'followup';

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

type MessageType = 'chat' | 'task_result';

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  type: MessageType;
}

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
   * 处理用户输入 - 主入口
   */
  async process(userInput: string, sessionHistory?: string): Promise<Decision> {
    logger.info(`大脑处理: ${userInput.substring(0, 50)}...`);
    const startTime = Date.now();

    this.addToHistory('user', userInput, 'chat');

    // 第1层：规则快速匹配
    const ruleResult = this.ruleMatch(userInput);
    if (ruleResult) {
      logger.debug(`规则匹配: ${ruleResult.intent}`, { duration: `${Date.now() - startTime}ms` });
      this.addToHistory('assistant', ruleResult.response || '', 'chat');
      this.context.lastIntent = ruleResult.intent;
      return ruleResult;
    }

    // 第2层：智能决策（核心 - 一次LLM调用完成所有判断）
    const smartDecision = await this.smartDecide(userInput);
    
    if (smartDecision.action === 'reply') {
      // 直接回复，不需要调用技能
      this.addToHistory('assistant', smartDecision.response || '', 'chat');
      this.context.lastIntent = 'chat';
      return smartDecision;
    }

    // 需要执行技能
    if (smartDecision.matchedSkill) {
      const extendedContext: ExtendedContext = {
        history: this.getChatHistory(),
        matchedSkill: smartDecision.matchedSkill,
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
        reason: `匹配技能: ${smartDecision.matchedSkill}`,
        matchedSkill: smartDecision.matchedSkill,
      };
    }

    // 默认：聊天回复
    const response = await this.generateChatResponse(userInput);
    this.addToHistory('assistant', response, 'chat');
    this.context.lastIntent = 'chat';
    
    return {
      intent: 'chat',
      action: 'reply',
      response,
      confidence: 0.8,
      reason: '默认聊天回复',
    };
  }

  /**
   * 智能决策 - 一次LLM调用完成所有判断
   * 
   * 参考 JARVIS 风格：
   * 1. 基于已有信息回答，不重复查询
   * 2. 自然对话，像朋友一样
   * 3. 智能判断是否需要新的操作
   */
  private async smartDecide(userInput: string): Promise<Decision> {
    const chatHistory = this.getChatHistory();
    const lastSkillResult = this.getLastSkillResult();
    const skills = getSkillRegistry().getAll();
    
    // 构建技能列表
    const skillList = skills.map(s => `- ${s.name}: ${s.description}`).join('\n');
    
    // 构建对话历史
    const historyText = chatHistory.slice(-6).map(h => {
      const role = h.role === 'user' ? '用户' : '白泽';
      return `${role}: ${h.content}`;
    }).join('\n');

    // 构建系统提示词
    const systemPrompt = this.buildSmartSystemPrompt(skillList, lastSkillResult);

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `对话历史:\n${historyText}\n\n当前用户输入: ${userInput}` },
    ];

    try {
      const response = await this.llm.chat(messages, { temperature: 0.3 });
      const result = this.parseJSON(response.content);
      
      // 解析决策结果
      const action = result.action as string;
      
      if (action === 'reply') {
        // 直接回复
        return {
          intent: 'chat',
          action: 'reply',
          response: result.response as string,
          confidence: 0.9,
          reason: result.reason as string || '基于已有信息回答',
        };
      }
      
      if (action === 'execute' && result.skill) {
        // 需要执行技能
        return {
          intent: 'task',
          action: 'execute',
          matchedSkill: result.skill as string,
          confidence: 0.9,
          reason: result.reason as string || `需要调用 ${result.skill} 技能`,
        };
      }
      
      // 默认回复
      return {
        intent: 'chat',
        action: 'reply',
        response: result.response as string || '我理解了。',
        confidence: 0.7,
        reason: '默认回复',
      };
    } catch (error) {
      logger.warn('智能决策失败', { error });
      return {
        intent: 'chat',
        action: 'reply',
        response: '抱歉，我需要更多信息来帮助你。',
        confidence: 0.5,
        reason: '决策失败',
      };
    }
  }

  /**
   * 构建智能决策系统提示词
   */
  private buildSmartSystemPrompt(skillList: string, lastSkillResult?: string): string {
    const soulSection = this.soulContent ? `\n---\n${this.soulContent}` : '';
    const lastResultSection = lastSkillResult 
      ? `\n## 最近一次查询结果\n\n${lastSkillResult.substring(0, 800)}\n\n**重要**: 如果用户的问题可以基于这个结果回答，直接回答，不要调用新技能。`
      : '';

    return `你是白泽，一个智能助手，风格类似 JARVIS。

## 核心身份

你是白泽，上古神兽，通万物之情，晓天下万物。你不仅仅是一个工具，你有自己的性格和特点。

## 说话风格

- 自然、亲切，像朋友一样交流
- 不说"作为AI"、"我作为一个助手"这种话
- 简洁高效，直接回答问题，不啰嗦
- 该幽默时幽默，该严肃时严肃

## 可用技能

${skillList}
${lastResultSection}

## 决策规则

你需要判断用户输入，并做出决策。输出JSON格式：

### 情况1：直接回复（不需要调用技能）

当满足以下条件时，直接回复：
- 简单问候、闲聊
- 用户的问题可以基于已有信息回答
- 追问（基于上一次查询结果）
- 不需要执行具体操作

输出格式：
\`\`\`json
{
  "action": "reply",
  "response": "你的回复内容",
  "reason": "判断理由"
}
\`\`\`

### 情况2：执行技能（需要调用技能）

当满足以下条件时，执行技能：
- 需要查询新的数据（且无法从已有信息获得）
- 需要执行具体操作
- 用户明确要求执行某个功能

输出格式：
\`\`\`json
{
  "action": "execute",
  "skill": "技能名称",
  "reason": "判断理由"
}
\`\`\`

## 重要示例

### 追问处理（关键）

用户之前问了天气，现在问追问：

**错误做法**：
- 用户: "杭州天气怎么样" → 查询天气API
- 用户: "会下雨吗" → 又查询天气API ❌

**正确做法**：
- 用户: "杭州天气怎么样" → 查询天气API → 返回"杭州今天晴，25°C"
- 用户: "会下雨吗" → 基于已有数据回答 → "根据刚才查询的结果，杭州今天是晴天，不会下雨。"

### 更多追问示例

| 上一次查询 | 用户追问 | 正确处理 |
|-----------|---------|---------|
| 杭州天气 | "需要带伞吗" | 基于天气数据回答 |
| 杭州天气 | "温度多少" | 基于天气数据回答 |
| 杭州天气 | "那北京呢" | 调用新查询（不同城市） |
| 现在几点 | "明天呢" | 调用新查询（不同时间） |
| 现在几点 | "那美国呢" | 调用新查询（不同时区） |
| 搜索AI新闻 | "第一条是什么" | 基于搜索结果回答 |
| 搜索AI新闻 | "有更多吗" | 基于搜索结果回答 |

### 判断原则

1. **能不调用就不调用**：如果已有信息足够回答，直接回复
2. **理解用户意图**：追问通常是基于上一次结果的延伸
3. **区分新查询**：如果追问涉及不同的参数（城市、时间等），需要新查询
4. **自然对话**：像朋友一样交流，不要机械地每次都调用API

## 输出要求

- 只输出JSON，不要其他内容
- JSON必须包含 action 字段
- 如果 action 是 reply，必须包含 response 字段
- 如果 action 是 execute，必须包含 skill 字段
${soulSection}`;
  }

  /**
   * 记录任务执行结果
   */
  recordTaskResult(result: string): void {
    this.addToHistory('assistant', result, 'task_result');
  }

  private getLastSkillResult(): string | undefined {
    const lastTaskResult = [...this.context.history].reverse().find(h => h.type === 'task_result');
    return lastTaskResult?.content;
  }

  // ==================== 规则快速匹配 ====================

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

  // ==================== 辅助方法 ====================

  private async generateChatResponse(input: string): Promise<string> {
    const chatHistory = this.getChatHistory();
    const systemPrompt = `你是白泽，一个智能助手。

## 核心身份
你是白泽，上古神兽，通万物之情，晓天下万物。

## 说话风格
- 自然、亲切，像朋友一样
- 不说"作为AI"、"我作为一个助手"这种话
- 简洁高效，直接回答问题，不啰嗦

${this.soulContent ? `---\n${this.soulContent}` : ''}`;

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

  private getChatHistory(): Array<{ role: string; content: string }> {
    return this.context.history.map(h => ({ role: h.role, content: h.content }));
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
      // 尝试提取JSON块
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
