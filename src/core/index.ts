/**
 * 核心模块导出
 */

// 钩子系统
export { HookRegistry, HookRunner, registerHook, runHook, getHookRegistry, getHookRunner, resetHooks } from '../hooks';
export type { HookContext, HookResult, HookName, HookHandler, HookPriority } from '../hooks';

// 策略系统
export { PolicyPipeline, checkToolPolicy, getPolicyPipeline, DEFAULT_POLICY_CONFIG } from '../policy';
export type { PolicyContext, PolicyResult, PolicyConfig } from '../policy';

// 错误恢复
export { ErrorClassifier, classifyError, withRetry, getErrorClassifier, getProfileManager, DEFAULT_RETRY_CONFIG } from '../recovery';
export type { ClassifiedError, AuthProfileManager, RetryPolicy, RetryConfig } from '../recovery';

// 上下文管理
export { ContextManager, ContextWindowGuard, ContextCompressor, SimpleTokenizer, getContextManager, countTokens, countMessagesTokens, DEFAULT_CONTEXT_CONFIG } from '../context';

// 审批系统
export { ApprovalManager, detectSensitiveOperation, getOperationRisk, requiresApproval, getApprovalManager, DEFAULT_APPROVAL_CONFIG } from '../approval';
export type { ApprovalResult, ApprovalStatus, ApprovalType } from '../approval';
export { RiskLevel } from '../types';

// 沙箱系统
export { SandboxManager, getSandboxManager, execInSandbox, DEFAULT_SANDBOX_CONFIG } from '../sandbox';
export type { SandboxInstance, SandboxConfig, ExecResult, ExecOptions } from '../sandbox';

// 进程管理
export { ProcessManager, getProcessManager, exec, execOutput, DEFAULT_TIMEOUT_CONFIG } from '../process';
export type { ProcessRegistry, ProcessInfo, ProcessResult, ProcessOptions } from '../process';

// 嵌入系统
export { EmbeddingManager, OpenAIEmbeddingProvider, LocalEmbeddingProvider, getEmbeddingManager, setEmbeddingManager, getEmbedding, getEmbeddings, similarity } from '../embeddings';
export type { EmbeddingProvider, EmbeddingVector, EmbeddingResult } from '../embeddings';

// 向量存储
export { MemoryVectorStore, PersistentVectorStore, getVectorStore, setVectorStore, createPersistentVectorStore, searchSimilar, addVectorDoc } from '../vector';
export type { VectorDocument, SearchResult, SearchOptions } from '../vector';

// 混合检索
export { HybridSearchEngine, getSearchEngine, search, indexDocument } from '../search';
export type { FullTextIndex, HybridSearchResult, HybridSearchOptions, IndexDocument, RetrievalStrategy } from '../search';

// 文件监控
export { FileWatcher, IndexSynchronizer, getFileWatcher, getIndexSynchronizer, resetWatcher } from '../watcher';
export type { FileChangeEvent, FileChangeType, WatcherConfig, WatcherStats } from '../watcher';

// 环境管理
export { EnvironmentManager, DependencyChecker, DependencyInstaller, PackageManagerDetector, getEnvironmentManager, isInstalled, ensureInstalled, install } from '../environment';
export type { Dependency, DependencyCheckResult, InstallResult } from '../environment';

// 自动安装
export { AutoSkillInstaller, getAutoInstaller, detectCapabilityGap, searchSkills, handleCapabilityGap } from '../environment/auto-installer';
export type { CapabilityGap, SkillSearchResult, InstallDecision, AutoInstallerConfig } from '../environment/auto-installer';

// ═══════════════════════════════════════════════════════════════
// V3 新增模块
// ═══════════════════════════════════════════════════════════════

// 智能路由器 V2
export { IntelligentRouter, getIntelligentRouter, resetIntelligentRouter } from './router/intelligent-router';
export type { IntentHierarchy, IntentType, CandidatePlan, RouteDecisionV2, RouteContextV2 } from './router/intelligent-router';

// 任务规划器
export { TaskPlanner, getTaskPlanner, resetTaskPlanner } from './planner';
export type { ExecutionPlan, PlannedTask, TaskDependency, PlanStatus, TaskStatus, ExecutionContext, PlanExecutionResult } from './planner';

// 元认知引擎
export { MetacognitionEngine, getMetacognition, resetMetacognition } from './metacognition';
export type { CapabilityAssessment, SelfAssessment, ReflectionResult, DecisionConfidence, BoundaryCheck } from './metacognition';

// 统一大脑 V3
export { UnifiedBrainV3, getBrainV3, resetBrainV3 } from './brain-v3';
export type { BrainV3Config, ProcessingResult } from './brain-v3';
