# 白泽 vs OpenClaw 理解与执行能力深度对比

## 📊 核心指标对比

| 能力维度 | 白泽 | OpenClaw | 差距分析 |
|----------|------|----------|----------|
| **意图理解** | 基础 LLM 路由 | 多层意图解析 + 上下文感知 | OpenClaw 更精细 |
| **工具选择** | 单次 LLM 决策 | 工具策略 + 策略管道 | OpenClaw 更可靠 |
| **错误恢复** | 能力缺口检测 | 多层 Failover + 自动重试 | OpenClaw 更健壮 |
| **上下文管理** | 简单历史记录 | 会话压缩 + 溢出处理 | OpenClaw 更智能 |
| **执行可靠性** | 基础执行 | 沙箱 + 权限 + 审批 | OpenClaw 更安全 |

---

## 🧠 理解能力对比

### 1. 意图识别

#### 白泽的实现 (`src/core/router/index.ts`)

```typescript
class SmartRouter {
  async route(context: RouteContext): Promise<RouteDecision> {
    // 1. 简单问候直接回复
    const greetings = ['你好', '您好', 'hi', 'hello'];
    if (isOnlyGreeting) {
      return { action: 'reply', content: '你好！' };
    }
    
    // 2. 让 LLM 判断
    return this.llmRoute(userInput, history);
  }
  
  private async llmRoute(userInput, history) {
    const messages = [
      { role: 'system', content: `你是白泽的路由器。
## 可用工具
${toolsDesc}
## 返回格式
{"action": "reply|tool|plan", ...}` },
      { role: 'user', content: userInput }
    ];
    
    const response = await this.llm.chat(messages, { temperature: 0.1 });
    return JSON.parse(response.content);
  }
}
```

**特点**:
- ✅ 简单直接
- ✅ 单次 LLM 调用
- ❌ 无多轮澄清
- ❌ 无意图置信度
- ❌ 无上下文感知

#### OpenClaw的实现 (`src/agents/system-prompt.ts` + `pi-embedded-runner`)

```typescript
// 系统提示包含丰富的上下文
function buildAgentSystemPrompt(params) {
  const lines = [
    "You are a personal assistant running inside OpenClaw.",
    "",
    "## Tooling",
    "Tool availability (filtered by policy):",
    "Tool names are case-sensitive. Call tools exactly as listed.",
    toolLines.join("\n"),
    "",
    "## Safety",
    "You have no independent goals: do not pursue self-preservation...",
    "",
    "## Skills (mandatory)",
    "Before replying: scan <available_skills> <description> entries.",
    "",
    "## Memory Recall",
    "Before answering anything about prior work: run memory_search...",
    "",
    "## Workspace",
    `Your working directory is: ${displayWorkspaceDir}`,
    "",
    "## Runtime",
    buildRuntimeLine(runtimeInfo),
  ];
  return lines.join("\n");
}

// 运行时包含多层处理
async function runEmbeddedPiAgent(params) {
  // 1. 钩子预处理
  if (hookRunner?.hasHooks("before_model_resolve")) {
    modelResolveOverride = await hookRunner.runBeforeModelResolve(...);
  }
  
  // 2. 上下文窗口检查
  const ctxGuard = evaluateContextWindowGuard({...});
  
  // 3. 认证配置解析
  const profileOrder = resolveAuthProfileOrder({...});
  
  // 4. 执行尝试（带重试）
  while (true) {
    const attempt = await runEmbeddedAttempt({...});
    
    // 5. 错误分类和处理
    if (contextOverflowError) {
      // 自动压缩
      await compactEmbeddedPiSessionDirect({...});
      continue;
    }
    
    // 6. Failover 处理
    if (authFailure || rateLimitFailure) {
      await advanceAuthProfile();
      continue;
    }
  }
}
```

**特点**:
- ✅ 丰富的系统提示
- ✅ 多层上下文注入
- ✅ 钩子预处理
- ✅ 自动错误恢复
- ✅ 多 Profile Failover
- ✅ 上下文溢出处理

---

### 2. 工具选择策略

#### 白泽的工具选择

```typescript
// 单次 LLM 决策
const messages = [{
  role: 'system',
  content: `## 可用工具
- web_search: 搜索互联网
- memory_search: 搜索记忆
- file: 文件操作
...

## 返回格式
{"action": "tool", "toolName": "xxx", "toolParams": {}}`
}];

// 直接解析结果
const parsed = JSON.parse(response.content);
if (parsed.action === 'tool') {
  return { toolName: parsed.toolName, toolParams: parsed.toolParams };
}
```

**问题**:
- ❌ LLM 可能选择不存在的工具
- ❌ 参数可能不完整
- ❌ 无工具策略过滤

#### OpenClaw的工具选择

```typescript
// 1. 工具策略管道
class ToolPolicyPipeline {
  async apply(toolCall: ToolCall): Promise<PolicyResult> {
    // 检查工具是否允许
    if (!this.isToolAllowed(toolCall.name)) {
      return { allowed: false, reason: "Tool not in allowlist" };
    }
    
    // 检查参数是否有效
    const schema = this.getToolSchema(toolCall.name);
    const validation = validateParams(toolCall.params, schema);
    if (!validation.valid) {
      return { allowed: false, reason: validation.errors };
    }
    
    return { allowed: true };
  }
}

// 2. 工具调用前钩子
async function beforeToolCall(toolCall) {
  // 敏感操作审批
  if (toolCall.name === 'exec' && isSensitiveCommand(toolCall.params.command)) {
    const approval = await requestApproval(toolCall);
    if (!approval.granted) {
      throw new Error("User denied the operation");
    }
  }
  
  // 参数修正
  if (toolCall.name === 'web_fetch') {
    toolCall.params.url = normalizeUrl(toolCall.params.url);
  }
  
  return toolCall;
}

// 3. 工具调用后处理
async function afterToolCall(toolCall, result) {
  // 结果截断
  if (result.output.length > MAX_OUTPUT_SIZE) {
    result.output = truncateOutput(result.output);
  }
  
  // 敏感信息过滤
  result.output = filterSecrets(result.output);
  
  return result;
}
```

**优势**:
- ✅ 策略管道验证
- ✅ 敏感操作审批
- ✅ 参数自动修正
- ✅ 结果过滤

---

## ⚡ 执行能力对比

### 1. 命令执行

#### 白泽的执行器

```typescript
class Executor {
  async executeSkill(name: string, params: Record<string, unknown>) {
    // 1. 检查内置工具
    if (this.toolRegistry.has(name)) {
      return await this.toolRegistry.execute(name, params);
    }
    
    // 2. 检查技能
    const skill = this.skillRegistry.get(name);
    
    // 3. 执行
    if (fs.existsSync(mainJsPath)) {
      return await this.executeNodeSkill(mainJsPath, params);
    }
    
    // 4. 文档型技能 - 让 LLM 生成命令
    const command = await this.selectCommand(documentation, params);
    const { stdout } = await execAsync(command);
    return { success: true, output: stdout };
  }
  
  private async executeNodeSkill(scriptPath, params) {
    const paramsJson = JSON.stringify({ params });
    const { stdout } = await execAsync(`node "${scriptPath}"`, {
      env: { ...process.env, BAIZE_PARAMS: paramsJson },
    });
    return { success: true, output: stdout };
  }
}
```

**问题**:
- ❌ 无沙箱隔离
- ❌ 无权限控制
- ❌ 无超时管理
- ❌ 无进程监控

#### OpenClaw的执行器

```typescript
// 多层执行架构
class BashProcessRegistry {
  // 1. 主机网关执行
  async execHostGateway(params: ExecParams): Promise<ExecResult> {
    // 通过网关安全执行
    return await this.gatewayClient.exec(params);
  }
  
  // 2. 主机 Node 执行
  async execHostNode(params: ExecParams): Promise<ExecResult> {
    // 在主机 Node 环境执行
    return await this.hostNode.exec(params);
  }
  
  // 3. 运行时执行
  async execRuntime(params: ExecParams): Promise<ExecResult> {
    // 在沙箱运行时执行
    return await this.runtime.exec(params);
  }
}

// 进程管理
class ProcessSupervisor {
  async spawn(command: string, options: SpawnOptions): Promise<Process> {
    // PTY 终端支持
    const pty = spawn(command, [], {
      cols: options.cols || 80,
      rows: options.rows || 24,
      cwd: options.cwd,
      env: options.env,
    });
    
    // 进程注册
    this.processes.set(pty.pid, {
      process: pty,
      startTime: Date.now(),
      timeout: options.timeout,
    });
    
    // 超时监控
    if (options.timeout) {
      setTimeout(() => this.kill(pty.pid), options.timeout);
    }
    
    return pty;
  }
  
  async sendKeys(pid: number, keys: string): Promise<void> {
    const proc = this.processes.get(pid);
    if (proc && proc.process.stdin.writable) {
      proc.process.stdin.write(keys);
    }
  }
  
  async poll(pid: number, timeout: number): Promise<ProcessStatus> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve({ status: 'timeout' });
      }, timeout);
      
      this.processes.get(pid)?.process.on('exit', (code) => {
        clearTimeout(timer);
        resolve({ status: 'exited', code });
      });
    });
  }
}

// 权限审批
class ExecApprovalRequest {
  async requestApproval(command: string): Promise<ApprovalResult> {
    // 生成审批 ID
    const approvalId = generateApprovalId();
    
    // 发送审批请求
    await this.sendApprovalRequest({
      id: approvalId,
      command,
      timestamp: Date.now(),
    });
    
    // 等待用户响应
    return await this.waitForResponse(approvalId, {
      timeout: APPROVAL_TIMEOUT,
    });
  }
}

// 沙箱隔离
class SandboxManager {
  async createSandbox(options: SandboxOptions): Promise<Sandbox> {
    // Docker 容器创建
    const container = await this.docker.createContainer({
      Image: options.image || 'openclaw/sandbox:latest',
      Cmd: ['/bin/bash'],
      HostConfig: {
        Memory: options.memoryLimit || 512 * 1024 * 1024,
        CpuQuota: options.cpuQuota || 50000,
        Binds: [
          `${options.workspaceDir}:/workspace:rw`,
        ],
        SecurityOpt: ['no-new-privileges'],
      },
    });
    
    await container.start();
    
    return {
      id: container.id,
      exec: async (command) => {
        const exec = await container.exec({
          Cmd: ['bash', '-c', command],
          AttachStdout: true,
          AttachStderr: true,
        });
        return await exec.start();
      },
    };
  }
}
```

**优势**:
- ✅ Docker 沙箱隔离
- ✅ 资源限制
- ✅ PTY 终端支持
- ✅ 进程生命周期管理
- ✅ 权限审批流程
- ✅ 超时控制

---

### 2. 错误恢复

#### 白泽的错误恢复

```typescript
class Brain {
  async *handleCapabilityGap(userInput: string) {
    // 检测能力缺口
    const gap = await this.gapDetector.detect(userInput, skills);
    
    if (gap) {
      // 生成提示
      const response = this.gapDetector.generatePrompt(gap);
      yield* this.streamContent(response);
    } else {
      yield* this.streamContent('抱歉，我暂时没有相关能力。');
    }
  }
}
```

**问题**:
- ❌ 无自动重试
- ❌ 无 Failover
- ❌ 无错误分类

#### OpenClaw的错误恢复

```typescript
async function runEmbeddedPiAgent(params) {
  // 多层重试循环
  while (true) {
    runLoopIterations++;
    
    try {
      const attempt = await runEmbeddedAttempt({...});
      
      // 1. 上下文溢出处理
      if (contextOverflowError) {
        // 自动压缩
        const compactResult = await compactEmbeddedPiSessionDirect({
          trigger: "overflow",
        });
        if (compactResult.compacted) {
          continue; // 重试
        }
        
        // 工具结果截断
        if (hasOversizedToolResults) {
          await truncateOversizedToolResultsInSession({...});
          continue;
        }
      }
      
      // 2. 认证失败处理
      if (authFailure) {
        await markAuthProfileFailure({
          profileId: lastProfileId,
          reason: "auth",
        });
        
        // 切换到下一个 Profile
        if (await advanceAuthProfile()) {
          continue;
        }
      }
      
      // 3. 速率限制处理
      if (rateLimitFailure) {
        await markAuthProfileFailure({
          profileId: lastProfileId,
          reason: "rate_limit",
        });
        
        if (await advanceAuthProfile()) {
          continue;
        }
      }
      
      // 4. 计费错误处理
      if (billingFailure) {
        const formattedError = formatBillingErrorMessage(lastAssistant);
        return {
          payloads: [{ text: formattedError, isError: true }],
        };
      }
      
      // 5. 超时处理
      if (timedOut) {
        if (timedOutDuringCompaction) {
          // 压缩超时，直接返回
          return {
            payloads: [{ 
              text: "Session compaction timed out. Please try /new.", 
              isError: true 
            }],
          };
        }
        // 普通超时，重试
        continue;
      }
      
      // 成功返回
      return attempt;
      
    } catch (error) {
      // 6. Failover 错误
      if (error instanceof FailoverError) {
        if (fallbackConfigured) {
          // 尝试模型回退
          throw error; // 让上层处理
        }
      }
      throw error;
    }
    
    // 7. 重试限制
    if (runLoopIterations >= MAX_RUN_LOOP_ITERATIONS) {
      return {
        payloads: [{
          text: "Request failed after repeated internal retries.",
          isError: true,
        }],
      };
    }
  }
}
```

**优势**:
- ✅ 上下文溢出自动压缩
- ✅ 多 Profile Failover
- ✅ 速率限制自动切换
- ✅ 超时自动重试
- ✅ 错误分类处理
- ✅ 重试次数限制

---

### 3. 上下文管理

#### 白泽的上下文管理

```typescript
class Brain {
  private history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  
  async *processStream(userInput: string) {
    // 添加到历史
    this.history.push({ role: 'user', content: userInput });
    
    // 限制历史长度
    if (this.history.length > 20) {
      this.history = this.history.slice(-20);
    }
    
    // 记录到情景记忆
    this.memory.recordEpisode('conversation', `用户: ${userInput}`);
  }
}
```

**问题**:
- ❌ 无智能压缩
- ❌ 无 Token 计数
- ❌ 无溢出处理

#### OpenClaw的上下文管理

```typescript
// 上下文窗口监控
function resolveContextWindowInfo(params) {
  const ctxInfo = {
    tokens: params.modelContextWindow || 200000,
    source: 'model',
  };
  
  // 检查是否需要警告
  if (ctxInfo.tokens < CONTEXT_WINDOW_WARN_BELOW_TOKENS) {
    log.warn(`Low context window: ${ctxInfo.tokens}`);
  }
  
  return ctxInfo;
}

// 自动压缩
async function compactEmbeddedPiSessionDirect(params) {
  // 读取会话文件
  const session = await readSessionFile(params.sessionFile);
  
  // 计算当前 Token 数
  const currentTokens = estimateTokens(session.messages);
  
  // 如果超过阈值，压缩
  if (currentTokens > params.threshold) {
    // 选择压缩策略
    const strategy = selectCompactionStrategy(session);
    
    // 执行压缩
    const compacted = await executeCompaction(session, strategy);
    
    // 写回会话文件
    await writeSessionFile(params.sessionFile, compacted);
    
    return { compacted: true, tokensSaved: currentTokens - estimateTokens(compacted.messages) };
  }
  
  return { compacted: false };
}

// 工具结果截断
async function truncateOversizedToolResultsInSession(params) {
  const messages = await readSessionMessages(params.sessionFile);
  
  let truncatedCount = 0;
  for (const message of messages) {
    if (message.role === 'tool' && message.content.length > MAX_TOOL_RESULT_SIZE) {
      message.content = truncateContent(message.content, {
        maxSize: MAX_TOOL_RESULT_SIZE,
        preserveStart: 1000,
        preserveEnd: 1000,
      });
      truncatedCount++;
    }
  }
  
  await writeSessionMessages(params.sessionFile, messages);
  return { truncated: true, truncatedCount };
}

// 使用量追踪
class UsageAccumulator {
  input: number = 0;
  output: number = 0;
  cacheRead: number = 0;
  cacheWrite: number = 0;
  
  merge(usage: Usage) {
    this.input += usage.input ?? 0;
    this.output += usage.output ?? 0;
    this.cacheRead += usage.cacheRead ?? 0;
    this.cacheWrite += usage.cacheWrite ?? 0;
  }
  
  toNormalized() {
    return {
      input: this.input || undefined,
      output: this.output || undefined,
      cacheRead: this.cacheRead || undefined,
      cacheWrite: this.cacheWrite || undefined,
      total: this.input + this.output + this.cacheRead + this.cacheWrite,
    };
  }
}
```

**优势**:
- ✅ Token 计数
- ✅ 自动压缩
- ✅ 工具结果截断
- ✅ 使用量追踪
- ✅ 上下文窗口监控

---

## 📈 能力矩阵对比

| 能力 | 白泽 | OpenClaw | 说明 |
|------|:----:|:--------:|------|
| **意图识别** | ⭐⭐ | ⭐⭐⭐⭐⭐ | OpenClaw 有多层解析 |
| **工具选择** | ⭐⭐ | ⭐⭐⭐⭐⭐ | OpenClaw 有策略管道 |
| **命令执行** | ⭐⭐ | ⭐⭐⭐⭐⭐ | OpenClaw 有沙箱隔离 |
| **错误恢复** | ⭐⭐ | ⭐⭐⭐⭐⭐ | OpenClaw 有多层 Failover |
| **上下文管理** | ⭐ | ⭐⭐⭐⭐⭐ | OpenClaw 有自动压缩 |
| **安全控制** | ⭐ | ⭐⭐⭐⭐⭐ | OpenClaw 有权限审批 |
| **进程管理** | ⭐ | ⭐⭐⭐⭐⭐ | OpenClaw 有 PTY 支持 |
| **多模型支持** | ⭐⭐ | ⭐⭐⭐⭐⭐ | OpenClaw 有 20+ 提供商 |
| **多渠道支持** | ⭐ | ⭐⭐⭐⭐⭐ | OpenClaw 有 10+ 渠道 |
| **可观测性** | ⭐⭐ | ⭐⭐⭐⭐⭐ | OpenClaw 有完整日志 |

---

## 🎯 实际场景对比

### 场景 1: 用户请求执行危险命令

**用户输入**: "帮我删除所有 node_modules 文件夹"

#### 白泽的处理
```
1. 路由器识别为工具调用
2. 选择 file 技能
3. 执行 rm -rf node_modules
4. 返回结果
```
**问题**: 无确认，直接执行

#### OpenClaw的处理
```
1. 路由器识别为 exec 调用
2. 工具策略检查: rm -rf 是敏感操作
3. 发送审批请求给用户
4. 等待用户确认
5. 用户确认后执行
6. 返回结果
```
**优势**: 有安全确认

---

### 场景 2: API 速率限制

**情况**: LLM API 返回 429 错误

#### 白泽的处理
```
1. 捕获错误
2. 返回错误信息给用户
3. 用户需要手动重试
```
**问题**: 无自动恢复

#### OpenClaw的处理
```
1. 捕获错误
2. 分类为 rate_limit
3. 标记当前 Profile 失败
4. 切换到下一个 Profile
5. 自动重试请求
6. 成功返回结果
```
**优势**: 自动 Failover

---

### 场景 3: 上下文溢出

**情况**: 对话历史超过模型上下文窗口

#### 白泽的处理
```
1. 发送请求
2. API 返回错误
3. 返回错误信息给用户
```
**问题**: 无自动处理

#### OpenClaw的处理
```
1. 检测到上下文溢出错误
2. 触发自动压缩
3. 压缩会话历史
4. 自动重试请求
5. 成功返回结果
```
**优势**: 自动压缩恢复

---

## 💡 白泽改进建议

### 短期改进 (1-2 周)

1. **添加工具策略验证**
```typescript
class ToolPolicy {
  validate(toolName: string, params: any): ValidationResult {
    const schema = this.getSchemas()[toolName];
    return validateParams(params, schema);
  }
}
```

2. **添加敏感操作确认**
```typescript
const SENSITIVE_PATTERNS = [/rm\s+-rf/, /DELETE\s+FROM/i];
function isSensitiveCommand(cmd: string): boolean {
  return SENSITIVE_PATTERNS.some(p => p.test(cmd));
}
```

3. **添加错误重试**
```typescript
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await sleep(1000 * (i + 1));
    }
  }
}
```

### 中期改进 (1-2 月)

1. **添加沙箱隔离**
2. **添加上下文压缩**
3. **添加多 Profile 支持**

### 长期改进 (3-6 月)

1. **添加 PTY 终端支持**
2. **添加多渠道支持**
3. **添加完整的可观测性**

---

## 📝 结论

### 理解能力
- **白泽**: 基础的 LLM 路由，适合简单场景
- **OpenClaw**: 多层意图解析 + 丰富上下文，适合复杂场景

### 执行能力
- **白泽**: 基础执行，缺少安全和恢复机制
- **OpenClaw**: 企业级执行，有沙箱、审批、Failover

### 适用场景
- **白泽**: 个人学习、小型项目、简单任务
- **OpenClaw**: 企业生产、复杂任务、高安全要求

### 总结
白泽在理解和执行能力上与 OpenClaw 存在 **显著差距**，主要体现在：
1. 缺少多层错误恢复机制
2. 缺少安全控制（沙箱、审批）
3. 缺少上下文管理（压缩、溢出处理）
4. 缺少多 Profile Failover

这些差距使得白泽更适合学习和原型验证，而不适合生产环境使用。

---

*报告生成时间: 2026-02-27*
