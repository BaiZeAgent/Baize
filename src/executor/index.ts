/**
 * 执行器 - OpenClaw 风格
 * 
 * 核心逻辑：
 * 1. 优先检查内置工具
 * 2. 如果没有，检查技能
 * 3. 根据技能类型选择执行方式
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';
import { getSkillRegistry } from '../skills/registry';
import { getToolRegistry } from '../tools';
import { getLLMManager } from '../llm';
import { getLogger } from '../observability/logger';
import { LLMMessage, SkillContext } from '../types';

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
  private toolRegistry = getToolRegistry();

  /**
   * 执行技能或工具
   */
  async executeSkill(
    name: string,
    params: Record<string, unknown>,
    context?: SkillContext
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    // 1. 先检查内置工具
    if (this.toolRegistry.has(name)) {
      logger.info(`[execute-tool] name=${name}`);
      const result = await this.toolRegistry.execute(name, params, context);
      return {
        success: result.success,
        output: result.data ? JSON.stringify(result.data, null, 2) : undefined,
        error: result.error,
        duration: result.duration,
      };
    }

    // 2. 检查技能
    const skill = this.skillRegistry.get(name);
    if (!skill) {
      return {
        success: false,
        error: `技能或工具不存在: ${name}`,
        duration: 0,
      };
    }

    logger.info(`[execute] skill=${name}`);

    try {
      // 获取技能路径
      const skillPath = (skill as any).definition?.skillPath || 
                        (skill as any).path || 
                        path.join(process.cwd(), 'skills', name);
      
      logger.debug(`技能路径: ${skillPath}`);
      
      // 检查是否有 main.js 或 main.py
      const mainJsPath = path.join(skillPath, 'main.js');
      const mainPyPath = path.join(skillPath, 'main.py');
      
      if (fs.existsSync(mainJsPath)) {
        // 使用 Node.js 执行
        return await this.executeNodeSkill(mainJsPath, params, startTime);
      } else if (fs.existsSync(mainPyPath)) {
        // 使用 Python 执行
        return await this.executePythonSkill(mainPyPath, params, startTime);
      } else {
        // 文档型技能，让 LLM 生成命令
        const documentation = (skill as any).getDocumentation ? (skill as any).getDocumentation() : '';
        if (!documentation) {
          // 直接运行技能
          const result = await skill.run(params, context || {});
          return {
            success: result.success,
            output: result.message || result.error,
            error: result.error,
            duration: Date.now() - startTime,
          };
        }
        
        return await this.executeDocSkill(documentation, params, startTime);
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * 执行 Node.js 技能
   */
  private async executeNodeSkill(
    scriptPath: string,
    params: Record<string, unknown>,
    startTime: number
  ): Promise<ExecutionResult> {
    try {
      const paramsJson = JSON.stringify({ params });
      
      logger.debug(`执行 Node.js 技能: ${scriptPath}`);
      logger.debug(`参数: ${paramsJson}`);
      
      // 通过环境变量传递参数
      const { stdout, stderr } = await execAsync(`node "${scriptPath}"`, {
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
        cwd: process.cwd(), // 在项目根目录执行
        env: {
          ...process.env,
          BAIZE_PARAMS: paramsJson,
        },
      });

      logger.debug(`输出: ${stdout}`);
      if (stderr) logger.debug(`错误输出: ${stderr}`);

      // 解析输出
      try {
        const result = JSON.parse(stdout);
        return {
          success: result.success !== false,
          output: result.message || (result.data ? JSON.stringify(result.data, null, 2) : stdout),
          error: result.error,
          duration: Date.now() - startTime,
        };
      } catch {
        // 不是 JSON，直接返回
        return {
          success: true,
          output: stdout || stderr,
          duration: Date.now() - startTime,
        };
      }
    } catch (error: any) {
      logger.error(`Node.js 技能执行失败: ${error.message}`);
      if (error.stdout) logger.debug(`stdout: ${error.stdout}`);
      if (error.stderr) logger.debug(`stderr: ${error.stderr}`);
      return {
        success: false,
        error: error.message + (error.stderr ? `: ${error.stderr}` : ''),
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * 执行 Python 技能
   */
  private async executePythonSkill(
    scriptPath: string,
    params: Record<string, unknown>,
    startTime: number
  ): Promise<ExecutionResult> {
    try {
      const paramsJson = JSON.stringify({ params });
      
      const { stdout, stderr } = await execAsync(`python3 "${scriptPath}"`, {
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
        env: {
          ...process.env,
          BAIZE_PARAMS: paramsJson,
        },
      });

      try {
        const result = JSON.parse(stdout);
        return {
          success: result.success !== false,
          output: result.message || JSON.stringify(result.data || result, null, 2),
          error: result.error,
          duration: Date.now() - startTime,
        };
      } catch {
        return {
          success: true,
          output: stdout || stderr,
          duration: Date.now() - startTime,
        };
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * 执行文档型技能
   */
  private async executeDocSkill(
    documentation: string,
    params: Record<string, unknown>,
    startTime: number
  ): Promise<ExecutionResult> {
    // 让 LLM 根据文档生成命令
    const command = await this.selectCommand(documentation, params);
    
    if (!command) {
      return {
        success: false,
        error: '无法选择命令',
        duration: Date.now() - startTime,
      };
    }

    logger.info(`[command] ${command}`);

    try {
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
        content: `你是命令生成器。根据技能文档和用户参数，生成要执行的 shell 命令。

## 规则
1. 只返回要执行的命令，不要解释
2. 如果技能需要通过 stdin 传递 JSON 参数，使用 echo 和管道
3. 如果技能通过环境变量 BAIZE_PARAMS 接收参数，设置环境变量
4. 命令必须是有效的 shell 命令

## 示例
如果技能是 Node.js 脚本，参数是 {"action": "read", "path": "test.txt"}：
echo '{"params": {"action": "read", "path": "test.txt"}}' | BAIZE_PARAMS='{"params":{"action":"read","path":"test.txt"}}' node skills/file/main.js

## 技能文档
${documentation}`
      },
      {
        role: 'user',
        content: `参数: ${JSON.stringify(params)}

请生成要执行的命令：`
      }
    ];

    try {
      const response = await this.llm.chat(messages, { temperature: 0.1 });
      
      let content = response.content.trim();
      
      // 移除 markdown 代码块标记
      content = content.replace(/^```bash\n?/gm, '').replace(/^```\n?/gm, '').replace(/\n?```$/gm, '');
      
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

  /**
   * 获取所有可用的工具和技能
   */
  getAvailableTools(): string[] {
    const tools = this.toolRegistry.getAll().map(t => t.name);
    const skills = this.skillRegistry.getAll().map(s => s.name);
    return [...tools, ...skills];
  }

  /**
   * 获取工具列表（用于 LLM）
   */
  getToolDefinitions(): Array<{
    name: string;
    description: string;
    parameters: any;
  }> {
    const tools = this.toolRegistry.getAll().map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    const skills = this.skillRegistry.getAll().map(s => ({
      name: s.name,
      description: s.description,
      parameters: {
        type: 'object',
        properties: {},
        description: '动态参数，根据技能文档确定',
      },
    }));

    return [...tools, ...skills];
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
