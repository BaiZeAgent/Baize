/**
 * 进程管理模块
 * 
 * 导出：
 * - ProcessTool: 进程管理技能
 * - ProcessSupervisor: 进程管理器
 * - 类型定义
 */

export { ProcessTool, getProcessTool, resetProcessTool } from '../process-tool';
export { ProcessSupervisor, createProcessSupervisor, getProcessSupervisor, resetProcessSupervisor } from './supervisor';
export type { SpawnInput, ManagedProcess } from './supervisor';
export type {
  ProcessState,
  ProcessRecord,
  ActiveProcess,
  ProcessResult,
  ProcessToolParams,
  ProcessSpawnParams,
  ProcessPollParams,
  ProcessWriteParams,
  ProcessSendKeysParams,
  ProcessPasteParams,
  ProcessKillParams,
  ProcessListParams,
  ProcessLogParams,
  ProcessSubmitParams,
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
} from './types';
export { SPECIAL_KEYS, keyToChar, keysToString } from './types';
