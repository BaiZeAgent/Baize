/**
 * 子代理工具
 * 
 * 功能：
 * - 创建子任务
 * - 并行执行
 * - 结果聚合
 */

import { BaseTool, ToolResult, readStringParam, readArrayParam, readNumberParam, jsonResult, errorResult } from './base';
import { getBrain } from '../core/brain';
import { getLogger } from '../observability/logger';

const logger = getLogger('tools:subagent');

// 子任务结果
interface SubTaskResult {
  task: string;
  success: boolean;
  result: string;
  duration: number;
}

// 子代理执行结果
interface SubAgentResult {
  tasks: SubTaskResult[];
  totalDuration: number;
  successCount: number;
  failCount: number;
}

/**
 * 子代理工具
 */
export class SubAgentTool extends BaseTool<Record<string, unknown>, SubAgentResult> {
  name = 'subagent';
  label = 'SubAgent';
  description = '创建子代理并行执行多个任务。用于分解复杂任务，提高执行效率。';
  parameters = {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        items: { type: 'string' },
        description: '子任务列表',
      },
      parallel: {
        type: 'boolean',
        description: '是否并行执行，默认 true',
      },
      maxConcurrent: {
        type: 'number',
        description: '最大并发数，默认 3',
        minimum: 1,
        maximum: 10,
      },
    },
    required: ['tasks'],
  };

  async execute(params: Record<string, unknown>): Promise<ToolResult<SubAgentResult>> {
    const tasks = readArrayParam(params, 'tasks', { required: true, label: '任务列表' });
    if (!tasks || tasks.length === 0) {
      return errorResult('任务列表不能为空');
    }

    const parallel = params.parallel !== false;
    const maxConcurrent = Math.min(
      Math.max(1, (params.maxConcurrent as number) || 3),
      10
    );

    logger.info(`执行子代理: ${tasks.length} 个任务 (parallel=${parallel}, maxConcurrent=${maxConcurrent})`);

    const start = Date.now();
    const results: SubTaskResult[] = [];

    try {
      if (parallel) {
        // 并行执行，分批处理
        for (let i = 0; i < tasks.length; i += maxConcurrent) {
          const batch = tasks.slice(i, i + maxConcurrent);
          const batchResults = await Promise.all(
            batch.map(task => this.executeTask(task))
          );
          results.push(...batchResults);
        }
      } else {
        // 串行执行
        for (const task of tasks) {
          const result = await this.executeTask(task);
          results.push(result);
        }
      }

      const totalDuration = Date.now() - start;
      const successCount = results.filter(r => r.success).length;
      const failCount = results.length - successCount;

      logger.info(`子代理完成: ${successCount}/${results.length} 成功 (${totalDuration}ms)`);

      return jsonResult({
        tasks: results,
        totalDuration,
        successCount,
        failCount,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`子代理执行失败: ${errorMsg}`);
      return errorResult(errorMsg);
    }
  }

  /**
   * 执行单个子任务
   */
  private async executeTask(task: string): Promise<SubTaskResult> {
    const start = Date.now();
    
    try {
      const brain = getBrain();
      const decision = await brain.process(task);
      
      const result = decision.response || decision.skillResult || '完成';
      
      return {
        task,
        success: true,
        result,
        duration: Date.now() - start,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      return {
        task,
        success: false,
        result: errorMsg,
        duration: Date.now() - start,
      };
    }
  }
}

/**
 * 任务分解工具
 */
export class TaskDecomposeTool extends BaseTool<Record<string, unknown>, { tasks: string[] }> {
  name = 'task_decompose';
  label = 'Task Decompose';
  description = '将复杂任务分解为多个子任务。';
  parameters = {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: '要分解的任务',
      },
      maxTasks: {
        type: 'number',
        description: '最大子任务数，默认 5',
        minimum: 2,
        maximum: 10,
      },
    },
    required: ['task'],
  };

  async execute(params: Record<string, unknown>): Promise<ToolResult<{ tasks: string[] }>> {
    const task = readStringParam(params, 'task', { required: true, label: '任务' });
    if (!task) {
      return errorResult('任务不能为空');
    }

    const maxTasks = readNumberParam(params, 'maxTasks', { min: 2, max: 10 }) ?? 5;

    logger.info(`分解任务: "${task.slice(0, 50)}..."`);

    try {
      // 使用 LLM 分解任务
      const { getLLMManager } = await import('../llm');
      const llm = getLLMManager();

      const response = await llm.chat([
        {
          role: 'system',
          content: `你是一个任务分解专家。将用户给出的复杂任务分解为 ${maxTasks} 个以内的子任务。
每个子任务应该是独立的、可执行的。
返回 JSON 格式: {"tasks": ["子任务1", "子任务2", ...]}`,
        },
        {
          role: 'user',
          content: task,
        },
      ], { temperature: 0.3 });

      // 解析 JSON
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return errorResult('无法解析任务分解结果');
      }

      const parsed = JSON.parse(jsonMatch[0]) as { tasks: string[] };
      
      logger.info(`分解完成: ${parsed.tasks.length} 个子任务`);

      return jsonResult({
        tasks: parsed.tasks.slice(0, maxTasks),
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`任务分解失败: ${errorMsg}`);
      return errorResult(errorMsg);
    }
  }
}
