/**
 * 并行执行器（已集成锁机制）
 * 
 * 支持：
 * - 并行执行任务组
 * - 资源锁保护（防止并发冲突）
 * - step_by_step模式（逐步执行，每步与思考层通讯）
 * - 执行结果收集
 * - LLM后处理（带记忆和经验）
 * 
 * 更新日志：
 * - v3.1.0: 集成资源锁机制，防止并行任务资源冲突
 * - v3.2.0: 保留作为 ReAct 执行器的备选方案
 */
import { Task, TaskResult, SkillResult, SkillContext, LLMMessage } from '../types';
import { getSkillRegistry } from '../skills/registry';
import { getLogger } from '../observability/logger';
import { getMemory } from '../memory';
import { getLLMManager } from '../llm';
import { getLockManager, ResourceLockManager } from '../scheduler/lock';

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
  private lockManager: ResourceLockManager;

  constructor(maxWorkers: number = 5) {
    this.maxWorkers = maxWorkers;
    this.lockManager = getLockManager();
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
        // 并行执行（带锁保护）
        logger.debug(`并行执行 ${groupTasks.length} 个任务（带锁保护）`);
        const results = await this.executeParallelWithLocks(groupTasks, context);
        
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
   * 带锁保护的并行执行
   */
  private async executeParallelWithLocks(
    tasks: Task[],
    context: SkillContext
  ): Promise<TaskResult[]> {
    const results: TaskResult[] = new Array(tasks.length);
    
    // 并行执行，每个任务独立获取锁
    const promises = tasks.map(async (task, index) => {
      // 获取任务所需的资源锁
      const resources = this.identifyResources(task);
      
      try {
        // 尝试获取所有资源的读锁（默认）
        const acquired = await this.acquireLocks(task.id, resources, 'read');
        
        if (!acquired) {
          // 无法获取锁，等待后重试
          logger.debug(`任务 ${task.id} 等待锁...`);
          await this.waitForLocks(task.id, resources, 'read');
        }
        
        // 执行任务
        const result = await this.executeTask(task, context);
        results[index] = result;
        
      } finally {
        // 释放所有锁
        this.releaseLocks(task.id, resources);
      }
    });
    
    await Promise.all(promises);
    return results;
  }

  /**
   * 识别任务所需的资源
   */
  private identifyResources(task: Task): string[] {
    const resources: string[] = [];
    
    // 根据技能类型识别资源
    if (task.skillName) {
      // 文件操作技能
      if (['read', 'write', 'edit'].includes(task.skillName)) {
        const path = task.params?.path as string;
        if (path) {
          resources.push(`file:${path}`);
        }
      }
      
      // 命令执行技能
      if (task.skillName === 'exec') {
        resources.push('system:exec');
      }
      
      // 网络请求技能
      if (['web_search', 'web_fetch'].includes(task.skillName)) {
        resources.push('network:api');
      }
    }
    
    // 如果没有识别到资源，使用默认资源
    if (resources.length === 0) {
      resources.push(`task:${task.id}`);
    }
    
    return resources;
  }

  /**
   * 获取锁
   */
  private async acquireLocks(
    taskId: string,
    resources: string[],
    type: 'read' | 'write'
  ): Promise<boolean> {
    for (const resource of resources) {
      const acquired = this.lockManager.tryAcquire(resource, type, taskId);
      if (!acquired) {
        // 获取失败，释放已获取的锁
        this.releaseLocks(taskId, resources.slice(0, resources.indexOf(resource)));
        return false;
      }
    }
    return true;
  }

  /**
   * 等待锁
   */
  private async waitForLocks(
    taskId: string,
    resources: string[],
    type: 'read' | 'write',
    timeout: number = 30000
  ): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const acquired = await this.acquireLocks(taskId, resources, type);
      if (acquired) {
        return true;
      }
      // 等待100ms后重试
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    logger.warn(`任务 ${taskId} 等待锁超时`);
    return false;
  }

  /**
   * 释放锁
   */
  private releaseLocks(taskId: string, resources: string[]): void {
    for (const resource of resources) {
      this.lockManager.release(resource, taskId);
    }
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
   */
  private async postProcess(
    rawResult: string,
    tasks: Task[],
    userIntent?: string
  ): Promise<string> {
    // 检查用户是否有明确指令
    const userCommand = this.parseUserCommand(userIntent);
    
    if (userCommand === 'raw') {
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
    
    if (intent.includes('总结') || intent.includes('概括') || intent.includes('提取重点')) {
      return 'summarize';
    }
    
    if (intent.includes('原始') || intent.includes('详细') || intent.includes('完整')) {
      return 'raw';
    }
    
    return null;
  }

  /**
   * 判断结果是否需要处理
   */
  private shouldProcess(rawResult: string, userCommand: 'summarize' | 'raw' | null, userIntent?: string): boolean {
    if (userCommand === 'summarize') {
      return true;
    }
    
    if (rawResult.includes('[文档型技能:')) {
      return true;
    }
    
    if (userIntent) {
      const intentKeywords = ['穿什么', '带什么', '适合', '建议', '推荐', '怎么样', '如何'];
      if (intentKeywords.some(kw => userIntent.includes(kw))) {
        return true;
      }
    }
    
    if (rawResult.length < 100) {
      return false;
    }
    
    const specialCharCount = (rawResult.match(/[│┌┐└┘├┤┬┴┼─▼▲◀▶]/g) || []).length;
    if (specialCharCount > 20) {
      return true;
    }
    
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
    const userPreference = this.memory.getPreference('response_style') || 'balanced';
    const skillName = tasks[0]?.skillName || 'unknown';
    const trustRecord = this.memory.getTrustRecord(skillName);
    const isDocSkill = rawResult.includes('[文档型技能:');
    
    let systemPrompt: string;
    
    if (isDocSkill) {
      systemPrompt = `你是白泽，一个智能助手。用户请求执行一个文档型技能。

## 技能文档
${rawResult}

## 你的任务
1. 阅读并理解上面的技能文档
2. 根据用户的问题，理解需要执行什么操作
3. 如果文档中有可执行的命令（如 curl、open、temporal 等），理解如何使用它们
4. 如果需要调用 API，理解 API 的用法
5. 执行操作后，用自然语言回复用户

## 规则
1. 不要只是复述文档内容
2. 要真正理解并执行用户的请求
3. 如果无法执行，说明原因
4. 使用自然语言，像朋友一样交流`;
    } else {
      systemPrompt = `你是白泽，一个智能助手。你的任务是根据技能执行结果回答用户的问题。

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
    }

    if (userCommand === 'summarize') {
      systemPrompt += '\n\n用户明确要求总结，请提取最重要的信息。';
    }

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: isDocSkill 
        ? `用户问题: ${userIntent || '未知'}\n\n请根据技能文档，执行用户的请求并回答：`
        : `用户问题: ${userIntent || '未知'}\n\n技能执行结果: ${rawResult}\n\n请根据用户的问题，给出合适的回答：`
      },
    ];

    const response = await this.llm.chat(messages, { temperature: 0.7 });
    
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
      let skill: any = null;
      
      if (task.skillName) {
        skill = this.skillRegistry.get(task.skillName);
      }
      
      if (!skill) {
        const skills = this.skillRegistry.findByCapability(task.type);
        if (skills.length > 0) {
          skill = skills[0];
        }
      }

      if (!skill) {
        logger.warn(`未找到技能: ${task.skillName || task.type}，使用LLM回复`);
        return await this.executeWithLLM(task, context, startTime);
      }

      logger.info(`使用技能: ${skill.name}`, { params: task.params });

      const validation = await skill.validateParams(task.params);
      if (!validation.valid) {
        throw new Error(validation.error || '参数验证失败');
      }

      const result = await skill.run(task.params, context);
      const duration = (Date.now() - startTime) / 1000;

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

export function resetExecutor(): void {
  executorInstance = null;
}
