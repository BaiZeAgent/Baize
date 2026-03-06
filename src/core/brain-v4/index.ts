/**
 * 白泽大脑 V4 - 简化版
 * 
 * 设计原则：
 * 1. 简单任务直接处理，不调用LLM分析
 * 2. 只有真正复杂的任务才走规划流程
 * 3. 减少抽象层，提高响应速度
 */

import { getLogger } from '../../observability/logger';
import { getLLMManager } from '../../llm';
import { getSkillRegistry } from '../../skills/registry';
import { getToolRegistry } from '../../tools';
import { StreamEvent } from '../../types/stream';
import { LLMMessage } from '../../types';
import { SkillLoader } from '../../skills/loader';
import { registerBuiltinSkills } from '../../skills/builtins';

const logger = getLogger('core:brain-v4');

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

type TaskType = 'greeting' | 'thanks' | 'chat' | 'tool' | 'complex';

interface TaskResult {
  success: boolean;
  response: string;
  toolUsed?: string;
  duration: number;
}

// ═══════════════════════════════════════════════════════════════
// 白泽大脑 V4
// ═══════════════════════════════════════════════════════════════

export class BrainV4 {
  private llm = getLLMManager();
  private skillRegistry = getSkillRegistry();
  private toolRegistry = getToolRegistry();
  
  private static skillsLoaded = false;
  private static skillsLoading = false;
  
  private conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  private readonly MAX_HISTORY = 20;
  
  constructor() {
    this.ensureSkillsLoaded();
  }
  
  private async ensureSkillsLoaded(): Promise<void> {
    if (BrainV4.skillsLoaded) return;
    
    if (BrainV4.skillsLoading) {
      while (BrainV4.skillsLoading) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return;
    }
    
    BrainV4.skillsLoading = true;
    
    try {
      registerBuiltinSkills();
      
      const loader = new SkillLoader();
      const skills = await loader.loadAll();
      for (const skill of skills) {
        this.skillRegistry.register(skill);
      }
      
      BrainV4.skillsLoaded = true;
      logger.info(`[V4] 技能加载完成: ${this.skillRegistry.size} 个`);
    } catch (error) {
      logger.error(`[V4] 技能加载失败: ${error}`);
    } finally {
      BrainV4.skillsLoading = false;
    }
  }
  
  /**
   * 流式处理 - 主入口
   */
  async *processStream(userInput: string, sessionId: string = 'default'): AsyncGenerator<StreamEvent> {
    const startTime = Date.now();
    
    // 1. 快速分类
    const taskType = this.classifyTask(userInput);
    
    logger.info(`[V4] 分类: ${taskType}, 输入: ${userInput.slice(0, 30)}...`);
    
    // 2. 根据类型处理
    switch (taskType) {
      case 'greeting':
      case 'thanks':
      case 'chat':
        yield* this.handleSimpleChat(userInput, startTime);
        break;
        
      case 'tool':
        yield* this.handleToolTask(userInput, startTime);
        break;
        
      case 'complex':
        yield* this.handleComplexTask(userInput, startTime);
        break;
    }
  }
  
  /**
   * 快速分类 - 不调用LLM
   */
  private classifyTask(input: string): TaskType {
    const lower = input.toLowerCase().trim();
    const len = lower.length;
    
    // 问候
    const greetings = ['你好', '您好', 'hi', 'hello', 'hey', '嗨', '哈喽', '早上好', '下午好', '晚上好'];
    if (len <= 20 && greetings.some(g => lower.includes(g))) {
      return 'greeting';
    }
    
    // 感谢
    const thanks = ['谢谢', '感谢', 'thanks', 'thank you', '多谢'];
    if (len <= 20 && thanks.some(t => lower.includes(t))) {
      return 'thanks';
    }
    
    // 检查是否需要工具
    const toolKeywords = [
      '天气', '文件', '读取', '写入', '创建', '删除', '搜索', '查找',
      '打开', '关闭', '执行', '运行', '计算', '时间', '日期',
      'browser', 'click', 'type', 'scroll'
    ];
    
    if (toolKeywords.some(k => lower.includes(k))) {
      return 'tool';
    }
    
    // 简单闲聊（短句且不含任务关键词）
    const complexKeywords = ['帮我', '请', '如何', '怎么', '为什么', '什么是', '解释'];
    if (len <= 15 && !complexKeywords.some(k => lower.includes(k))) {
      return 'chat';
    }
    
    // 默认为复杂任务
    return 'complex';
  }
  
  /**
   * 处理简单聊天
   */
  private async *handleSimpleChat(userInput: string, startTime: number): AsyncGenerator<StreamEvent> {
    // 直接调用LLM回复
    const response = await this.chatWithLLM(userInput);
    
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
  }
  
  /**
   * 处理工具任务
   */
  private async *handleToolTask(userInput: string, startTime: number): AsyncGenerator<StreamEvent> {
    yield {
      type: 'thinking',
      timestamp: Date.now(),
      data: { stage: 'tool_selection', message: '选择工具...' }
    };
    
    // 选择工具
    const selection = await this.selectTool(userInput);
    
    if (!selection) {
      // 没找到合适的工具，用LLM回复
      const response = await this.chatWithLLM(userInput);
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
    
    yield {
      type: 'tool_call',
      timestamp: Date.now(),
      data: {
        toolCallId: `tc_${Date.now()}`,
        tool: selection.tool,
        params: selection.params,
        reason: selection.reason
      }
    };
    
    // 执行工具
    const toolStartTime = Date.now();
    const result = await this.executeTool(selection.tool, selection.params);
    
    yield {
      type: 'tool_result',
      timestamp: Date.now(),
      data: {
        toolCallId: `tc_${Date.now()}`,
        tool: selection.tool,
        success: result.success,
        duration: Date.now() - toolStartTime,
        output: result.output,
        error: result.error
      }
    };
    
    // 生成回复
    const response = await this.generateToolResponse(userInput, selection.tool, result);
    
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
  }
  
  /**
   * 处理复杂任务
   */
  private async *handleComplexTask(userInput: string, startTime: number): AsyncGenerator<StreamEvent> {
    yield {
      type: 'thinking',
      timestamp: Date.now(),
      data: { stage: 'planning', message: '分析任务...' }
    };
    
    // 尝试选择工具
    const selection = await this.selectTool(userInput);
    
    if (selection) {
      // 有合适的工具，按工具任务处理
      yield* this.handleToolTask(userInput, startTime);
      return;
    }
    
    // 没有合适的工具，直接聊天
    const response = await this.chatWithLLM(userInput);
    
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
  }
  
  /**
   * 选择工具
   */
  private async selectTool(userInput: string): Promise<{ tool: string; params: Record<string, unknown>; reason: string } | null> {
    const skills = this.skillRegistry.getAll();
    const tools = this.toolRegistry.getAll();
    
    if (skills.length === 0 && tools.length === 0) {
      return null;
    }
    
    // 构建工具列表
    const toolList = [
      ...skills.map(s => ({ name: s.name, desc: s.description, schema: s.inputSchema })),
      ...tools.map(t => ({ name: t.name, desc: t.description, schema: {} }))
    ];
    
    const toolDesc = toolList.map(t => `- ${t.name}: ${t.desc}`).join('\n');
    
    const prompt = `用户请求: ${userInput}

可用工具:
${toolDesc}

请选择最合适的工具。如果不需要工具，返回 null。

输出JSON格式:
{
  "tool": "工具名称",
  "params": { "参数名": "参数值" },
  "reason": "选择原因"
}

或返回 null 表示不需要工具。`;

    try {
      const response = await this.llm.chat([
        { role: 'system', content: '你是一个工具选择专家。只返回JSON，不要其他内容。' },
        { role: 'user', content: prompt }
      ], { temperature: 0.1 });
      
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        // 验证工具存在
        const exists = toolList.some(t => t.name === parsed.tool);
        if (!exists) {
          logger.warn(`[V4] 工具不存在: ${parsed.tool}`);
          return null;
        }
        
        return {
          tool: parsed.tool,
          params: parsed.params || {},
          reason: parsed.reason || ''
        };
      }
    } catch (error) {
      logger.error(`[V4] 工具选择失败: ${error}`);
    }
    
    return null;
  }
  
  /**
   * 执行工具
   */
  private async executeTool(
    toolName: string,
    params: Record<string, unknown>
  ): Promise<{ success: boolean; output?: string; error?: string }> {
    const skill = this.skillRegistry.get(toolName);
    const tool = this.toolRegistry.get(toolName);
    
    try {
      if (skill) {
        const result = await skill.run(params, {
          sessionId: 'default',
          conversationId: 'default'
        });
        return {
          success: result.success,
          output: result.message || result.data?.toString() || '',
          error: result.error
        };
      }
      
      if (tool) {
        const result = await tool.safeExecute(params, {
          sessionId: 'default',
          conversationId: 'default'
        });
        return {
          success: result.success,
          output: result.success ? JSON.stringify(result.data) : '',
          error: result.error
        };
      }
      
      return { success: false, error: `工具不存在: ${toolName}` };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  }
  
  /**
   * 与LLM聊天
   */
  private async chatWithLLM(userInput: string): Promise<string> {
    // 更新历史
    this.conversationHistory.push({ role: 'user', content: userInput });
    if (this.conversationHistory.length > this.MAX_HISTORY) {
      this.conversationHistory = this.conversationHistory.slice(-this.MAX_HISTORY);
    }
    
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是白泽，一个友好、智能的助手。
回答要自然、简洁，像朋友一样交流。
如果用户问的是问题，尽力回答。
如果用户只是闲聊，自然地回应。`
      },
      ...this.conversationHistory.map(h => ({
        role: h.role as 'user' | 'assistant',
        content: h.content
      }))
    ];
    
    try {
      const response = await this.llm.chat(messages, { temperature: 0.7 });
      
      // 更新历史
      this.conversationHistory.push({ role: 'assistant', content: response.content });
      
      return response.content;
    } catch (error) {
      logger.error(`[V4] LLM调用失败: ${error}`);
      
      // 降级处理：使用预设响应
      return this.getFallbackResponse(userInput);
    }
  }
  
  /**
   * 降级响应（当LLM不可用时）
   */
  private getFallbackResponse(userInput: string): string {
    const lower = userInput.toLowerCase();
    
    // 问候
    if (lower.includes('你好') || lower.includes('hi') || lower.includes('hello')) {
      return '你好！我是白泽，很高兴见到你。不过我现在连接不到语言模型，请检查配置。';
    }
    
    // 感谢
    if (lower.includes('谢谢') || lower.includes('thanks')) {
      return '不客气！有什么我可以帮你的吗？';
    }
    
    // 帮助
    if (lower.includes('help') || lower.includes('帮助')) {
      return '我可以帮你：\n1. 查询天气\n2. 操作文件\n3. 搜索信息\n4. 回答问题\n\n不过我现在连接不到语言模型，请检查配置。';
    }
    
    // 默认
    return '抱歉，我现在连接不到语言模型。请检查：\n1. Ollama 是否运行（ollama serve）\n2. 或设置 API Key（ALIYUN_API_KEY / ZHIPU_API_KEY）';
  }
  
  /**
   * 生成工具执行后的回复
   */
  private async generateToolResponse(
    userInput: string,
    toolName: string,
    result: { success: boolean; output?: string; error?: string }
  ): Promise<string> {
    const prompt = `用户请求: ${userInput}
工具: ${toolName}
执行结果: ${result.success ? '成功' : '失败'}
输出: ${result.output || '(无)'}
错误: ${result.error || '(无)'}

请用自然语言回答用户，风格要简洁友好。`;

    try {
      const response = await this.llm.chat([
        { role: 'system', content: '你是白泽，一个智能助手。回答要自然、简洁。' },
        { role: 'user', content: prompt }
      ], { temperature: 0.7 });
      
      return response.content;
    } catch (error) {
      if (result.success) {
        return result.output || '执行成功。';
      }
      return `执行失败: ${result.error || '未知错误'}`;
    }
  }
  
  /**
   * 非流式处理
   */
  async process(userInput: string): Promise<TaskResult> {
    const startTime = Date.now();
    
    let response = '';
    for await (const event of this.processStream(userInput)) {
      if (event.type === 'content') {
        response += (event.data as any).text || '';
      }
    }
    
    return {
      success: true,
      response,
      duration: Date.now() - startTime
    };
  }
  
  /**
   * 获取统计信息
   */
  getStats() {
    return {
      skillsCount: this.skillRegistry.size,
      toolsCount: this.toolRegistry.getAll().length,
      historyLength: this.conversationHistory.length
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// 全局实例
// ═══════════════════════════════════════════════════════════════

let brainV4Instance: BrainV4 | null = null;

export function getBrainV4(): BrainV4 {
  if (!brainV4Instance) {
    brainV4Instance = new BrainV4();
  }
  return brainV4Instance;
}

export function resetBrainV4(): void {
  brainV4Instance = null;
}
