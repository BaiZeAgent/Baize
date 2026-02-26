/**
 * 执行器 - OpenClaw 风格
 * 
 * 核心逻辑：
 * 1. 获取技能文档
 * 2. 让 LLM 根据文档选择命令
 * 3. 执行命令并返回结果
 * 
 * V2 新增：
 * - ReAct 循环执行器
 * - 工具执行钩子
 * - 上下文管理
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { getSkillRegistry } from '../skills/registry';
import { getLLMManager } from '../llm';
import { getLogger } from '../observability/logger';
import { LLMMessage, SkillResult, SkillContext } from '../types';

const execAsync = promisify(exec);
const logger = getLogger('executor');

/**
 * 执行结果
 */
export interface ExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  duration: number;
}

/**
 * 执行器
 */
export class Executor {
  private llm = getLLMManager();
  private skillRegistry = getSkillRegistry();

  /**
   * 执行技能
   */
  async executeSkill(
    skillName: string,
    params: Record<string, unknown>,
    context?: SkillContext
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    
    const skill = this.skillRegistry.get(skillName);
    if (!skill) {
      return {
        success: false,
        error: `技能不存在: ${skillName}`,
        duration: 0,
      };
    }

    logger.info(`[execute] skill=${skillName}`);

    try {
      // 获取技能文档
      const documentation = (skill as any).getDocumentation ? (skill as any).getDocumentation() : '';
      
      if (!documentation) {
        // 没有文档，直接运行技能
        const result = await skill.run(params, context || {});
        return {
          success: result.success,
          output: result.message || result.error,
          error: result.error,
          duration: Date.now() - startTime,
        };
      }

      // 让 LLM 根据文档选择命令
      const command = await this.selectCommand(documentation, params);
      
      if (!command) {
        return {
          success: false,
          error: '无法选择命令',
          duration: Date.now() - startTime,
        };
      }

      logger.info(`[command] ${command}`);

      // 执行命令
      const { stdout, stderr } = await execAsync(command, {
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
      });

      return {
        success: true,
        output: stdout || stderr,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * 让 LLM 根据文档选择命令
   */
  private async selectCommand(
    documentation: string,
    params: Record<string, unknown>
  ): Promise<string | null> {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是命令选择器。根据技能文档和用户参数，选择最合适的命令执行。

## 规则
1. 只返回要执行的命令，不要解释
2. 替换命令中的参数占位符
3. 如果有多个命令，选择最合适的一个

## 技能文档
${documentation}`
      },
      {
        role: 'user',
        content: `参数: ${JSON.stringify(params)}

请选择要执行的命令：`
      }
    ];

    try {
      const response = await this.llm.chat(messages, { temperature: 0.1 });
      
      // 提取命令（可能被 ```bash 包裹）
      let content = response.content.trim();
      
      // 移除 markdown 代码块标记
      content = content.replace(/^```bash\n?/gm, '').replace(/\n?```$/gm, '');
      
      // 提取第一行命令
      const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
      if (lines.length > 0) {
        return lines[0].trim();
      }
      
      return content.trim() || null;
    } catch (error) {
      logger.error(`[select-command-error] ${error}`);
      return null;
    }
  }
}

// 全局实例
let executorInstance: Executor | null = null;

export function getExecutor(): Executor {
  if (!executorInstance) {
    executorInstance = new Executor();
  }
  return executorInstance;
}

export function resetExecutor(): void {
  executorInstance = null;
}

// 导出 ReAct 执行器 V2
export {
  ReActExecutorV2,
  getReActExecutorV2,
  resetReActExecutorV2,
  type ExecutionHooks,
  type ToolCallEvent,
  type ToolResultEvent,
  type ReActResultV2,
} from './react-executor-v2';
