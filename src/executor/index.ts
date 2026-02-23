/**
 * 并行执行器
 * 
 * 支持：
 * - 并行执行任务组
 * - step_by_step模式（逐步执行，每步与思考层通讯）
 * - 执行结果收集
 */
import { Task, TaskResult, SkillResult, SkillContext } from '../types';
import { getSkillRegistry } from '../skills/registry';
import { getLogger } from '../observability/logger';
import { getMemory } from '../memory';

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
    stepCallback?: StepCallback
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
      return await this.executeStepByStep(tasks, context, stepCallback);
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

    // 构建最终消息
    const finalMessage = messages.length > 0 
      ? messages.join('\n') 
      : (success ? '任务执行成功' : '任务执行失败');

    logger.info(`执行完成，耗时 ${duration.toFixed(2)}s`, { success, errorCount: errors.length });

    return { success, taskResults, errors, duration, finalMessage };
  }

  /**
   * 逐步执行模式
   * 
   * 每执行完一个任务，回调思考层决定下一步
   */
  private async executeStepByStep(
    tasks: Task[],
    context: SkillContext,
    stepCallback: StepCallback
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
    const finalMessage = messages.length > 0 
      ? messages.join('\n') 
      : (success ? '任务执行成功' : '任务执行失败');

    return { success, taskResults, errors, duration, finalMessage };
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
    const { getLLMManager } = require('../llm');
    const llm = getLLMManager();

    try {
      const response = await llm.chat([
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
