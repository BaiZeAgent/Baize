/**
 * 白泽3.0 主入口
 * 
 * v3.1.0 更新：
 * - 新增智能路由器（双层决策机制）
 * - 新增上下文管理器（自动压缩）
 * - 新增错误恢复管理器
 * - 执行器集成锁机制
 */

// 类型定义
export * from './types';

// 可观测层 (L1)
export * from './observability/logger';

// 数据层 (L2)
export * from './memory/database';
export * from './memory/index';

// 知识层 (L3)
export * from './knowledge';

// 能力层 (L4)
export * from './skills/base';
export * from './skills/registry';

// 执行层 (L5)
export { ParallelExecutor, getExecutor, ExecutionResult as ExecutorResult, resetExecutor } from './executor';

// 调度层 (L6)
export * from './scheduler';
export * from './scheduler/proactive';
export * from './scheduler/lock';

// 决策层 (L7)
export * from './core/thinking/engine';
export * from './core/confirmation';
export * from './core/error';
export * from './core/brain';

// 核心模块 (新增)
export * from './core/router';
export * from './core/context';
export * from './core/recovery';

// 安全层 (L8)
export * from './security';

// 交互层 (L9)
export * from './interaction';

// 自进化模块
export { 
  EvolutionManager, 
  getEvolutionManager,
  getRoleTeamManager,
  getPermissionManager,
  getApprovalManager,
  getEvolutionExecutor,
} from './evolution';
export * from './evolution/team';
export * from './evolution/permission';
export * from './evolution/approval';
export { ExecutionResult as EvolutionResult } from './evolution/executor';

// LLM适配器
export * from './llm';

// 工具函数
export * from './utils';
