/**
 * 统一执行器类型定义
 * 
 * 包含L1-L4层的所有类型：
 * - L1 失败诊断
 * - L2 经验驱动
 * - L3 目标定义
 * - L4 结果验证
 */

// ═══════════════════════════════════════════════════════════════
// 基础类型
// ═══════════════════════════════════════════════════════════════

/** 任务复杂度 */
export type ComplexityLevel = 'simple' | 'moderate' | 'complex' | 'very_complex';

/** 执行策略类型 */
export type StrategyType = 
  | 'direct'              // 直接执行
  | 'experience_based'    // 经验驱动
  | 'perception_loop'     // 感知循环
  | 'multi_agent'         // 多智能体
  | 'human_collaboration';// 人机协同

/** 执行结果状态 */
export type ExecutionStatus = 'success' | 'failure' | 'partial' | 'timeout';

/** 失败原因类型 */
export type FailureCauseType = 
  | 'wrong_tool'          // 工具选择错误
  | 'wrong_params'        // 参数错误
  | 'tool_limitation'     // 工具能力限制
  | 'intent_misunderstood'// 意图理解错误
  | 'environment_issue'   // 环境问题
  | 'timeout'             // 超时
  | 'unknown';            // 未知原因

// ═══════════════════════════════════════════════════════════════
// L3 目标定义类型
// ═══════════════════════════════════════════════════════════════

/** 成功标准 */
export interface SuccessCriterion {
  id: string;
  description: string;
  priority: 'required' | 'preferred' | 'optional';
  verificationMethod: 'automatic' | 'llm_check' | 'user_confirm';
}

/** 目标定义 */
export interface GoalDefinition {
  /** 原始用户输入 */
  userInput: string;
  /** 理解的意图 */
  intent: string;
  /** 深层目标 */
  deepGoal: string;
  /** 成功标准列表 */
  successCriteria: SuccessCriterion[];
  /** 预期输出描述 */
  expectedOutput?: string;
  /** 风险评估 */
  risks: string[];
  /** 置信度 */
  confidence: number;
}

// ═══════════════════════════════════════════════════════════════
// L1 失败诊断类型
// ═══════════════════════════════════════════════════════════════

/** 失败诊断结果 */
export interface FailureDiagnosis {
  /** 根本原因 */
  rootCause: string;
  /** 失败类型 */
  causeType: FailureCauseType;
  /** 详细分析 */
  analysis: string;
  /** 修正建议 */
  suggestedFix: string;
  /** 修正后的方案 */
  correctedPlan?: CorrectedPlan;
  /** 是否可修正 */
  canFix: boolean;
  /** 诊断置信度 */
  confidence: number;
}

/** 修正后的方案 */
export interface CorrectedPlan {
  tool: string;
  params: Record<string, unknown>;
  reason: string;
}

/** 失败模式 */
export interface FailurePattern {
  id: string;
  pattern: string;
  causeType: FailureCauseType;
  occurrences: number;
  lastOccurrence: number;
  suggestedAvoidance: string;
}

// ═══════════════════════════════════════════════════════════════
// L2 经验驱动类型
// ═══════════════════════════════════════════════════════════════

/** 执行经验 */
export interface ExecutionExperience {
  id: string;
  /** 用户输入 */
  userInput: string;
  /** 意图 */
  intent: string;
  /** 向量表示 */
  embedding?: number[];
  /** 使用的工具 */
  tool: string;
  /** 参数 */
  params: Record<string, unknown>;
  /** 执行结果 */
  result: ExecutionStatus;
  /** 输出 */
  output?: string;
  /** 错误信息 */
  error?: string;
  /** 成功标准 */
  successCriteria?: SuccessCriterion[];
  /** 验证结果 */
  validationResults?: ValidationResult[];
  /** 失败诊断 */
  diagnosis?: FailureDiagnosis;
  /** 执行时长(ms) */
  duration: number;
  /** 时间戳 */
  timestamp: number;
  /** 会话ID */
  sessionId: string;
  /** 是否已验证 */
  verified: boolean;
  /** 置信度 */
  confidence: number;
}

/** 经验查询选项 */
export interface ExperienceQueryOptions {
  limit?: number;
  minSimilarity?: number;
  resultFilter?: ExecutionStatus;
  toolFilter?: string;
  timeRange?: { start: number; end: number };
}

/** 经验匹配结果 */
export interface ExperienceMatch {
  experience: ExecutionExperience;
  similarity: number;
  relevanceReason: string;
}

// ═══════════════════════════════════════════════════════════════
// L4 结果验证类型
// ═══════════════════════════════════════════════════════════════

/** 验证结果 */
export interface ValidationResult {
  criterionId: string;
  criterionDescription: string;
  passed: boolean;
  evidence: string;
  confidence: number;
}

/** 整体验证结果 */
export interface OverallValidation {
  passed: boolean;
  results: ValidationResult[];
  summary: string;
  score: number; // 0-1
}

// ═══════════════════════════════════════════════════════════════
// 执行计划类型
// ═══════════════════════════════════════════════════════════════

/** 执行计划 */
export interface ExecutionPlan {
  id: string;
  tool: string;
  params: Record<string, unknown>;
  reasoning: string;
  expectedOutput?: string;
  risks: string[];
  alternatives?: string[];
  basedOnExperience?: string; // 基于哪个经验
}

/** 执行上下文 */
export interface ExecutionContext {
  sessionId: string;
  userId?: string;
  conversationId?: string;
  workspaceDir?: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  variables?: Record<string, unknown>;
}

/** 执行输出 */
export interface ExecutionOutput {
  success: boolean;
  tool: string;
  params: Record<string, unknown>;
  output?: string;
  error?: string;
  data?: Record<string, unknown>;
  duration: number;
}

// ═══════════════════════════════════════════════════════════════
// 任务分析类型
// ═══════════════════════════════════════════════════════════════

/** 任务特征 */
export interface TaskFeatures {
  requiresMultipleSteps: boolean;
  involvesExternalSystem: boolean;
  requiresObservation: boolean;
  hasTimeDependency: boolean;
  hasConditionalBranches: boolean;
  requiresPrecision: boolean;
  involvesBrowser: boolean;
  involvesFileSystem: boolean;
  involvesNetwork: boolean;
}

/** 任务分析结果 */
export interface TaskAnalysis {
  userInput: string;
  features: TaskFeatures;
  complexity: ComplexityLevel;
  taskType: string;
  successCriteria: SuccessCriterion[];
  similarExperiences: ExperienceMatch[];
  riskLevel: 'low' | 'medium' | 'high';
}

// ═══════════════════════════════════════════════════════════════
// 执行策略类型
// ═══════════════════════════════════════════════════════════════

/** 执行策略 */
export interface ExecutionStrategy {
  type: StrategyType;
  config?: Record<string, unknown>;
  experience?: ExecutionExperience;
  reason: string;
}

// ═══════════════════════════════════════════════════════════════
// 完整执行结果类型
// ═══════════════════════════════════════════════════════════════

/** 完整执行结果 */
export interface FullExecutionResult {
  success: boolean;
  userInput: string;
  analysis: TaskAnalysis;
  strategy: ExecutionStrategy;
  plan: ExecutionPlan;
  output: ExecutionOutput;
  validation: OverallValidation;
  diagnosis?: FailureDiagnosis;
  attempts: number;
  totalDuration: number;
  experienceRecorded: boolean;
  timestamp: number;
}

/** 执行统计 */
export interface ExecutionStats {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  averageDuration: number;
  successRate: number;
  topTools: Array<{ tool: string; count: number; successRate: number }>;
  topFailures: Array<{ cause: string; count: number }>;
}
