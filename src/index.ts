/**
 * 白泽3.0 主入口
 * 
 * v3.1.0 更新：
 * - 新增智能路由器（双层决策机制）
 * - 新增上下文管理器（自动压缩）
 * - 新增错误恢复管理器
 * - 执行器集成锁机制
 * 
 * v3.1.1 更新：
 * - 新增沙箱管理器（Docker容器隔离）
 * - 新增进程管理器（后台执行）
 * - 新增向量搜索（语义检索）
 * - 新增子Agent支持（并行处理）
 * 
 * v3.1.2 更新：
 * - 新增插件系统
 * - 新增Hook系统
 * - 增强安全系统
 * - 添加测试覆盖
 */

// 类型定义
export * from './types';

// 可观测层 (L1)
export * from './observability/logger';

// 数据层 (L2)
export * from './memory/database';
export * from './memory/index';
// 向量搜索（避免命名冲突）
export { 
  VectorSearchManager, 
  getVectorSearch, 
  resetVectorSearch,
  VectorRecord,
  SearchResult as VectorSearchResult,
  VectorSearchConfig,
} from './memory/vector';

// 知识层 (L3)
export * from './knowledge';

// 能力层 (L4)
export * from './skills/base';
export * from './skills/registry';

// 执行层 (L5)
export { ParallelExecutor, getExecutor, ExecutionResult as ExecutorResult, resetExecutor } from './executor';
export * from './executor/process';
export * from './executor/subagent';

// 调度层 (L6)
export * from './scheduler';
export * from './scheduler/proactive';
export * from './scheduler/lock';

// 沙箱层 (L6.5)
export * from './sandbox';

// 决策层 (L7)
export * from './core/thinking/engine';
export * from './core/confirmation';
export * from './core/error';
export * from './core/brain';

// 核心模块
export * from './core/router';
export * from './core/context';
export * from './core/recovery';

// 安全层 (L8)
export * from './security';

// 插件系统
export * from './plugins';

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
