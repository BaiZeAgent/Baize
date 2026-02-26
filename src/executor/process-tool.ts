/**
 * ProcessTool - 进程管理技能
 * 
 * 支持的操作：
 * - spawn: 启动进程
 * - poll: 轮询输出
 * - write: 写入 stdin
 * - send-keys: 发送按键序列
 * - paste: 粘贴文本
 * - kill: 终止进程
 * - list: 列出进程
 * - log: 获取日志
 * - submit: 提交文本（写入 + Enter）
 */

import { Skill, SkillContext } from '../skills/base';
import { SkillResult, RiskLevel } from '../types';
import { getLogger } from '../observability/logger';
import {
  getProcessSupervisor,
  ProcessSupervisor,
} from './process/supervisor';
import {
  ProcessToolParams,
  ProcessToolResult,
  ProcessSpawnResult,
  ProcessPollResult,
  ProcessWriteResult,
  ProcessSendKeysResult,
  ProcessPasteResult,
  ProcessKillResult,
  ProcessListResult,
  ProcessLogResult,
  ProcessSubmitResult,
  ProcessState,
} from './process/types';

const logger = getLogger('skill:process');

/**
 * ProcessTool 技能
 * 
 * 用于管理长时间运行的进程，支持：
 * - 后台运行进程
 * - 实时获取输出
 * - 与进程交互（发送按键、粘贴文本）
 * - 终止进程
 */
export class ProcessTool extends Skill {
  private supervisor: ProcessSupervisor;

  constructor() {
    super();
    this.supervisor = getProcessSupervisor();
  }

  get name(): string {
    return 'process';
  }

  get description(): string {
    return `管理运行中的进程：启动、轮询输出、发送按键、终止等。

支持的操作：
- spawn: 启动新进程（后台运行）
- poll: 轮询进程输出
- write: 向进程 stdin 写入数据
- send-keys: 发送按键序列（如 Ctrl+C, Enter）
- paste: 粘贴文本
- kill: 终止进程
- list: 列出所有进程
- log: 获取进程日志
- submit: 提交文本（写入 + Enter）

使用场景：
- 运行长时间任务（如服务器、构建）
- 与交互式程序通信
- 执行需要中途干预的命令`;
  }

  get capabilities(): string[] {
    return [
      'process_management',
      'background_execution',
      'interactive_shell',
      'long_running_tasks',
    ];
  }

  get riskLevel(): RiskLevel {
    return RiskLevel.HIGH;
  }

  get inputSchema(): Record<string, unknown> {
    return {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['spawn', 'poll', 'write', 'send-keys', 'paste', 'kill', 'list', 'log', 'submit'],
          description: '要执行的操作',
        },
        // spawn 参数
        command: {
          type: 'string',
          description: '要执行的命令（spawn 操作）',
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: '命令参数',
        },
        cwd: {
          type: 'string',
          description: '工作目录',
        },
        env: {
          type: 'object',
          additionalProperties: { type: 'string' },
          description: '环境变量',
        },
        timeoutMs: {
          type: 'number',
          description: '超时时间（毫秒）',
        },
        // poll/write/send-keys/paste/kill/log/submit 参数
        sessionId: {
          type: 'string',
          description: '进程ID',
        },
        data: {
          type: 'string',
          description: '要写入的数据（write 操作）',
        },
        keys: {
          type: 'array',
          items: { type: 'string' },
          description: '按键序列（send-keys 操作）',
        },
        text: {
          type: 'string',
          description: '要粘贴/提交的文本',
        },
        signal: {
          type: 'string',
          enum: ['SIGTERM', 'SIGKILL', 'SIGINT'],
          description: '终止信号',
        },
        wait: {
          type: 'boolean',
          description: '是否等待进程完成（poll 操作）',
        },
        maxLines: {
          type: 'number',
          description: '最大行数（log 操作）',
        },
        includeStderr: {
          type: 'boolean',
          description: '是否包含 stderr（log 操作）',
        },
      },
      required: ['action'],
    };
  }

  async run(params: Record<string, unknown>, context: SkillContext): Promise<SkillResult> {
    const typedParams = params as unknown as ProcessToolParams;
    logger.info('执行进程操作', { action: typedParams.action });

    try {
      switch (typedParams.action) {
        case 'spawn':
          return this.handleSpawn(typedParams, context);

        case 'poll':
          return this.handlePoll(typedParams);

        case 'write':
          return this.handleWrite(typedParams);

        case 'send-keys':
          return this.handleSendKeys(typedParams);

        case 'paste':
          return this.handlePaste(typedParams);

        case 'kill':
          return this.handleKill(typedParams);

        case 'list':
          return this.handleList(typedParams);

        case 'log':
          return this.handleLog(typedParams);

        case 'submit':
          return this.handleSubmit(typedParams);

        default:
          return {
            success: false,
            data: {},
            message: `未知操作: ${(typedParams as any).action}`,
            error: `未知操作: ${(typedParams as any).action}`,
          };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('进程操作失败', { action: typedParams.action, error: errorMsg });
      
      return {
        success: false,
        data: {},
        message: `操作失败: ${errorMsg}`,
        error: errorMsg,
      };
    }
  }

  /**
   * spawn: 启动进程
   */
  private async handleSpawn(
    params: Extract<ProcessToolParams, { action: 'spawn' }>,
    context: SkillContext
  ): Promise<SkillResult> {
    const { command, args, cwd, env, timeoutMs } = params;

    if (!command) {
      return {
        success: false,
        data: {},
        message: '缺少必需参数: command',
        error: '缺少必需参数: command',
      };
    }

    const managed = await this.supervisor.spawn({
      command,
      args: args || [],
      cwd,
      env,
      timeoutMs,
      sessionId: context.conversationId,
    });

    const result: ProcessSpawnResult = {
      success: true,
      sessionId: managed.id,
      pid: managed.pid,
      message: `进程已启动: ${command} ${args?.join(' ') || ''}\n进程ID: ${managed.id}\nPID: ${managed.pid || 'N/A'}`,
    };

    return {
      success: true,
      data: result as unknown as Record<string, unknown>,
      message: result.message,
    };
  }

  /**
   * poll: 轮询进程输出
   */
  private async handlePoll(
    params: Extract<ProcessToolParams, { action: 'poll' }>
  ): Promise<SkillResult> {
    const { sessionId, timeoutMs, wait } = params;

    if (!sessionId) {
      return {
        success: false,
        data: {},
        message: '缺少必需参数: sessionId',
        error: '缺少必需参数: sessionId',
      };
    }

    const pollResult = await this.supervisor.poll(sessionId, timeoutMs || 5000);

    const result: ProcessPollResult = {
      success: true,
      sessionId,
      state: pollResult.state,
      stdout: pollResult.stdout,
      stderr: pollResult.stderr,
      stdoutDelta: pollResult.stdoutDelta,
      stderrDelta: pollResult.stderrDelta,
      exitCode: pollResult.exitCode,
      durationMs: Date.now(),
      message: this.formatPollMessage(pollResult),
    };

    return {
      success: true,
      data: result as unknown as Record<string, unknown>,
      message: result.message,
    };
  }

  /**
   * write: 写入 stdin
   */
  private async handleWrite(
    params: Extract<ProcessToolParams, { action: 'write' }>
  ): Promise<SkillResult> {
    const { sessionId, data, newline } = params;

    if (!sessionId) {
      return {
        success: false,
        data: {},
        message: '缺少必需参数: sessionId',
        error: '缺少必需参数: sessionId',
      };
    }

    if (data === undefined) {
      return {
        success: false,
        data: {},
        message: '缺少必需参数: data',
        error: '缺少必需参数: data',
      };
    }

    const writeData = newline !== false ? data + '\n' : data;
    const writeResult = await this.supervisor.write(sessionId, writeData);

    const result: ProcessWriteResult = {
      success: true,
      sessionId,
      bytesWritten: writeResult.bytesWritten,
      message: `已写入 ${writeResult.bytesWritten} 字节到进程 ${sessionId}`,
    };

    return {
      success: true,
      data: result as unknown as Record<string, unknown>,
      message: result.message,
    };
  }

  /**
   * send-keys: 发送按键序列
   */
  private async handleSendKeys(
    params: Extract<ProcessToolParams, { action: 'send-keys' }>
  ): Promise<SkillResult> {
    const { sessionId, keys } = params;

    if (!sessionId) {
      return {
        success: false,
        data: {},
        message: '缺少必需参数: sessionId',
        error: '缺少必需参数: sessionId',
      };
    }

    if (!keys || keys.length === 0) {
      return {
        success: false,
        data: {},
        message: '缺少必需参数: keys',
        error: '缺少必需参数: keys',
      };
    }

    await this.supervisor.sendKeys(sessionId, keys);

    const result: ProcessSendKeysResult = {
      success: true,
      sessionId,
      keysSent: keys,
      message: `已发送按键: ${keys.join(', ')}`,
    };

    return {
      success: true,
      data: result as unknown as Record<string, unknown>,
      message: result.message,
    };
  }

  /**
   * paste: 粘贴文本
   */
  private async handlePaste(
    params: Extract<ProcessToolParams, { action: 'paste' }>
  ): Promise<SkillResult> {
    const { sessionId, text } = params;

    if (!sessionId) {
      return {
        success: false,
        data: {},
        message: '缺少必需参数: sessionId',
        error: '缺少必需参数: sessionId',
      };
    }

    if (!text) {
      return {
        success: false,
        data: {},
        message: '缺少必需参数: text',
        error: '缺少必需参数: text',
      };
    }

    await this.supervisor.paste(sessionId, text);

    const result: ProcessPasteResult = {
      success: true,
      sessionId,
      message: `已粘贴 ${text.length} 个字符`,
    };

    return {
      success: true,
      data: result as unknown as Record<string, unknown>,
      message: result.message,
    };
  }

  /**
   * kill: 终止进程
   */
  private async handleKill(
    params: Extract<ProcessToolParams, { action: 'kill' }>
  ): Promise<SkillResult> {
    const { sessionId, signal } = params;

    if (!sessionId) {
      return {
        success: false,
        data: {},
        message: '缺少必需参数: sessionId',
        error: '缺少必需参数: sessionId',
      };
    }

    const record = this.supervisor.getRecord(sessionId);
    const previousState: ProcessState = record?.state || 'completed';

    const killed = await this.supervisor.kill(sessionId, signal || 'SIGTERM');

    const result: ProcessKillResult = {
      success: killed,
      sessionId,
      previousState,
      message: killed
        ? `进程 ${sessionId} 已终止`
        : `进程 ${sessionId} 已结束或不存在`,
    };

    return {
      success: true,
      data: result as unknown as Record<string, unknown>,
      message: result.message,
    };
  }

  /**
   * list: 列出进程
   */
  private handleList(
    params: Extract<ProcessToolParams, { action: 'list' }>
  ): SkillResult {
    const { state, sessionId, scopeKey } = params;

    const processes = this.supervisor.list({
      state,
      sessionId,
      scopeKey,
    });

    const formattedProcesses = processes.map((p) => ({
      id: p.id,
      command: p.command,
      state: p.state,
      startedAtMs: p.startedAtMs,
      durationMs: Date.now() - p.startedAtMs,
      exitCode: p.exitCode,
    }));

    const result: ProcessListResult = {
      success: true,
      processes: formattedProcesses,
      message: this.formatListMessage(formattedProcesses),
    };

    return {
      success: true,
      data: result as unknown as Record<string, unknown>,
      message: result.message,
    };
  }

  /**
   * log: 获取日志
   */
  private async handleLog(
    params: Extract<ProcessToolParams, { action: 'log' }>
  ): Promise<SkillResult> {
    const { sessionId, maxLines, includeStderr } = params;

    if (!sessionId) {
      return {
        success: false,
        data: {},
        message: '缺少必需参数: sessionId',
        error: '缺少必需参数: sessionId',
      };
    }

    const pollResult = await this.supervisor.poll(sessionId, 1000);

    let output = pollResult.stdout;
    if (includeStderr !== false && pollResult.stderr) {
      output += '\n--- stderr ---\n' + pollResult.stderr;
    }

    // 限制行数
    if (maxLines && maxLines > 0) {
      const lines = output.split('\n');
      output = lines.slice(-maxLines).join('\n');
    }

    const result: ProcessLogResult = {
      success: true,
      sessionId,
      stdout: pollResult.stdout,
      stderr: pollResult.stderr,
      lines: output.split('\n').length,
      message: output || '无输出',
    };

    return {
      success: true,
      data: result as unknown as Record<string, unknown>,
      message: result.message,
    };
  }

  /**
   * submit: 提交文本（写入 + Enter）
   */
  private async handleSubmit(
    params: Extract<ProcessToolParams, { action: 'submit' }>
  ): Promise<SkillResult> {
    const { sessionId, text } = params;

    if (!sessionId) {
      return {
        success: false,
        data: {},
        message: '缺少必需参数: sessionId',
        error: '缺少必需参数: sessionId',
      };
    }

    if (text === undefined) {
      return {
        success: false,
        data: {},
        message: '缺少必需参数: text',
        error: '缺少必需参数: text',
      };
    }

    // 写入文本 + Enter
    await this.supervisor.write(sessionId, text + '\n');

    const result: ProcessSubmitResult = {
      success: true,
      sessionId,
      message: `已提交: ${text}`,
    };

    return {
      success: true,
      data: result as unknown as Record<string, unknown>,
      message: result.message,
    };
  }

  /**
   * 格式化 poll 消息
   */
  private formatPollMessage(pollResult: {
    state: string;
    stdout: string;
    stderr: string;
    stdoutDelta?: string;
    stderrDelta?: string;
    exitCode?: number | null;
  }): string {
    const parts: string[] = [`状态: ${pollResult.state}`];

    if (pollResult.exitCode !== undefined && pollResult.exitCode !== null) {
      parts.push(`退出码: ${pollResult.exitCode}`);
    }

    if (pollResult.stdoutDelta) {
      parts.push(`\n--- 新输出 ---\n${pollResult.stdoutDelta}`);
    }

    if (pollResult.stderrDelta) {
      parts.push(`\n--- 新错误 ---\n${pollResult.stderrDelta}`);
    }

    // 如果没有增量输出，显示完整输出（截断）
    if (!pollResult.stdoutDelta && pollResult.stdout) {
      const truncated = pollResult.stdout.length > 1000
        ? pollResult.stdout.slice(-1000) + '...(已截断)'
        : pollResult.stdout;
      parts.push(`\n--- 输出 ---\n${truncated}`);
    }

    return parts.join('\n');
  }

  /**
   * 格式化 list 消息
   */
  private formatListMessage(processes: Array<{
    id: string;
    command: string;
    state: string;
    startedAtMs: number;
    durationMs: number;
    exitCode?: number | null;
  }>): string {
    if (processes.length === 0) {
      return '没有进程';
    }

    const lines = processes.map((p) => {
      const duration = (p.durationMs / 1000).toFixed(1);
      const exitCode = p.exitCode !== undefined ? ` [${p.exitCode}]` : '';
      return `${p.id}: ${p.command} (${p.state}, ${duration}s)${exitCode}`;
    });

    return `共 ${processes.length} 个进程:\n${lines.join('\n')}`;
  }
}

// ═══════════════════════════════════════════════════════════════
// 导出
// ═══════════════════════════════════════════════════════════════

let processToolInstance: ProcessTool | null = null;

export function getProcessTool(): ProcessTool {
  if (!processToolInstance) {
    processToolInstance = new ProcessTool();
  }
  return processToolInstance;
}

export function resetProcessTool(): void {
  processToolInstance = null;
}
