/**
 * 可观测层 - 日志与追踪
 * 
 * 支持：
 * 1. 结构化日志
 * 2. 请求追踪
 * 3. 调用链记录
 */
import winston from 'winston';
import { v4 as uuidv4 } from 'uuid';

/**
 * 追踪上下文
 */
export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  startTime: number;
  metadata: Record<string, unknown>;
}

/**
 * 追踪管理器
 */
export class TracingManager {
  private currentTrace: TraceContext | null = null;
  private spans: Map<string, TraceContext> = new Map();

  /**
   * 开始新追踪
   */
  startTrace(metadata: Record<string, unknown> = {}): string {
    const traceId = uuidv4();
    
    this.currentTrace = {
      traceId,
      spanId: uuidv4(),
      startTime: Date.now(),
      metadata,
    };
    
    this.spans.set(this.currentTrace.spanId, this.currentTrace);
    
    return traceId;
  }

  /**
   * 开始新Span
   */
  startSpan(name: string, metadata: Record<string, unknown> = {}): string {
    if (!this.currentTrace) {
      this.startTrace();
    }

    const spanId = uuidv4();
    const span: TraceContext = {
      traceId: this.currentTrace!.traceId,
      spanId,
      parentSpanId: this.currentTrace!.spanId,
      startTime: Date.now(),
      metadata: { name, ...metadata },
    };

    this.spans.set(spanId, span);
    this.currentTrace = span;
    
    return spanId;
  }

  /**
   * 结束Span
   */
  endSpan(spanId: string): void {
    const span = this.spans.get(spanId);
    if (span) {
      const duration = Date.now() - span.startTime;
      span.metadata.duration = duration;
    }
  }

  /**
   * 获取当前追踪ID
   */
  getCurrentTraceId(): string | undefined {
    return this.currentTrace?.traceId;
  }

  /**
   * 获取当前Span ID
   */
  getCurrentSpanId(): string | undefined {
    return this.currentTrace?.spanId;
  }

  /**
   * 获取追踪信息
   */
  getTraceInfo(): Record<string, unknown> {
    if (!this.currentTrace) {
      return {};
    }

    return {
      traceId: this.currentTrace.traceId,
      spanId: this.currentTrace.spanId,
      parentSpanId: this.currentTrace.parentSpanId,
    };
  }
}

// 全局追踪管理器
let tracingManager: TracingManager | null = null;

export function getTracingManager(): TracingManager {
  if (!tracingManager) {
    tracingManager = new TracingManager();
  }
  return tracingManager;
}

/**
 * 创建带追踪的日志格式
 */
export function createTracedFormat() {
  return winston.format.printf(({ level, message, timestamp, ...metadata }) => {
    const tracing = getTracingManager();
    const traceInfo = tracing.getTraceInfo();
    
    let metaStr = '';
    if (Object.keys(metadata).length > 0) {
      metaStr = ' ' + JSON.stringify(metadata);
    }
    
    let traceStr = '';
    if (traceInfo.traceId) {
      traceStr = `[${traceInfo.traceId}] `;
    }
    
    return `${timestamp} | ${level.toUpperCase()} | ${traceStr}${message}${metaStr}`;
  });
}
