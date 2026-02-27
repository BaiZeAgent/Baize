/**
 * 核心模块导出
 */

// 钩子系统
export { HookRegistry, HookRunner, HookContext, HookResult, HookName, HookHandler, HookPriority, registerHook, runHook, getHookRegistry, getHookRunner, resetHooks } from '../hooks';

// 策略系统
export { PolicyPipeline, PolicyContext, PolicyResult, PolicyConfig, checkToolPolicy, getPolicyPipeline, DEFAULT_POLICY_CONFIG } from '../policy';

// 错误恢复
export { ErrorClassifier, ClassifiedError, AuthProfileManager, RetryPolicy, RetryConfig, classifyError, withRetry, getErrorClassifier, getProfileManager, DEFAULT_RETRY_CONFIG } from '../recovery';

// 上下文管理
export { ContextManager, ContextWindowGuard, ContextCompressor, SimpleTokenizer, getContextManager, countTokens, countMessagesTokens, DEFAULT_CONTEXT_CONFIG } from '../context';

// 审批系统
export { ApprovalManager, ApprovalResult, ApprovalStatus, ApprovalType, RiskLevel, detectSensitiveOperation, getOperationRisk, requiresApproval, getApprovalManager, DEFAULT_APPROVAL_CONFIG } from '../approval';

// 沙箱系统
export { SandboxManager, SandboxInstance, SandboxConfig, ExecResult, ExecOptions, getSandboxManager, execInSandbox, DEFAULT_SANDBOX_CONFIG } from '../sandbox';

// 进程管理
export { ProcessManager, ProcessRegistry, ProcessInfo, ProcessResult, ProcessOptions, getProcessManager, exec, execOutput, DEFAULT_TIMEOUT_CONFIG } from '../process';

// 嵌入系统
export { EmbeddingManager, EmbeddingProvider, EmbeddingVector, EmbeddingResult, OpenAIEmbeddingProvider, LocalEmbeddingProvider, getEmbeddingManager, setEmbeddingManager, getEmbedding, getEmbeddings, similarity } from '../embeddings';

// 向量存储
export { MemoryVectorStore, PersistentVectorStore, VectorDocument, SearchResult, SearchOptions, getVectorStore, setVectorStore, createPersistentVectorStore, searchSimilar, addVectorDoc } from '../vector';

// 混合检索
export { HybridSearchEngine, FullTextIndex, HybridSearchResult, HybridSearchOptions, IndexDocument, RetrievalStrategy, getSearchEngine, search, indexDocument } from '../search';

// 文件监控
export { FileWatcher, IndexSynchronizer, FileChangeEvent, FileChangeType, WatcherConfig, WatcherStats, getFileWatcher, getIndexSynchronizer, resetWatcher } from '../watcher';

// 环境管理
export { EnvironmentManager, DependencyChecker, DependencyInstaller, PackageManagerDetector, Dependency, DependencyCheckResult, InstallResult, getEnvironmentManager, isInstalled, ensureInstalled, install } from '../environment';

// 自动安装
export { AutoSkillInstaller, CapabilityGap, SkillSearchResult, InstallDecision, AutoInstallerConfig, getAutoInstaller, detectCapabilityGap, searchSkills, handleCapabilityGap } from '../environment/auto-installer';
