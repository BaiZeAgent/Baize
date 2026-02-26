/**
 * 白泽3.0 核心类型定义
 * 
 * 严格按照架构设计文档定义所有数据类型
 */

// ═══════════════════════════════════════════════════════════════
// 枚举类型
// ═══════════════════════════════════════════════════════════════

/** 任务状态 */
export enum TaskStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

/** 风险等级 */
export enum RiskLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/** 确认动作 */
export enum ConfirmAction {
  CONFIRM = 'confirm',
  CANCEL = 'cancel',
  SKIP_FUTURE = 'skip_future',
}

/** 错误类别 */
export enum ErrorCategory {
  USER_INPUT = 'user_input',
  USER_CANCEL = 'user_cancel',
  SKILL_NOT_FOUND = 'skill_not_found',
  SKILL_ERROR = 'skill_error',
  SKILL_TIMEOUT = 'skill_timeout',
  NETWORK_ERROR = 'network_error',
  RESOURCE_UNAVAILABLE = 'resource_unavailable',
  SYSTEM_ERROR = 'system_error',
  LLM_ERROR = 'llm_error',
  UNKNOWN = 'unknown',
}

/** 错误严重程度 */
export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/** 降级等级 */
export enum DegradationLevel {
  NONE = 'none',
  MINIMAL = 'minimal',
  MODERATE = 'moderate',
  SEVERE = 'severe',
  EMERGENCY = 'emergency',
}

/** 自进化权限 */
export enum EvolutionPermission {
  DENIED = 'denied',
  CONFIRM = 'confirm',
  AUTO = 'auto',
}

// ═══════════════════════════════════════════════════════════════
// 思考过程相关类型（六阶段）
// ═══════════════════════════════════════════════════════════════

/** 理解阶段结果 */
export interface Understanding {
  /** 是否是简单对话 */
  isSimpleChat?: boolean;
  /** 直接回复（简单对话时使用） */
  directResponse?: string;
  literalMeaning: string;
  implicitIntent: string;
  context: Record<string, unknown>;
  constraints: string[];
  coreNeed: string;
}

/** 任务 */
export interface Task {
  id: string;
  description: string;
  type: string;
  skillName?: string;
  params: Record<string, unknown>;
  riskLevel: RiskLevel;
  dependencies: string[];
  status?: TaskStatus;
}

/** 拆解阶段结果 */
export interface Decomposition {
  tasks: Task[];
  dependencies: Record<string, string[]>;
  parallelGroups: string[][];
}

/** 技能选择 */
export interface SkillSelection {
  skillName: string;
  params: Record<string, unknown>;
  reason: string;
  alternatives: string[];
}

/** 规划阶段结果 */
export interface Planning {
  skillSelections: SkillSelection[];
  executionOrder: string[];
  estimatedTime: number;
  risks: string[];
  needConfirm: boolean;
  confirmReason: string;
}

/** 重试策略 */
export interface RetryPolicy {
  maxRetries: number;
  delay: number;
  backoff: 'fixed' | 'exponential';
}

/** 调度阶段结果 */
export interface Scheduling {
  executionId: string;
  parallelGroups: string[][];
  timeout: number;
  retryPolicy: RetryPolicy;
}

/** 任务执行结果 */
export interface TaskResult {
  taskId: string;
  success: boolean;
  data: Record<string, unknown>;
  message: string;
  error?: string;
  duration: number;
  /** 直接回复（简单对话时使用） */
  directResponse?: string;
}

/** 验收阶段结果 */
export interface Validation {
  passed: boolean;
  issues: string[];
  suggestions: string[];
  needRetry: boolean;
  retryStrategy: string;
}

/** 反思阶段结果 */
export interface Reflection {
  successRate: number;
  failureAnalysis: string;
  rootCauses: string[];
  improvements: string[];
  learnedPatterns: string[];
  suggestedActions: string[];
}

/** 思考过程（完整六阶段） */
export interface ThoughtProcess {
  understanding: Understanding;
  decomposition: Decomposition;
  planning: Planning;
  scheduling?: Scheduling;
  validation?: Validation;
  reflection?: Reflection;
  createdAt: Date;
  duration: number;
  /** 直接回复（简单对话时使用） */
  directResponse?: string;
}

// ═══════════════════════════════════════════════════════════════
// 技能相关类型
// ═══════════════════════════════════════════════════════════════

/** 技能执行结果 */
export interface SkillResult {
  success: boolean;
  data: Record<string, unknown>;
  message: string;
  error?: string;
}

/** 技能信息 */
export interface SkillInfo {
  name: string;
  description: string;
  whenToUse?: string;  // 何时使用此技能
  capabilities: string[];
  riskLevel: RiskLevel;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

/** 技能执行上下文 */
export interface SkillContext {
  userId?: string;
  conversationId?: string;
  memory?: unknown;
  config?: unknown;
}

/** 验证结果 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════
// 错误相关类型
// ═══════════════════════════════════════════════════════════════

/** 白泽错误 */
export interface BaizeError {
  category: ErrorCategory;
  severity: ErrorSeverity;
  message: string;
  detail: string;
  recoverable: boolean;
  recoveryOptions: string[];
}

// ═══════════════════════════════════════════════════════════════
// LLM相关类型
// ═══════════════════════════════════════════════════════════════

/** LLM消息 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** LLM选项 */
export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
}

/** LLM响应 */
export interface LLMResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  provider: string;
}

/** LLM提供商类型 */
export type LLMProviderType = 'openai-compatible' | 'ollama';

/** LLM提供商配置 */
export interface LLMProviderConfig {
  enabled: boolean;
  type: LLMProviderType;
  baseURL: string;
  model: string;
  apiKey?: string;
  temperature: number;
  maxTokens: number;
  timeout: number;
}

// ═══════════════════════════════════════════════════════════════
// 记忆系统相关类型
// ═══════════════════════════════════════════════════════════════

/** 情景记忆 */
export interface EpisodicMemory {
  id: number;
  type: string;
  timestamp: Date;
  content: string;
  createdAt: Date;
}

/** 声明式记忆 */
export interface DeclarativeMemory {
  key: string;
  value: string;
  confidence: number;
  timesReinforced: number;
  createdAt: Date;
  updatedAt: Date;
}

/** 程序性记忆 */
export interface ProceduralMemory {
  key: string;
  value: string;
  createdAt: Date;
  updatedAt: Date;
}

// ═══════════════════════════════════════════════════════════════
// 主动任务相关类型
// ═══════════════════════════════════════════════════════════════

/** 触发器类型 */
export type TriggerType = 'time' | 'event' | 'condition';

/** 主动任务 */
export interface ProactiveTask {
  id: string;
  type: TriggerType;
  triggerConfig: Record<string, unknown>;
  actionConfig: Record<string, unknown>;
  status: TaskStatus;
  createdAt: Date;
  lastRunAt?: Date;
  nextRunAt?: Date;
}

/** 任务执行历史 */
export interface TaskHistory {
  id: number;
  taskId: string;
  startedAt?: Date;
  completedAt?: Date;
  status: TaskStatus;
  result?: string;
}

// ═══════════════════════════════════════════════════════════════
// 自进化相关类型
// ═══════════════════════════════════════════════════════════════

/** 角色类型 */
export enum Role {
  PRODUCT_MANAGER = 'product_manager',
  DEVELOPER = 'developer',
  TESTER = 'tester',
  BETA_TESTER = 'beta_tester',
  REVIEWER = 'reviewer',
}

/** 角色思考结果 */
export interface RoleThought {
  role: Role;
  thoughts: string;
  decisions: string[];
  concerns: string[];
  suggestions: string[];
  approved: boolean;
  vetoReason?: string;
}

/** 自进化请求 */
export interface EvolutionRequest {
  id: string;
  type: 'new_skill' | 'modify_skill' | 'optimize' | 'fix';
  description: string;
  targetPath: string;
  changes: Record<string, unknown>;
  reason: string;
  riskAssessment: string;
  permission: EvolutionPermission;
  status: 'pending' | 'approved' | 'rejected' | 'completed';
  createdAt: Date;
  approvedBy?: string;
  approvedAt?: Date;
}

/** 自进化历史 */
export interface EvolutionHistory {
  id: number;
  timestamp: Date;
  requestId: string;
  type: string;
  target: string;
  description: string;
  result: string;
}

/** 进化范围 */
export interface EvolutionScope {
  path: string;
  permission: EvolutionPermission;
  reason: string;
  reviewer?: string;
}

// ═══════════════════════════════════════════════════════════════
// 确认策略相关类型
// ═══════════════════════════════════════════════════════════════

/** 确认请求 */
export interface ConfirmationRequest {
  id: string;
  operation: string;
  riskLevel: RiskLevel;
  message: string;
  options: string[];
  timeout: number;
  createdAt: Date;
}

/** 确认响应 */
export interface ConfirmationResponse {
  requestId: string;
  action: ConfirmAction;
  respondedAt: Date;
}

/** 信任记录 */
export interface TrustRecord {
  operation: string;
  successCount: number;
  failureCount: number;
  lastSuccessAt?: Date;
  skipConfirm: boolean;
}

// ═══════════════════════════════════════════════════════════════
// 上下文管理相关类型 (第十二章)
// ═══════════════════════════════════════════════════════════════

/** Token预算配置 */
export interface TokenBudget {
  /** 总预算 */
  total: number;
  /** 系统提示词预算 */
  system: number;
  /** 上下文历史预算 */
  context: number;
  /** 当前任务预算 */
  current: number;
  /** 预留预算 */
  reserved: number;
}

/** 上下文压缩策略 */
export interface CompressionStrategy {
  /** 压缩类型 */
  type: 'summary' | 'extract' | 'truncate';
  /** 目标压缩比 */
  targetRatio: number;
  /** 保留关键信息 */
  preserveKeys: string[];
}

/** 上下文条目 */
export interface ContextEntry {
  /** 条目ID */
  id: string;
  /** 条目类型 */
  type: 'system' | 'user' | 'assistant' | 'tool' | 'thought';
  /** 内容 */
  content: string;
  /** Token数量 */
  tokens: number;
  /** 时间戳 */
  timestamp: Date;
  /** 重要性分数 (0-1) */
  importance: number;
  /** 是否可压缩 */
  compressible: boolean;
}

/** 上下文窗口 */
export interface ContextWindow {
  /** 窗口ID */
  id: string;
  /** 条目列表 */
  entries: ContextEntry[];
  /** 总Token数 */
  totalTokens: number;
  /** 预算配置 */
  budget: TokenBudget;
  /** 创建时间 */
  createdAt: Date;
  /** 更新时间 */
  updatedAt: Date;
}

/** 上下文管理器配置 */
export interface ContextManagerConfig {
  /** 最大Token数 */
  maxTokens: number;
  /** 系统提示词预算比例 */
  systemRatio: number;
  /** 上下文预算比例 */
  contextRatio: number;
  /** 当前任务预算比例 */
  currentRatio: number;
  /** 预留预算比例 */
  reservedRatio: number;
  /** 压缩阈值 (当使用率达到此值时触发压缩) */
  compressionThreshold: number;
  /** 滑动窗口大小 */
  slidingWindowSize: number;
}

/** 能力缺口 (第九章 9.2) */
export interface CapabilityGap {
  /** 缺口ID */
  id: string;
  /** 检测时间 */
  detectedAt: Date;
  /** 用户输入 */
  userInput: string;
  /** 理解结果 */
  understanding: Understanding;
  /** 缺失的能力列表 */
  missingCapabilities: string[];
  /** 建议的技能列表 */
  suggestedSkills: string[];
  /** 置信度 (0-1) */
  confidence: number;
  /** 解决状态 */
  resolution: 'pending' | 'installing' | 'developing' | 'resolved' | 'rejected';
}

/** Agent状态 (第十四章) */
export interface AgentState {
  /** 会话ID */
  conversationId: string;
  /** 当前阶段 */
  currentPhase: 'thinking' | 'executing' | 'waiting' | 'completed';
  /** 思考过程 */
  thoughtProcess: ThoughtProcess;
  /** 已执行任务 */
  executedTasks: TaskResult[];
  /** 待执行任务 */
  pendingTasks: Task[];
  /** 创建时间 */
  createdAt: Date;
  /** 更新时间 */
  updatedAt: Date;
}

/** 成本配置 (第十三章) */
export interface CostConfig {
  /** 每日预算 (美元) */
  dailyBudget: number;
  /** 单任务预算 (美元) */
  perTaskBudget: number;
  /** 告警阈值 (百分比) */
  alertThreshold: number;
  /** 是否硬限制 */
  hardLimit: boolean;
}

/** 成本记录 */
export interface CostRecord {
  /** 记录ID */
  id: string;
  /** 提供商 */
  provider: string;
  /** 模型 */
  model: string;
  /** 输入Token数 */
  inputTokens: number;
  /** 输出Token数 */
  outputTokens: number;
  /** 总Token数 */
  totalTokens: number;
  /** 成本 (美元) */
  cost: number;
  /** 时间 */
  timestamp: Date;
  /** 会话ID */
  conversationId?: string;
}

// ═══════════════════════════════════════════════════════════════
// 技能市场相关类型 (第九章 9.3)
// ═══════════════════════════════════════════════════════════════

/** 技能搜索结果 */
export interface SkillSearchResult {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  downloads: number;
  rating: number;
  verified: boolean;
  versions: string[];
  author?: string;
  market?: string;
}

/** 技能详情 */
export interface SkillDetails extends SkillSearchResult {
  author: string;
  license: string;
  readme: string;
  dependencies: string[];
  permissions: string[];
}

/** 技能文件 */
export interface SkillFile {
  path: string;
  content: string;
}

/** 技能包 */
export interface SkillPackage {
  id: string;
  name: string;
  version: string;
  files: SkillFile[];
  signature: string;
}

/** 安装结果 */
export interface InstallResult {
  success: boolean;
  path?: string;
  message?: string;
  error?: string;
}
