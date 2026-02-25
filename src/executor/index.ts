/**
 * 并行执行器
 * 
 * 支持：
 * - 并行执行任务组
 * - step_by_step模式（逐步执行，每步与思考层通讯）
 * - 执行结果收集
 * - LLM后处理（带记忆和经验）
 */
import { Task, TaskResult, SkillResult, SkillContext, LLMMessage } from '../types';
import { getSkillRegistry } from '../skills/registry';
import { getLogger } from '../observability/logger';
import { getMemory } from '../memory';
import { getLLMManager } from '../llm';

const logger = getLogger('executor');

/**
 * 执行结果
 */
export interface ExecutionResult {
  success: boolean;
  taskResults: TaskResult[];
  errors: string[];
  duration: number;
  finalMessage: string;
  rawResult?: string; // 原始结果，用于调试
}

/**
 * 步骤执行回调
 */
export type StepCallback = (
  stepIndex: number,
  task: Task,
  result: TaskResult,
  remainingTasks: Task[]
) => Promise<{ continue: boolean; modifiedParams?: Record<string, unknown> }>;

/**
 * 并行执行器
 */
export class ParallelExecutor {
  private maxWorkers: number;
  private skillRegistry = getSkillRegistry();
  private memory = getMemory();
  private llm = getLLMManager();

  constructor(maxWorkers: number = 5) {
    this.maxWorkers = maxWorkers;
  }

  /**
   * 执行任务组
   */
  async execute(
    tasks: Task[],
    parallelGroups: string[][],
    context: SkillContext = {},
    stepCallback?: StepCallback,
    userIntent?: string
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const taskResults: TaskResult[] = [];
    const errors: string[] = [];
    const messages: string[] = [];

    logger.info(`开始执行 ${tasks.length} 个任务`);

    // 如果没有任务，返回空结果
    if (tasks.length === 0) {
      return {
        success: true,
        taskResults: [],
        errors: [],
        duration: 0,
        finalMessage: '',
      };
    }

    // 检查是否有step_by_step技能
    const hasStepByStep = this.hasStepByStepSkill(tasks);
    
    if (hasStepByStep && stepCallback) {
      // 逐步执行模式
      logger.info('检测到step_by_step技能，启用逐步执行模式');
      return await this.executeStepByStep(tasks, context, stepCallback, userIntent);
    }

    // 按并行组执行
    for (const group of parallelGroups) {
      const groupTasks = tasks.filter(t => group.includes(t.id));
      
      if (groupTasks.length > 1) {
        // 并行执行
        logger.debug(`并行执行 ${groupTasks.length} 个任务`);
        const results = await Promise.all(
          groupTasks.map(task => this.executeTask(task, context))
        );
        
        for (let i = 0; i < groupTasks.length; i++) {
          taskResults.push(results[i]);
          if (results[i].success && results[i].message) {
            messages.push(results[i].message);
          }
          if (!results[i].success) {
            errors.push(`任务 ${groupTasks[i].id} 失败: ${results[i].error}`);
          }
        }
      } else if (groupTasks.length === 1) {
        // 串行执行
        const result = await this.executeTask(groupTasks[0], context);
        taskResults.push(result);
        if (result.success && result.message) {
          messages.push(result.message);
        }
        if (!result.success) {
          errors.push(`任务 ${groupTasks[0].id} 失败: ${result.error}`);
        }
      }
    }

    const duration = (Date.now() - startTime) / 1000;
    const success = errors.length === 0;

    // 构建原始结果
    const rawResult = messages.length > 0 
      ? messages.join('\n') 
      : (success ? '任务执行成功' : '任务执行失败');

    // LLM后处理
    const finalMessage = await this.postProcess(rawResult, tasks, userIntent);

    logger.info(`执行完成，耗时 ${duration.toFixed(2)}s`, { success, errorCount: errors.length });

    return { success, taskResults, errors, duration, finalMessage, rawResult };
  }

  /**
   * 逐步执行模式
   */
  private async executeStepByStep(
    tasks: Task[],
    context: SkillContext,
    stepCallback: StepCallback,
    userIntent?: string
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const taskResults: TaskResult[] = [];
    const errors: string[] = [];
    const messages: string[] = [];
    const remainingTasks = [...tasks];

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      
      logger.info(`逐步执行: 步骤 ${i + 1}/${tasks.length}`, { 
        taskId: task.id, 
        skillName: task.skillName 
      });

      // 执行当前任务
      const result = await this.executeTask(task, context);
      taskResults.push(result);

      if (result.success && result.message) {
        messages.push(result.message);
      }
      if (!result.success) {
        errors.push(`任务 ${task.id} 失败: ${result.error}`);
      }

      // 更新剩余任务
      remainingTasks.shift();

      // 回调思考层
      if (remainingTasks.length > 0) {
        logger.debug(`回调思考层，剩余 ${remainingTasks.length} 个任务`);
        
        const callbackResult = await stepCallback(i, task, result, remainingTasks);

        if (!callbackResult.continue) {
          logger.info('思考层决定停止执行');
          break;
        }

        // 如果思考层修改了后续任务的参数
        if (callbackResult.modifiedParams && remainingTasks.length > 0) {
          remainingTasks[0].params = {
            ...remainingTasks[0].params,
            ...callbackResult.modifiedParams,
          };
          logger.debug('思考层修改了后续任务参数');
        }
      }
    }

    const duration = (Date.now() - startTime) / 1000;
    const success = errors.length === 0;
    const rawResult = messages.length > 0 
      ? messages.join('\n') 
      : (success ? '任务执行成功' : '任务执行失败');

    // LLM后处理
    const finalMessage = await this.postProcess(rawResult, tasks, userIntent);

    return { success, taskResults, errors, duration, finalMessage, rawResult };
  }

  /**
   * LLM后处理
   * 
   * 优先级：
   * 1. 用户明确指令（"总结一下"、"显示原始"）
   * 2. 结果复杂度判断
   * 3. 记忆和经验（用户偏好）
   */
  private async postProcess(
    rawResult: string,
    tasks: Task[],
    userIntent?: string
  ): Promise<string> {
    // 检查用户是否有明确指令
    const userCommand = this.parseUserCommand(userIntent);
    
    if (userCommand === 'raw') {
      // 用户要求显示原始结果
      logger.debug('用户要求显示原始结果');
      return rawResult;
    }

    // 判断结果是否需要处理
    const needsProcessing = this.shouldProcess(rawResult, userCommand, userIntent);
    
    if (!needsProcessing) {
      logger.debug('结果简单，无需处理');
      return rawResult;
    }

    // LLM处理
    logger.info('LLM后处理开始');
    
    try {
      const processedResult = await this.processWithLLM(rawResult, tasks, userIntent, userCommand);
      return processedResult;
    } catch (error) {
      logger.error('LLM后处理失败，返回原始结果', { error });
      return rawResult;
    }
  }

  /**
   * 解析用户指令
   */
  private parseUserCommand(userIntent?: string): 'summarize' | 'raw' | null {
    if (!userIntent) return null;
    
    const intent = userIntent.toLowerCase();
    
    // 用户要求总结
    if (intent.includes('总结') || intent.includes('概括') || intent.includes('提取重点')) {
      return 'summarize';
    }
    
    // 用户要求原始结果
    if (intent.includes('原始') || intent.includes('详细') || intent.includes('完整')) {
      return 'raw';
    }
    
    return null;
  }

  /**
   * 判断结果是否需要处理
   */
  private shouldProcess(rawResult: string, userCommand: 'summarize' | 'raw' | null, userIntent?: string): boolean {
    // 用户强制要求总结
    if (userCommand === 'summarize') {
      return true;
    }
    
    // 如果用户意图需要解释性回答（如穿衣建议），需要处理
    if (userIntent) {
      const intentKeywords = ['穿什么', '带什么', '适合', '建议', '推荐', '怎么样', '如何'];
      if (intentKeywords.some(kw => userIntent.includes(kw))) {
        return true;
      }
    }
    
    // 结果很短，不需要处理
    if (rawResult.length < 100) {
      return false;
    }
    
    // 结果包含大量特殊字符（如图表），需要处理
    const specialCharCount = (rawResult.match(/[│┌┐└┘├┤┬┴┼─▼▲◀▶]/g) || []).length;
    if (specialCharCount > 20) {
      return true;
    }
    
    // 结果是多行的结构化数据
    const lineCount = rawResult.split('\n').length;
    if (lineCount > 10) {
      return true;
    }
    
    return false;
  }

  /**
   * 使用LLM处理结果
   */
  private async processWithLLM(
    rawResult: string,
    tasks: Task[],
    userIntent?: string,
    userCommand?: 'summarize' | 'raw' | null
  ): Promise<string> {
    // 获取用户偏好
    const userPreference = this.memory.getPreference('response_style') || 'balanced';
    
    // 获取相关记忆
    const recentEpisodes = this.memory.getRecentConversation(5);
    const conversationContext = recentEpisodes
      .map(e => e.content)
      .join('\n');

    // 获取技能执行历史
    const skillName = tasks[0]?.skillName || 'unknown';
    const trustRecord = this.memory.getTrustRecord(skillName);

    // 构建系统提示
    let systemPrompt = `你是白泽，一个智能助手。你的任务是根据技能执行结果回答用户的问题。

## 用户偏好
- 回复风格: ${userPreference} (concise=简洁, detailed=详细, balanced=平衡)

## 技能执行历史
- 技能: ${skillName}
- 成功次数: ${trustRecord?.successCount || 0}
- 失败次数: ${trustRecord?.failureCount || 0}

## 规则
1. 根据用户的原始问题来回答，不要只是复述技能结果
2. 如果用户问的是穿衣建议，根据天气温度给出具体的穿衣建议
3. 如果用户问的是天气，简洁地报告天气情况
4. 如果用户问的是其他问题，根据结果智能回答
5. 使用自然语言，像朋友一样交流`;

    if (userCommand === 'summarize') {
      systemPrompt += '\n\n用户明确要求总结，请提取最重要的信息。';
    }

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `用户问题: ${userIntent || '未知'}

技能执行结果: ${rawResult}

请根据用户的问题，给出合适的回答：` },
    ];

    const response = await this.llm.chat(messages, { temperature: 0.7 });
    
    // 记录这次处理
    this.memory.recordEpisode('post_process', `处理技能结果: ${skillName}`);
    
    return response.content;
  }

  /**
   * 检查是否有step_by_step技能
   */
  private hasStepByStepSkill(tasks: Task[]): boolean {
    for (const task of tasks) {
      if (task.skillName) {
        const skill = this.skillRegistry.get(task.skillName);
        if (skill && (skill as any).stepByStep) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * 执行单个任务
   */
  private async executeTask(
    task: Task,
    context: SkillContext
  ): Promise<TaskResult> {
    const startTime = Date.now();
    logger.info(`执行任务: ${task.id}`, { 
      skill: task.skillName, 
      params: JSON.stringify(task.params).substring(0, 200)
    });

    try {
      // 获取技能
      let skill = null;
      
      if (task.skillName) {
        skill = this.skillRegistry.get(task.skillName);
      }
      
      if (!skill) {
        // 尝试根据type匹配
        const skills = this.skillRegistry.findByCapability(task.type);
        if (skills.length > 0) {
          skill = skills[0];
        }
      }

      if (!skill) {
        // 没有对应技能，使用LLM直接回复
        logger.warn(`未找到技能: ${task.skillName || task.type}，使用LLM回复`);
        return await this.executeWithLLM(task, context, startTime);
      }

      logger.info(`使用技能: ${skill.name}`, { params: task.params });

      // 验证参数
      const validation = await skill.validateParams(task.params);
      if (!validation.valid) {
        throw new Error(validation.error || '参数验证失败');
      }

      // 执行技能
      const result = await skill.run(task.params, context);
      const duration = (Date.now() - startTime) / 1000;

      // 记录成功
      this.memory.recordSuccess(skill.name);

      logger.info(`技能执行成功: ${skill.name}`, { 
        success: result.success, 
        message: result.message?.substring(0, 100) 
      });

      return {
        taskId: task.id,
        success: result.success,
        data: result.data,
        message: result.message,
        error: result.error,
        duration,
      };
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      logger.error(`任务执行失败: ${task.id}`, { error: errorMsg });
      
      if (task.skillName) {
        this.memory.recordFailure(task.skillName);
      }

      return {
        taskId: task.id,
        success: false,
        data: {},
        message: '执行失败',
        error: errorMsg,
        duration,
      };
    }
  }

  /**
   * 使用LLM执行任务（当没有对应技能时）
   */
  private async executeWithLLM(
    task: Task,
    context: SkillContext,
    startTime: number
  ): Promise<TaskResult> {
    try {
      const response = await this.llm.chat([
        { role: 'system', content: '你是一个智能助手，请完成用户指定的任务。如果任务涉及文件操作、系统操作等，请说明你无法直接执行，但可以提供指导。' },
        { role: 'user', content: `请完成以下任务: ${task.description}\n参数: ${JSON.stringify(task.params)}` },
      ]);

      const duration = (Date.now() - startTime) / 1000;

      return {
        taskId: task.id,
        success: true,
        data: { response: response.content },
        message: response.content,
        duration,
      };
    } catch (error) {
      const duration = (Date.now() - startTime) / 1000;
      const errorMsg = error instanceof Error ? error.message : String(error);

      return {
        taskId: task.id,
        success: false,
        data: {},
        message: '执行失败',
        error: errorMsg,
        duration,
      };
    }
  }

  /**
   * 执行单个技能
   */
  async executeSkill(
    skillName: string,
    params: Record<string, unknown>,
    context: SkillContext = {}
  ): Promise<SkillResult> {
    const skill = this.skillRegistry.get(skillName);
    if (!skill) {
      throw new Error(`技能不存在: ${skillName}`);
    }

    const validation = await skill.validateParams(params);
    if (!validation.valid) {
      throw new Error(validation.error || '参数验证失败');
    }

    return skill.run(params, context);
  }
}

// 全局实例
let executorInstance: ParallelExecutor | null = null;

export function getExecutor(): ParallelExecutor {
  if (!executorInstance) {
    executorInstance = new ParallelExecutor();
  }
  return executorInstance;
}
