/**
 * ProcessTool 类型定义
 * 
 * 进程管理工具的类型系统，支持：
 * - spawn: 启动进程
 * - poll: 轮询输出
 * - write: 写入 stdin
 * - send-keys: 发送按键序列
 * - paste: 粘贴文本
 * - kill: 终止进程
 * - list: 列出进程
 * - log: 获取日志
 */

// ═══════════════════════════════════════════════════════════════
// 进程状态
// ═══════════════════════════════════════════════════════════════

/** 进程运行状态 */
export type ProcessState = 
  | 'starting'    // 启动中
  | 'running'     // 运行中
  | 'completed'   // 已完成
  | 'failed'      // 失败
  | 'killed'      // 被杀死
  | 'timeout';    // 超时

/** 进程记录 */
export interface ProcessRecord {
  /** 进程ID */
  id: string;
  /** 会话ID（关联到用户会话） */
  sessionId?: string;
  /** 作用域键（用于取消一组进程） */
  scopeKey?: string;
  /** 进程状态 */
  state: ProcessState;
  /** 启动时间 */
  startedAtMs: number;
  /** 结束时间 */
  endedAtMs?: number;
  /** 退出码 */
  exitCode?: number | null;
  /** 错误信息 */
  error?: string;
  /** 命令 */
  command: string;
  /** 参数 */
  args: string[];
  /** 工作目录 */
  cwd: string;
  /** 环境变量 */
  env: Record<string, string>;
  /** 超时时间（毫秒） */
  timeoutMs?: number;
  /** 是否为 PTY 模式 */
  isPty: boolean;
}

/** 活动进程 */
export interface ActiveProcess {
  /** 进程记录 */
  record: ProcessRecord;
  /** 子进程实例 */
  child: import('child_process').ChildProcess;
  /** stdin 写入流 */
  stdin: NodeJS.WritableStream | null;
  /** stdout 缓冲 */
  stdout: string;
  /** stderr 缓冲 */
  stderr: string;
  /** 取消函数 */
  cancel: (reason: string) => void;
  /** 等待完成 */
  wait: () => Promise<ProcessResult>;
}

/** 进程执行结果 */
export interface ProcessResult {
  /** 进程ID */
  id: string;
  /** 是否成功 */
  success: boolean;
  /** 退出码 */
  exitCode: number | null;
  /** stdout 内容 */
  stdout: string;
  /** stderr 内容 */
  stderr: string;
  /** 执行时长（毫秒） */
  durationMs: number;
  /** 错误信息 */
  error?: string;
  /** 是否被取消 */
  cancelled?: boolean;
  /** 取消原因 */
  cancelReason?: string;
}

// ═══════════════════════════════════════════════════════════════
// ProcessTool 操作类型
// ═══════════════════════════════════════════════════════════════

/** spawn 操作参数 */
export interface ProcessSpawnParams {
  /** 操作类型 */
  action: 'spawn';
  /** 要执行的命令 */
  command: string;
  /** 命令参数 */
  args?: string[];
  /** 工作目录 */
  cwd?: string;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 超时时间（毫秒），0 表示无超时 */
  timeoutMs?: number;
  /** 是否使用 PTY 模式 */
  pty?: boolean;
  /** 会话ID */
  sessionId?: string;
  /** 作用域键 */
  scopeKey?: string;
}

/** poll 操作参数 */
export interface ProcessPollParams {
  /** 操作类型 */
  action: 'poll';
  /** 进程ID */
  sessionId: string;
  /** 超时时间（毫秒），等待输出的最大时间 */
  timeoutMs?: number;
  /** 是否等待进程完成 */
  wait?: boolean;
}

/** write 操作参数 */
export interface ProcessWriteParams {
  /** 操作类型 */
  action: 'write';
  /** 进程ID */
  sessionId: string;
  /** 要写入的数据 */
  data: string;
  /** 是否添加换行符 */
  newline?: boolean;
}

/** send-keys 操作参数 */
export interface ProcessSendKeysParams {
  /** 操作类型 */
  action: 'send-keys';
  /** 进程ID */
  sessionId: string;
  /** 按键序列，如 ['Ctrl+C', 'Enter'] */
  keys: string[];
}

/** paste 操作参数 */
export interface ProcessPasteParams {
  /** 操作类型 */
  action: 'paste';
  /** 进程ID */
  sessionId: string;
  /** 要粘贴的文本 */
  text: string;
}

/** kill 操作参数 */
export interface ProcessKillParams {
  /** 操作类型 */
  action: 'kill';
  /** 进程ID */
  sessionId: string;
  /** 信号，默认 SIGTERM */
  signal?: 'SIGTERM' | 'SIGKILL' | 'SIGINT';
  /** 等待时间（毫秒），超时后强制杀死 */
  waitMs?: number;
}

/** list 操作参数 */
export interface ProcessListParams {
  /** 操作类型 */
  action: 'list';
  /** 过滤状态 */
  state?: ProcessState;
  /** 会话ID过滤 */
  sessionId?: string;
  /** 作用域键过滤 */
  scopeKey?: string;
}

/** log 操作参数 */
export interface ProcessLogParams {
  /** 操作类型 */
  action: 'log';
  /** 进程ID */
  sessionId: string;
  /** 最大行数 */
  maxLines?: number;
  /** 是否包含 stderr */
  includeStderr?: boolean;
}

/** submit 操作参数 */
export interface ProcessSubmitParams {
  /** 操作类型 */
  action: 'submit';
  /** 进程ID */
  sessionId: string;
  /** 提交的文本 */
  text: string;
}

/** ProcessTool 所有操作参数的联合类型 */
export type ProcessToolParams =
  | ProcessSpawnParams
  | ProcessPollParams
  | ProcessWriteParams
  | ProcessSendKeysParams
  | ProcessPasteParams
  | ProcessKillParams
  | ProcessListParams
  | ProcessLogParams
  | ProcessSubmitParams;

// ═══════════════════════════════════════════════════════════════
// ProcessTool 响应类型
// ═══════════════════════════════════════════════════════════════

/** spawn 响应 */
export interface ProcessSpawnResult {
  success: boolean;
  sessionId: string;
  pid?: number;
  message: string;
  error?: string;
}

/** poll 响应 */
export interface ProcessPollResult {
  success: boolean;
  sessionId: string;
  state: ProcessState;
  stdout: string;
  stderr: string;
  stdoutDelta?: string;
  stderrDelta?: string;
  exitCode?: number | null;
  durationMs: number;
  message: string;
}

/** write 响应 */
export interface ProcessWriteResult {
  success: boolean;
  sessionId: string;
  bytesWritten: number;
  message: string;
  error?: string;
}

/** send-keys 响应 */
export interface ProcessSendKeysResult {
  success: boolean;
  sessionId: string;
  keysSent: string[];
  message: string;
  error?: string;
}

/** paste 响应 */
export interface ProcessPasteResult {
  success: boolean;
  sessionId: string;
  message: string;
  error?: string;
}

/** kill 响应 */
export interface ProcessKillResult {
  success: boolean;
  sessionId: string;
  previousState: ProcessState;
  message: string;
  error?: string;
}

/** list 响应 */
export interface ProcessListResult {
  success: boolean;
  processes: Array<{
    id: string;
    command: string;
    state: ProcessState;
    startedAtMs: number;
    durationMs: number;
    exitCode?: number | null;
  }>;
  message: string;
}

/** log 响应 */
export interface ProcessLogResult {
  success: boolean;
  sessionId: string;
  stdout: string;
  stderr: string;
  lines: number;
  message: string;
}

/** submit 响应 */
export interface ProcessSubmitResult {
  success: boolean;
  sessionId: string;
  message: string;
  error?: string;
}

/** ProcessTool 响应联合类型 */
export type ProcessToolResult =
  | ProcessSpawnResult
  | ProcessPollResult
  | ProcessWriteResult
  | ProcessSendKeysResult
  | ProcessPasteResult
  | ProcessKillResult
  | ProcessListResult
  | ProcessLogResult
  | ProcessSubmitResult;

// ═══════════════════════════════════════════════════════════════
// 按键映射
// ═══════════════════════════════════════════════════════════════

/** 特殊按键映射表 */
export const SPECIAL_KEYS: Record<string, string> = {
  'Ctrl+A': '\x01',
  'Ctrl+B': '\x02',
  'Ctrl+C': '\x03',
  'Ctrl+D': '\x04',
  'Ctrl+E': '\x05',
  'Ctrl+F': '\x06',
  'Ctrl+G': '\x07',
  'Ctrl+H': '\x08',
  'Ctrl+I': '\x09',
  'Ctrl+J': '\x0a',
  'Ctrl+K': '\x0b',
  'Ctrl+L': '\x0c',
  'Ctrl+M': '\x0d',
  'Ctrl+N': '\x0e',
  'Ctrl+O': '\x0f',
  'Ctrl+P': '\x10',
  'Ctrl+Q': '\x11',
  'Ctrl+R': '\x12',
  'Ctrl+S': '\x13',
  'Ctrl+T': '\x14',
  'Ctrl+U': '\x15',
  'Ctrl+V': '\x16',
  'Ctrl+W': '\x17',
  'Ctrl+X': '\x18',
  'Ctrl+Y': '\x19',
  'Ctrl+Z': '\x1a',
  'Enter': '\x0d',
  'Return': '\x0d',
  'Tab': '\x09',
  'Escape': '\x1b',
  'Esc': '\x1b',
  'Backspace': '\x7f',
  'Delete': '\x1b[3~',
  'Up': '\x1b[A',
  'Down': '\x1b[B',
  'Right': '\x1b[C',
  'Left': '\x1b[D',
  'Home': '\x1b[H',
  'End': '\x1b[F',
  'PageUp': '\x1b[5~',
  'PageDown': '\x1b[6~',
};

/** 将按键名称转换为实际字符 */
export function keyToChar(key: string): string {
  if (key in SPECIAL_KEYS) {
    return SPECIAL_KEYS[key];
  }
  // 单个字符直接返回
  if (key.length === 1) {
    return key;
  }
  // 未知按键，返回空字符串
  return '';
}

/** 将按键序列转换为字符串 */
export function keysToString(keys: string[]): string {
  return keys.map(keyToChar).join('');
}
