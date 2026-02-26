/**
 * 执行器模块
 * 
 * v3.2.0 更新：
 * - 新增 ReAct 执行器（LLM 参与每一步决策）
 * - 保留原有并行执行器作为备选
 * - 统一执行接口
 */

// 导出原有并行执行器
export { ParallelExecutor, getExecutor, resetExecutor } from './parallel-executor';
export type { ExecutionResult, StepCallback } from './parallel-executor';

// 导出 ReAct 执行器
export { ReActExecutor, getReActExecutor, resetReActExecutor } from './react-executor';
export type { ReActResult, ReActContext } from './react-executor';

// 导出进程管理
export { ProcessTool, getProcessTool, resetProcessTool } from './process-tool';
export { ProcessSupervisor, createProcessSupervisor, getProcessSupervisor, resetProcessSupervisor } from './process/supervisor';
export type { SpawnInput, ManagedProcess } from './process/supervisor';
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
} from './process/types';
export { SPECIAL_KEYS, keyToChar, keysToString } from './process/types';

// 导出子Agent
export { SubAgentManager, getSubAgentManager, resetSubAgentManager, SubAgentStatus, SubAgentType } from './subagent';
export type { SubAgentConfig, SubAgentInfo } from './subagent';
