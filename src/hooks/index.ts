/**
 * 钩子系统 - 企业级扩展架构
 */

import { getLogger } from '../observability/logger';

const logger = getLogger('hooks');

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

export type HookName = 
  | 'before_model_resolve'
  | 'before_tool_call'
  | 'before_exec'
  | 'after_tool_call'
  | 'after_exec'
  | 'on_error'
  | 'on_context_overflow'
  | 'on_rate_limit'
  | 'on_auth_failure';

export interface HookContext {
  sessionId: string;
  sessionKey?: string;
  userId?: string;
  workspaceDir: string;
  timestamp: number;
  userInput?: string;
  toolName?: string;
  toolParams?: Record<string, unknown>;
  toolResult?: { success: boolean; output?: string; error?: string; duration?: number };
  command?: string;
  execResult?: { stdout: string; stderr: string; exitCode: number; duration?: number };
  provider?: string;
  model?: string;
  error?: Error;
  errorCategory?: string;
  metadata: Record<string, unknown>;
}

export interface HookResult {
  proceed: boolean;
  modifications?: {
    providerOverride?: string;
    modelOverride?: string;
    toolOverride?: string;
    paramsOverride?: Record<string, unknown>;
    commandOverride?: string;
    metadata?: Record<string, unknown>;
  };
  error?: string;
  requiresApproval?: boolean;
  approvalRequest?: ApprovalRequest;
  retryAfter?: number;
  retryWithProfile?: string;
}

export interface ApprovalRequest {
  id: string;
  type: 'exec' | 'tool' | 'file' | 'network';
  operation: string;
  risk: 'low' | 'medium' | 'high';
  message: string;
  timestamp: number;
}

export type HookHandler = (context: HookContext) => Promise<HookResult>;
export type HookPriority = 'highest' | 'high' | 'normal' | 'low' | 'lowest';

interface RegisteredHook {
  handler: HookHandler;
  priority: HookPriority;
  name: string;
  enabled: boolean;
}

// ═══════════════════════════════════════════════════════════════
// 钩子注册表
// ═══════════════════════════════════════════════════════════════

export class HookRegistry {
  private hooks: Map<HookName, RegisteredHook[]> = new Map();
  private globalContext: Record<string, unknown> = {};
  
  register(name: HookName, handler: HookHandler, options?: { priority?: HookPriority; handlerName?: string }): void {
    const priority = options?.priority || 'normal';
    const handlerName = options?.handlerName || handler.name || 'anonymous';
    
    if (!this.hooks.has(name)) this.hooks.set(name, []);
    
    const registered: RegisteredHook = { handler, priority, name: handlerName, enabled: true };
    const hooks = this.hooks.get(name)!;
    hooks.push(registered);
    hooks.sort((a, b) => this.getPriorityValue(b.priority) - this.getPriorityValue(a.priority));
    
    logger.debug(`注册钩子: ${name} -> ${handlerName}`);
  }
  
  unregister(name: HookName, handlerName?: string): boolean {
    const hooks = this.hooks.get(name);
    if (!hooks) return false;
    
    if (handlerName) {
      const index = hooks.findIndex(h => h.name === handlerName);
      if (index >= 0) { hooks.splice(index, 1); return true; }
      return false;
    }
    this.hooks.delete(name);
    return true;
  }
  
  setEnabled(name: HookName, handlerName: string, enabled: boolean): boolean {
    const hooks = this.hooks.get(name);
    if (!hooks) return false;
    const hook = hooks.find(h => h.name === handlerName);
    if (hook) { hook.enabled = enabled; return true; }
    return false;
  }
  
  hasHooks(name: HookName): boolean {
    const hooks = this.hooks.get(name);
    return !!hooks && hooks.some(h => h.enabled);
  }
  
  getHookCount(name: HookName): number {
    const hooks = this.hooks.get(name);
    return hooks ? hooks.filter(h => h.enabled).length : 0;
  }
  
  getHooks(name: HookName): RegisteredHook[] | undefined {
    return this.hooks.get(name);
  }
  
  setGlobalContext(key: string, value: unknown): void { this.globalContext[key] = value; }
  getGlobalContext(): Record<string, unknown> { return { ...this.globalContext }; }
  clear(): void { this.hooks.clear(); this.globalContext = {}; }
  
  private getPriorityValue(priority: HookPriority): number {
    const values: Record<HookPriority, number> = { highest: 100, high: 75, normal: 50, low: 25, lowest: 0 };
    return values[priority];
  }
}

// ═══════════════════════════════════════════════════════════════
// 钩子运行器
// ═══════════════════════════════════════════════════════════════

export class HookRunner {
  constructor(private registry: HookRegistry) {}
  
  async run(name: HookName, context: HookContext): Promise<HookResult> {
    const hooks = this.registry.getHooks(name);
    if (!hooks || hooks.length === 0) return { proceed: true };
    
    const fullContext: HookContext = {
      ...context,
      metadata: { ...this.registry.getGlobalContext(), ...context.metadata },
    };
    
    for (const hook of hooks) {
      if (!hook.enabled) continue;
      try {
        const result = await hook.handler(fullContext);
        if (!result.proceed) return result;
        if (result.modifications) this.applyModifications(fullContext, result.modifications);
      } catch (error) {
        logger.error(`钩子执行错误: ${hook.name} -> ${error}`);
      }
    }
    return { proceed: true };
  }
  
  private applyModifications(context: HookContext, mod: NonNullable<HookResult['modifications']>): void {
    if (mod.providerOverride) context.provider = mod.providerOverride;
    if (mod.modelOverride) context.model = mod.modelOverride;
    if (mod.toolOverride) context.toolName = mod.toolOverride;
    if (mod.paramsOverride) context.toolParams = { ...context.toolParams, ...mod.paramsOverride };
    if (mod.commandOverride) context.command = mod.commandOverride;
    if (mod.metadata) context.metadata = { ...context.metadata, ...mod.metadata };
  }
}

// ═══════════════════════════════════════════════════════════════
// 内置钩子
// ═══════════════════════════════════════════════════════════════

export const sensitiveOperationHook: HookHandler = async (context) => {
  const { toolName, toolParams, command } = context;
  
  if (command) {
    const patterns = [/rm\s+-rf/, /sudo\s+/, /chmod\s+777/, />\s*\/dev\/sd/, /mkfs/, /dd\s+if=/];
    for (const p of patterns) {
      if (p.test(command)) {
        return { proceed: true, requiresApproval: true, approvalRequest: {
          id: `approval-${Date.now()}`, type: 'exec', operation: command.slice(0, 50),
          risk: 'high', message: `敏感命令`, timestamp: Date.now()
        }};
      }
    }
  }
  return { proceed: true };
};

export const paramValidationHook: HookHandler = async (context) => {
  const { toolName, toolParams } = context;
  if (!toolName || !toolParams) return { proceed: true };
  
  const validations: Record<string, (p: Record<string, unknown>) => string | null> = {
    web_search: (p) => !p.query ? 'query 参数不能为空' : null,
    web_fetch: (p) => !p.url ? 'url 参数不能为空' : null,
    memory_set: (p) => !p.key ? 'key 参数不能为空' : null,
    exec: (p) => !p.command ? 'command 参数不能为空' : null,
  };
  
  const validator = validations[toolName];
  if (validator) {
    const error = validator(toolParams);
    if (error) return { proceed: false, error };
  }
  return { proceed: true };
};

export const ssrfProtectionHook: HookHandler = async (context) => {
  const { toolName, toolParams } = context;
  if (toolName === 'web_fetch' && toolParams?.url) {
    const url = toolParams.url as string;
    const blocked = [/localhost/i, /127\./, /10\./, /192\.168\./];
    for (const p of blocked) {
      if (p.test(url)) return { proceed: false, error: 'SSRF 防护: 不允许访问内部网络' };
    }
  }
  return { proceed: true };
};

// ═══════════════════════════════════════════════════════════════
// 全局实例
// ═══════════════════════════════════════════════════════════════

let globalRegistry: HookRegistry | null = null;
let globalRunner: HookRunner | null = null;

export function getHookRegistry(): HookRegistry {
  if (!globalRegistry) {
    globalRegistry = new HookRegistry();
    globalRegistry.register('before_tool_call', paramValidationHook, { priority: 'high', handlerName: 'param_validation' });
    globalRegistry.register('before_tool_call', ssrfProtectionHook, { priority: 'high', handlerName: 'ssrf_protection' });
    globalRegistry.register('before_tool_call', sensitiveOperationHook, { priority: 'normal', handlerName: 'sensitive_operation' });
  }
  return globalRegistry;
}

export function getHookRunner(): HookRunner {
  if (!globalRunner) globalRunner = new HookRunner(getHookRegistry());
  return globalRunner;
}

export function resetHooks(): void { globalRegistry = null; globalRunner = null; }

export function registerHook(name: HookName, handler: HookHandler, options?: { priority?: HookPriority; handlerName?: string }): void {
  getHookRegistry().register(name, handler, options);
}

export async function runHook(name: HookName, context: Partial<HookContext>): Promise<HookResult> {
  const fullContext: HookContext = {
    sessionId: context.sessionId || 'default',
    workspaceDir: context.workspaceDir || process.cwd(),
    timestamp: Date.now(),
    metadata: context.metadata || {},
    ...context,
  };
  return getHookRunner().run(name, fullContext);
}
