/**
 * 流式事件类型定义
 * 
 * 用于 SSE 流式传输，支持思考过程展示
 */

// ═══════════════════════════════════════════════════════════════
// 流式事件类型
// ═══════════════════════════════════════════════════════════════

/** 流式事件类型 */
export type StreamEventType = 
  | 'thinking'      // 思考过程
  | 'tool_call'     // 工具调用
  | 'tool_result'   // 工具结果
  | 'content'       // 内容输出
  | 'session'       // 会话信息
  | 'done'          // 完成
  | 'error'         // 错误
  | 'strategy_adjust'; // 策略调整

/** 流式事件 */
export interface StreamEvent {
  type: StreamEventType;
  timestamp: number;
  data: StreamEventData;
}

// ═══════════════════════════════════════════════════════════════
// 各类型事件数据
// ═══════════════════════════════════════════════════════════════

/** 思考阶段 */
export type ThinkingStage = 
  | 'understand'    // 理解问题
  | 'matched'       // 规则匹配
  | 'decide'        // 决策中
  | 'tool_call'     // 调用工具
  | 'reply'         // 直接回复
  | 'ask_missing'   // 询问缺失信息
  | 'clarify'       // 澄清意图
  | 'unable'        // 没有能力
  | 'gap_check'     // 能力缺口检测
  | 'gap_detected'   // 检测到能力缺口
  | 'thought'       // 思考中
  | 'retry';        // 重试

/** 思考事件数据 */
export interface ThinkingEventData {
  stage: ThinkingStage;
  message: string;
  skill?: string;
  confidence?: number;
}

/** 工具调用事件数据 */
export interface ToolCallEventData {
  toolCallId?: string;
  tool: string;
  params?: Record<string, unknown>;
  reason?: string;
  success?: boolean;
  duration?: number;
}

/** 工具结果事件数据 */
export interface ToolResultEventData {
  toolCallId?: string;
  tool: string;
  success: boolean;
  result?: unknown;
  duration: number;
  error?: string;
  output?: unknown;
}

/** 内容事件数据 */
export interface ContentEventData {
  text: string;
  isDelta: boolean;
}

/** 完成事件数据 */
export interface DoneEventData {
  duration: number;
  tokens?: {
    input: number;
    output: number;
  };
}

/** 错误事件数据 */
export interface ErrorEventData {
  code: string;
  message: string;
}

/** 会话事件数据 */
export interface SessionEventData {
  sessionId: string;
}

/** 策略调整事件数据 */
export interface StrategyAdjustEventData {
  message: string;
}

/** 流式事件数据联合类型 */
export type StreamEventData = 
  | ThinkingEventData
  | ToolCallEventData
  | ToolResultEventData
  | ContentEventData
  | DoneEventData
  | ErrorEventData
  | SessionEventData
  | StrategyAdjustEventData;

// ═══════════════════════════════════════════════════════════════
// 决策类型（用于提示词构建）
// ═══════════════════════════════════════════════════════════════

/** 决策类型 */
export type DecisionType = 'simple' | 'complex' | 'followUp';

/** 决策动作类型 */
export type DecisionAction = 'reply' | 'tool_call' | 'ask_missing' | 'clarify_intent' | 'unable';

/** 决策结果（LLM输出解析） */
export interface ParsedDecision {
  action: DecisionAction;
  response?: string;
  tool?: string;
  params?: Record<string, unknown>;
  missing?: string[];
  question?: string;
  options?: string[];
  message?: string;
  alternatives?: string[];
  reason?: string;
  detail?: string;
  confidence: number;
}

/** 提示词构建选项 */
export interface PromptBuildOptions {
  decisionType: DecisionType;
  skills?: string[];
  contextSummary?: string;
}
