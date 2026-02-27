/**
 * 白泽3.0 主入口
 */

// 类型定义
export * from './types';

// 可观测层
export * from './observability/logger';

// 数据层
export * from './memory/database';
export * from './memory/index';
export { 
  VectorSearchManager, 
  getVectorSearch, 
  resetVectorSearch,
  VectorRecord,
  SearchResult as VectorSearchResult,
  VectorSearchConfig,
} from './memory/vector';

// 知识层
export * from './knowledge';

// 能力层
export * from './skills/base';
export * from './skills/registry';

// 执行层
export { Executor, getExecutor, resetExecutor } from './executor';
export type { ExecutionResult } from './executor';

// 调度层
export * from './scheduler';
export * from './scheduler/proactive';
export { ResourceLockManager as LockManager, getLockManager, resetLockManager } from './scheduler/lock';

// 沙箱层
export * from './sandbox';

// 决策层
export * from './core/thinking/engine';
export * from './core/brain';
export { BrainV2, getBrainV2, resetBrainV2, DecisionV2 } from './core/brain/brain-v2';
export type { IntentType as IntentTypeV2 } from './core/brain/brain-v2';
export * from './core/router';
export * from './core/context';
export * from './core/recovery';

// 安全层
export * from './security';

// 插件系统
export * from './plugins';

// 交互层
export * from './interaction';

// 自进化模块
export { 
  EvolutionManager, 
  getEvolutionManager,
} from './evolution';

// LLM适配器
export * from './llm';

// 工具函数
export * from './utils';
