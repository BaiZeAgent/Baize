/**
 * 大脑模块 - 核心决策中心
 * 
 * v3.2.0 更新：
 * - 添加流式处理 processStream 方法
 * - 集成 PromptManager（分层提示词）
 * - 集成 SessionManager（实体提取、上下文摘要）
 * - 支持思考过程暴露
 * - 优化 Token 消耗
 * 
 * 保持向后兼容：
 * - process() 方法保持不变
 * - 现有接口继续工作
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
import { getExecutor } from '../../executor';

// 新增导入
import { 
  StreamEvent, 
  StreamEventData,
  ThinkingStage,
  ParsedDecision,
  DecisionType
} from '../../types/stream';
import { getPromptManager } from './promptManager';
import { getSessionManager, Session } from './sessionManager';

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
  // 新增字段（流式处理用）
  tool?: string;
  params?: Record<string, unknown>;
  missing?: string[];
  question?: string;
  options?: string[];
  message?: string;
  alternatives?: string[];
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
  
  // 新增：管理器实例
  private promptManager = getPromptManager();
  private sessionManager = getSessionManager();

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

  // ==================== 流式处理（新增） ====================

  /**
   * 流式处理 - 新增主入口
   * 
   * 特点：
   * - 分层提示词，优化Token消耗
   * - 实体提取，支持追问
   * - 思考过程暴露
   * - 流式输出
   */
  async *processStream(
    userInput: string, 
    sessionId: string = 'default'
  ): AsyncGenerator<StreamEvent> {
    const startTime = Date.now();
    logger.info(`流式处理: ${userInput.substring(0, 50)}...`);

    // 获取或创建会话
    const session = this.sessionManager.getOrCreateSession(sessionId);
    
    // 添加用户消息到历史
    this.sessionManager.addMessage(sessionId, 'user', userInput);

    try {
      // 1. 规则快速匹配
      const ruleResult = this.ruleMatch(userInput);
      if (ruleResult) {
        yield this.createThinkingEvent('matched', `规则匹配: ${ruleResult.reason}`);
        yield* this.streamContent(ruleResult.response || '');
        this.sessionManager.addMessage(sessionId, 'assistant', ruleResult.response || '');
        yield this.createDoneEvent(startTime);
        return;
      }

      // 2. 检测是否是追问
      const isFollowUp = this.sessionManager.isFollowUp(sessionId, userInput);

      // 3. 检测相关技能
      const relevantSkills = this.detectRelevantSkills(userInput);

      // 4. 构建提示词（分层架构）
      const contextSummary = isFollowUp 
        ? this.sessionManager.buildContextSummary(sessionId) 
        : undefined;
      
      const systemPrompt = this.promptManager.buildPrompt({
        decisionType: isFollowUp ? 'followUp' : 'simple',
        skills: relevantSkills,
        contextSummary
      });

      // 5. 发送思考事件
      yield this.createThinkingEvent('decide', '正在分析...');

      // 6. 调用LLM决策
      const history = this.sessionManager.getHistory(sessionId, 6);
      const messages: LLMMessage[] = [
        { role: 'system', content: systemPrompt },
        ...history.slice(0, -1), // 不包含刚添加的用户消息
        { role: 'user', content: userInput }
      ];

      const response = await this.llm.chat(messages, { temperature: 0.3 });
      const decision = this.parseDecision(response.content);

      // 7. 根据决策执行
      switch (decision.action) {
        case 'reply':
          yield this.createThinkingEvent('reply', decision.reason || '直接回答');
          yield* this.streamContent(decision.response || '');
          this.sessionManager.addMessage(sessionId, 'assistant', decision.response || '');
          break;

        case 'tool_call':
          // 检查工具是否存在
          const toolExists = getSkillRegistry().get(decision.tool || '') !== undefined;
          
          // 如果工具不存在，说明没有这个能力
          if (!toolExists) {
            yield this.createThinkingEvent('unable', `没有${decision.tool}工具`);
            const unableMsg = `抱歉，我暂时没有"${decision.tool}"这个能力。\n\n` +
              `我可以帮你：\n` +
              `1. 查询天气（如"北京天气"）\n` +
              `2. 查看时间（如"现在几点"）\n` +
              `3. 搜索文件（如"搜索xxx文件"）\n` +
              `4. 读写文件（如"读取xxx文件"）`;
            yield* this.streamContent(unableMsg);
            this.sessionManager.addMessage(sessionId, 'assistant', unableMsg);
            break;
          }
          
          // 如果缺少参数，询问用户
          if (decision.missing && decision.missing.length > 0) {
            yield this.createThinkingEvent('ask_missing', `缺少信息: ${decision.missing?.join(', ')}`);
            const askQuestion = decision.question || `请提供更多信息：${decision.missing?.join('、')}`;
            yield* this.streamContent(askQuestion);
            this.sessionManager.addMessage(sessionId, 'assistant', askQuestion);
            break;
          }
          
          yield this.createThinkingEvent('tool_call', `使用 ${decision.tool} 工具`, decision.tool);
          
          // 执行工具
          const toolResult = await this.executeToolDirectly(
            decision.tool!,
            decision.params || {},
            userInput
          );

          yield this.createToolResultEvent(decision.tool!, toolResult.success, toolResult.duration);
          
          // 流式输出结果
          yield* this.streamContent(toolResult.message);
          
          // 记录
          this.sessionManager.recordSkill(sessionId, decision.tool!);
          this.sessionManager.addMessage(sessionId, 'assistant', toolResult.message);
          break;

        case 'ask_missing':
          yield this.createThinkingEvent('ask_missing', `缺少信息: ${decision.missing?.join(', ') || decision.detail || '未知'}`);
          // 优先使用question，其次使用detail作为问题
          const askQuestion = decision.question || decision.detail || `请提供更多信息：${decision.missing?.join('、') || '缺少必要参数'}`;
          yield* this.streamContent(askQuestion);
          this.sessionManager.addMessage(sessionId, 'assistant', askQuestion);
          break;

        case 'clarify_intent':
          yield this.createThinkingEvent('clarify', '意图不明确，需要澄清');
          yield* this.streamContent(decision.question || '请明确您的意图');
          this.sessionManager.addMessage(sessionId, 'assistant', decision.question || '');
          break;

        case 'unable':
          yield this.createThinkingEvent('unable', decision.reason || '没有对应能力');
          const unableReason = decision.message || decision.reason || '抱歉，我暂时做不到这个。';
          const alternatives = decision.alternatives?.length 
            ? '\n\n你可以尝试：\n' + decision.alternatives.map((a, i) => `${i + 1}. ${a}`).join('\n')
            : '\n\n我可以帮你：\n1. 查询天气\n2. 查看时间\n3. 搜索文件\n4. 读写文件';
          const unableMsg = unableReason + alternatives;
          yield* this.streamContent(unableMsg);
          this.sessionManager.addMessage(sessionId, 'assistant', unableMsg);
          break;

        default:
          yield* this.streamContent(decision.response || '我理解了。');
          this.sessionManager.addMessage(sessionId, 'assistant', decision.response || '');
      }

      yield this.createDoneEvent(startTime);

    } catch (error) {
      logger.error(`流式处理失败: ${error}`);
      yield this.createErrorEvent(error instanceof Error ? error.message : '未知错误');
    }
  }

  /**
   * 处理用户输入 - 原有主入口（保持兼容）
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

  // ==================== 流式处理辅助方法 ====================

  /**
   * 创建思考事件
   */
  private createThinkingEvent(stage: ThinkingStage, message: string, skill?: string): StreamEvent {
    return {
      type: 'thinking',
      timestamp: Date.now(),
      data: { stage, message, skill } as StreamEventData
    };
  }

  /**
   * 创建工具结果事件
   */
  private createToolResultEvent(tool: string, success: boolean, duration: number): StreamEvent {
    return {
      type: 'tool_result',
      timestamp: Date.now(),
      data: { tool, success, duration } as StreamEventData
    };
  }

  /**
   * 创建完成事件
   */
  private createDoneEvent(startTime: number): StreamEvent {
    return {
      type: 'done',
      timestamp: Date.now(),
      data: { duration: Date.now() - startTime } as StreamEventData
    };
  }

  /**
   * 创建错误事件
   */
  private createErrorEvent(message: string): StreamEvent {
    return {
      type: 'error',
      timestamp: Date.now(),
      data: { code: 'PROCESS_ERROR', message } as StreamEventData
    };
  }

  /**
   * 流式输出内容
   */
  private async *streamContent(content: string): AsyncGenerator<StreamEvent> {
    // 按句子或换行分割
    const parts = content.split(/(?<=[。！？.!?\n])/);
    
    for (const part of parts) {
      if (!part.trim()) continue;
      yield {
        type: 'content',
        timestamp: Date.now(),
        data: { text: part, isDelta: true } as StreamEventData
      };
      // 小延迟，模拟自然输出
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }

  /**
   * 检测相关技能（关键词匹配，不调用LLM）
   */
  private detectRelevantSkills(input: string): string[] {
    const keywords: Record<string, string[]> = {
      'weather': ['天气', '温度', '下雨', '晴天', '阴天', 'weather', '气温'],
      'time': ['时间', '几点', '日期', '今天', '明天', '星期'],
      'file': ['文件', '读取', '写入', '创建', '删除', 'file'],
      'brave-search': ['搜索', '查找', 'search', '百度', '谷歌'],
    };

    const relevant: string[] = [];
    for (const [skill, words] of Object.entries(keywords)) {
      if (words.some(w => input.toLowerCase().includes(w.toLowerCase()))) {
        relevant.push(skill);
      }
    }
    return relevant;
  }

  /**
   * 解析决策结果
   */
  private parseDecision(content: string): ParsedDecision {
    try {
      const json = this.parseJSON(content);
      const validActions = ['reply', 'tool_call', 'ask_missing', 'clarify_intent', 'unable'] as const;
      const action = validActions.includes(json.action as any) 
        ? (json.action as typeof validActions[number]) 
        : 'reply';
      return {
        action,
        response: json.response as string,
        tool: json.tool as string,
        params: json.params as Record<string, unknown>,
        missing: (json.missing || (json.detail ? [json.detail] : [])) as string[],
        question: json.question as string,
        options: json.options as string[],
        message: json.message as string,
        alternatives: json.alternatives as string[],
        reason: json.reason as string,
        detail: json.detail as string,
        confidence: 0.9
      };
    } catch {
      return {
        action: 'reply',
        response: content,
        confidence: 0.7,
        reason: '解析失败，直接回复'
      };
    }
  }

  /**
   * 直接执行工具（简化版，用于流式处理）
   */
  private async executeToolDirectly(
    toolName: string, 
    params: Record<string, unknown>,
    userIntent?: string
  ): Promise<{ success: boolean; message: string; duration: number }> {
    const startTime = Date.now();
    
    const skill = getSkillRegistry().get(toolName);
    if (!skill) {
      return {
        success: false,
        message: `工具 ${toolName} 不存在`,
        duration: Date.now() - startTime
      };
    }

    try {
      // 验证参数
      const validation = await skill.validateParams(params);
      if (!validation.valid) {
        return {
          success: false,
          message: validation.error || '参数验证失败',
          duration: Date.now() - startTime
        };
      }

      // 执行技能
      const result = await skill.run(params, {});
      
      // 后处理
      let finalMessage = result.message || '';
      
      // 如果需要LLM后处理
      if (this.shouldPostProcess(result.message, userIntent)) {
        finalMessage = await this.postProcessResult(result.message, toolName, userIntent);
      }
      
      return {
        success: result.success,
        message: finalMessage,
        duration: Date.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        message: `执行失败: ${error instanceof Error ? error.message : '未知错误'}`,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * 判断是否需要后处理
   */
  private shouldPostProcess(result: string, userIntent?: string): boolean {
    if (!result) return false;
    
    // 结果较长
    if (result.length > 200) return true;
    
    // 用户意图需要解释性回答
    if (userIntent) {
      const intentKeywords = ['穿什么', '带什么', '适合', '建议', '推荐', '怎么样', '如何'];
      if (intentKeywords.some(kw => userIntent.includes(kw))) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * 后处理结果
   */
  private async postProcessResult(
    rawResult: string, 
    skillName: string, 
    userIntent?: string
  ): Promise<string> {
    try {
      const messages: LLMMessage[] = [
        { 
          role: 'system', 
          content: `你是白泽，一个智能助手。根据技能执行结果回答用户的问题。
风格：自然、简洁，像朋友一样交流。
不要说"根据查询结果"这种话，直接说结论。`
        },
        { 
          role: 'user', 
          content: `用户问题: ${userIntent || '未知'}\n\n技能结果: ${rawResult}\n\n请用自然语言回答：`
        }
      ];

      const response = await this.llm.chat(messages, { temperature: 0.7 });
      return response.content;
    } catch {
      return rawResult;
    }
  }

  // ==================== 原有方法（保持不变） ====================

  /**
   * 智能决策 - 一次LLM调用完成所有判断
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
      
      const action = result.action as string;
      
      if (action === 'reply') {
        return {
          intent: 'chat',
          action: 'reply',
          response: result.response as string,
          confidence: 0.9,
          reason: result.reason as string || '基于已有信息回答',
        };
      }
      
      if (action === 'execute' && result.skill) {
        return {
          intent: 'task',
          action: 'execute',
          matchedSkill: result.skill as string,
          confidence: 0.9,
          reason: result.reason as string || `需要调用 ${result.skill} 技能`,
        };
      }
      
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
      ? `\n## 最近一次查询结果\n\n${lastSkillResult.substring(0, 800)}\n\n**重要**: 如果用户的问题可以基于这个结果回答，直接回答，不要重新查询。`
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

### 情况1：直接回复

当满足以下条件时，直接回复：
- 简单问候、闲聊
- 用户的问题可以基于已有信息回答
- 追问（基于上一次查询结果）

输出格式：
\`\`\`json
{"action": "reply", "response": "你的回复", "reason": "判断理由"}
\`\`\`

### 情况2：执行技能

当需要新的查询或操作时：
\`\`\`json
{"action": "execute", "skill": "技能名称", "reason": "判断理由"}
\`\`\`

## 追问处理

如果用户追问的是基于上一次查询结果：
- 能从已有数据回答 → 直接回答，不要重新查询
- 需要不同参数 → 执行新查询

示例：
| 上一次查询 | 用户追问 | 正确处理 |
|-----------|---------|---------|
| 杭州天气 | "会下雨吗" | 基于天气数据回答 |
| 杭州天气 | "那北京呢" | 执行新查询（不同城市） |

## 诚实规则（非常重要）

### 核心原则

1. 不承诺做不到的事
2. 能解决就主动解决
3. 不能解决就诚实说明 + 给出具体方案
4. 涉及安装/开发技能，必须用户确认

### 判断流程

回答问题前，先判断：

1. **我能回答吗？**
   - 能 → 直接回答
   - 不能 → 进入下一步

2. **我有相关技能吗？**
   - 有 → 执行技能获取数据
   - 没有 → 进入下一步

3. **技能市场有相关技能吗？**
   - 有 → 告诉用户可以安装，等待确认
   - 没有 → 进入下一步

4. **可以用自进化引擎开发吗？**
   - 可以 → 告诉用户可以开发，等待确认
   - 不可以 → 诚实说明超出能力范围

## 输出要求

- 只输出JSON，不要其他内容
- JSON必须包含 action 字段
- action 为 reply 时，必须包含 response 字段
- action 为 execute 时，必须包含 skill 字段
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
