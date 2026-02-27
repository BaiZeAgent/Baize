/**
 * 执行器 - 企业级版本
 * 
 * 核心逻辑：
 * 1. 钩子预处理
 * 2. 策略验证
 * 3. 审批流程
 * 4. 沙箱执行
 * 5. 错误恢复
 */

import * as path from 'path';
import * as fs from 'fs';
import { getSkillRegistry } from '../skills/registry';
import { getToolRegistry } from '../tools';
import { getLLMManager } from '../llm';
import { getLogger } from '../observability/logger';
import { LLMMessage, SkillContext } from '../types';
import { runHook, HookContext } from '../hooks';
import { checkToolPolicy, PolicyResult, DEFAULT_POLICY_CONFIG } from '../policy';
import { getApprovalManager, detectSensitiveOperation, ApprovalResult } from '../approval';
import { getSandboxManager, execInSandbox, ExecResult, SandboxConfig } from '../sandbox';
import { getProcessManager, exec, ProcessResult } from '../process';
import { classifyError, withRetry } from '../recovery';

const logger = getLogger('executor');

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

/**
 * 执行结果
 */
export interface ExecutionResult {
  success: boolean;
  output?: string;
  error?: string;
  duration: number;
  sandboxed?: boolean;
  approved?: boolean;
  retries?: number;
}

/**
 * 执行选项
 */
export interface ExecutionOptions {
  // 是否使用沙箱
  sandbox?: boolean;
  // 沙箱配置
  sandboxConfig?: Partial<SandboxConfig>;
  // 超时
  timeout?: number;
  // 是否需要审批
  requireApproval?: boolean;
  // 重试次数
  maxRetries?: number;
  // 会话信息
  sessionId?: string;
  userId?: string;
  workspaceDir?: string;
}

/**
 * 执行上下文
 */
export interface ExecutionContext {
  sessionId: string;
  userId?: string;
  workspaceDir: string;
  sandboxed: boolean;
  approvalRequired: boolean;
}

// ═══════════════════════════════════════════════════════════════
// 执行器
// ═══════════════════════════════════════════════════════════════

/**
 * 企业级执行器
 */
export class Executor {
  private llm = getLLMManager();
  private skillRegistry = getSkillRegistry();
  private toolRegistry = getToolRegistry();
  
  /**
   * 执行技能或工具
   */
  async executeSkill(
    name: string,
    params: Record<string, unknown>,
    context?: SkillContext,
    options?: ExecutionOptions
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const sessionId = options?.sessionId || 'default' || 'default';
    const workspaceDir = options?.workspaceDir || process.cwd();
    
    // 1. 运行前置钩子
    const hookResult = await runHook('before_tool_call', {
      sessionId,
      userId: options?.userId,
      workspaceDir,
      toolName: name,
      toolParams: params,
      metadata: {},
    });
    
    if (!hookResult.proceed) {
      return {
        success: false,
        error: hookResult.error || '请求被钩子拦截',
        duration: Date.now() - startTime,
      };
    }
    
    // 应用钩子修改
    if (hookResult.modifications?.toolOverride) {
      name = hookResult.modifications.toolOverride;
    }
    if (hookResult.modifications?.paramsOverride) {
      params = { ...params, ...hookResult.modifications.paramsOverride };
    }
    
    // 2. 策略检查
    const policyResult = await checkToolPolicy(name, params, DEFAULT_POLICY_CONFIG);
    
    if (!policyResult.allowed) {
      return {
        success: false,
        error: `策略阻止: ${policyResult.reason}`,
        duration: Date.now() - startTime,
      };
    }
    
    // 3. 审批流程
    if (policyResult.requiresApproval || options?.requireApproval) {
      const approvalResult = await this.handleApproval(name, params, policyResult);
      
      if (approvalResult.status !== 'approved') {
        return {
          success: false,
          error: approvalResult.status === 'denied' 
            ? '用户拒绝操作' 
            : '审批超时',
          duration: Date.now() - startTime,
          approved: false,
        };
      }
    }
    
    // 4. 执行
    let result: ExecutionResult;
    
    try {
      // 检查是否使用沙箱
      const useSandbox = options?.sandbox !== false && this.shouldUseSandbox(name, params);
      
      if (useSandbox) {
        result = await this.executeInSandbox(name, params, context, options);
        result.sandboxed = true;
      } else {
        result = await this.executeDirect(name, params, context, options);
      }
      
      // 5. 运行后置钩子
      await runHook('after_tool_call', {
        sessionId,
        workspaceDir,
        toolName: name,
        toolParams: params,
        toolResult: {
          success: result.success,
          output: result.output,
          error: result.error,
          duration: result.duration,
        },
        metadata: {},
      });
      
    } catch (error) {
      const classified = classifyError(error as Error);
      
      // 6. 错误恢复
      if (classified.retryable && options?.maxRetries) {
        result = await this.executeWithRetry(name, params, context, options);
      } else {
        result = {
          success: false,
          error: (error as Error).message,
          duration: Date.now() - startTime,
        };
      }
    }
    
    return result;
  }
  
  /**
   * 处理审批
   */
  private async handleApproval(
    name: string,
    params: Record<string, unknown>,
    policyResult: PolicyResult
  ): Promise<ApprovalResult> {
    const approvalManager = getApprovalManager();
    
    const approvalRequest = policyResult.approvalRequest || {
      type: 'tool' as const,
      operation: `${name}: ${JSON.stringify(params).slice(0, 100)}`,
      risk: 'medium' as const,
      message: `需要审批: ${name}`,
    };
    
    return approvalManager.requestApproval(approvalRequest);
  }
  
  /**
   * 判断是否应该使用沙箱
   */
  private shouldUseSandbox(name: string, params: Record<string, unknown>): boolean {
    // exec 工具总是使用沙箱
    if (name === 'exec') return true;
    
    // 检查是否有敏感操作
    if (name === 'exec' && params.command) {
      const detected = detectSensitiveOperation(params.command as string);
      if (detected && detected.risk !== 'low') {
        return true;
      }
    }
    
    // 检查是否有文件写入
    if (['file_write', 'file_delete'].includes(name)) {
      return true;
    }
    
    return false;
  }
  
  /**
   * 在沙箱中执行
   */
  private async executeInSandbox(
    name: string,
    params: Record<string, unknown>,
    context?: SkillContext,
    options?: ExecutionOptions
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    const workspaceDir = options?.workspaceDir || process.cwd();
    
    // 如果是 exec 工具
    if (name === 'exec' && params.command) {
      const command = params.command as string;
      const timeout = (params.timeout as number) || options?.timeout || 30000;
      
      try {
        const result = await execInSandbox(command, {
          timeout,
          cwd: params.cwd as string || workspaceDir,
          env: params.env as Record<string, string>,
          mounts: [{
            host: workspaceDir,
            container: '/workspace',
            mode: 'rw',
          }],
        });
        
        return {
          success: result.exitCode === 0,
          output: result.stdout || result.stderr,
          error: result.exitCode !== 0 ? result.stderr : undefined,
          duration: result.duration,
          sandboxed: true,
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
          duration: Date.now() - startTime,
          sandboxed: true,
        };
      }
    }
    
    // 其他工具，降级到直接执行
    return this.executeDirect(name, params, context, options);
  }
  
  /**
   * 直接执行（无沙箱）
   */
  private async executeDirect(
    name: string,
    params: Record<string, unknown>,
    context?: SkillContext,
    options?: ExecutionOptions
  ): Promise<ExecutionResult> {
    const startTime = Date.now();
    
    // 1. 检查内置工具
    if (this.toolRegistry.has(name)) {
      logger.info(`[execute-tool] name=${name}`);
      const result = await this.toolRegistry.execute(name, params, context);
      return {
        success: result.success,
        output: result.data ? JSON.stringify(result.data, null, 2) : undefined,
        error: result.error,
        duration: result.duration,
      };
    }
    
    // 2. 检查技能
    const skill = this.skillRegistry.get(name);
    if (!skill) {
      return {
        success: false,
        error: `技能或工具不存在: ${name}`,
        duration: 0,
      };
    }
    
    logger.info(`[execute] skill=${name}`);
    
    try {
      const skillPath = (skill as any).definition?.skillPath || 
                        (skill as any).path || 
                        path.join(process.cwd(), 'skills', name);
      
      const mainJsPath = path.join(skillPath, 'main.js');
      const mainPyPath = path.join(skillPath, 'main.py');
      
      if (fs.existsSync(mainJsPath)) {
        return await this.executeNodeSkill(mainJsPath, params, startTime, options);
      } else if (fs.existsSync(mainPyPath)) {
        return await this.executePythonSkill(mainPyPath, params, startTime, options);
      } else {
        const result = await skill.run(params, context || {});
        return {
          success: result.success,
          output: result.message || result.error,
          error: result.error,
          duration: Date.now() - startTime,
        };
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }
  
  /**
   * 执行 Node.js 技能
   */
  private async executeNodeSkill(
    scriptPath: string,
    params: Record<string, unknown>,
    startTime: number,
    options?: ExecutionOptions
  ): Promise<ExecutionResult> {
    const paramsJson = JSON.stringify({ params });
    const timeout = options?.timeout || 30000;
    
    try {
      const result = await exec(`node "${scriptPath}"`, {
        timeout,
        env: {
          ...process.env,
          BAIZE_PARAMS: paramsJson,
        },
      });
      
      // 解析输出
      try {
        const parsed = JSON.parse(result.stdout);
        return {
          success: parsed.success !== false,
          output: parsed.message || JSON.stringify(parsed.data || parsed, null, 2),
          error: parsed.error,
          duration: Date.now() - startTime,
        };
      } catch {
        return {
          success: result.exitCode === 0,
          output: result.stdout || result.stderr,
          error: result.exitCode !== 0 ? result.stderr : undefined,
          duration: result.duration,
        };
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }
  
  /**
   * 执行 Python 技能
   */
  private async executePythonSkill(
    scriptPath: string,
    params: Record<string, unknown>,
    startTime: number,
    options?: ExecutionOptions
  ): Promise<ExecutionResult> {
    const paramsJson = JSON.stringify({ params });
    const timeout = options?.timeout || 30000;
    
    try {
      const result = await exec(`python3 "${scriptPath}"`, {
        timeout,
        env: {
          ...process.env,
          BAIZE_PARAMS: paramsJson,
        },
      });
      
      try {
        const parsed = JSON.parse(result.stdout);
        return {
          success: parsed.success !== false,
          output: parsed.message || JSON.stringify(parsed.data || parsed, null, 2),
          error: parsed.error,
          duration: Date.now() - startTime,
        };
      } catch {
        return {
          success: result.exitCode === 0,
          output: result.stdout || result.stderr,
          error: result.exitCode !== 0 ? result.stderr : undefined,
          duration: result.duration,
        };
      }
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        duration: Date.now() - startTime,
      };
    }
  }
  
  /**
   * 带重试执行
   */
  private async executeWithRetry(
    name: string,
    params: Record<string, unknown>,
    context?: SkillContext,
    options?: ExecutionOptions
  ): Promise<ExecutionResult> {
    const maxRetries = options?.maxRetries || 3;
    let lastResult: ExecutionResult | null = null;
    
    for (let i = 0; i < maxRetries; i++) {
      lastResult = await this.executeDirect(name, params, context, options);
      
      if (lastResult.success) {
        lastResult.retries = i;
        return lastResult;
      }
      
      // 等待后重试
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
    
    return {
      ...lastResult!,
      retries: maxRetries,
    };
  }
  
  /**
   * 获取所有可用的工具和技能
   */
  getAvailableTools(): string[] {
    const tools = this.toolRegistry.getAll().map(t => t.name);
    const skills = this.skillRegistry.getAll().map(s => s.name);
    return [...tools, ...skills];
  }
  
  /**
   * 获取工具定义
   */
  getToolDefinitions(): Array<{ name: string; description: string; parameters: any }> {
    const tools = this.toolRegistry.getAll().map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
    
    const skills = this.skillRegistry.getAll().map(s => ({
      name: s.name,
      description: s.description,
      parameters: {
        type: 'object',
        properties: {},
        description: '动态参数',
      },
    }));
    
    return [...tools, ...skills];
  }
}

// ═══════════════════════════════════════════════════════════════
// 全局实例
// ═══════════════════════════════════════════════════════════════

let executorInstance: Executor | null = null;

export function getExecutor(): Executor {
  if (!executorInstance) {
    executorInstance = new Executor();
  }
  return executorInstance;
}

export function resetExecutor(): void {
  executorInstance = null;
}

// 导出 ReAct 执行器
export {
  ReActExecutorV2,
  getReActExecutorV2,
  resetReActExecutorV2,
} from './react-executor-v2';
