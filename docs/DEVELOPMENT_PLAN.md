# 白泽企业级改造开发落地方案

## 📋 项目概述

### 目标
将白泽从轻量级 AI Agent 框架升级为企业级 AI Agent 平台，达到甚至超越 OpenClaw 的能力水平。

### 改造范围
- 核心架构升级
- 执行引擎重构
- 安全体系构建
- 多渠道支持
- 可观测性完善

### 预计工期
**总计: 12-16 周** (3-4 个月)

---

## 📊 差距分析与改造清单

### 一、核心架构 (优先级: P0)

| 模块 | 当前状态 | 目标状态 | 工作量 |
|------|----------|----------|--------|
| 意图理解 | 单次 LLM | 多层解析 + 钩子 | 2 周 |
| 工具选择 | 直接决策 | 策略管道 | 1 周 |
| 上下文管理 | 固定历史 | 自动压缩 + 溢出处理 | 2 周 |
| 错误恢复 | 能力缺口检测 | 多层 Failover | 2 周 |

### 二、执行引擎 (优先级: P0)

| 模块 | 当前状态 | 目标状态 | 工作量 |
|------|----------|----------|--------|
| 命令执行 | 直接 exec | Docker 沙箱 | 2 周 |
| 进程管理 | 无 | PTY + 生命周期 | 1.5 周 |
| 权限控制 | 无 | 审批流程 | 1 周 |
| 超时管理 | 无 | 多级超时 | 0.5 周 |

### 三、安全体系 (优先级: P0)

| 模块 | 当前状态 | 目标状态 | 工作量 |
|------|----------|----------|--------|
| 敏感数据检测 | 基础 | 企业级 | 0.5 周 |
| 操作审批 | 无 | 完整审批流 | 1 周 |
| 沙箱隔离 | 无 | Docker 隔离 | 1 周 |
| SSRF 防护 | 无 | 完整防护 | 0.5 周 |

### 四、记忆系统 (优先级: P1)

| 模块 | 当前状态 | 目标状态 | 工作量 |
|------|----------|----------|--------|
| 向量搜索 | 无 | 多嵌入支持 | 2 周 |
| 混合检索 | 无 | 向量 + FTS | 1 周 |
| 嵌入缓存 | 无 | 完整缓存 | 0.5 周 |
| 文件监控 | 无 | 自动同步 | 0.5 周 |

### 五、多渠道支持 (优先级: P1)

| 模块 | 当前状态 | 目标状态 | 工作量 |
|------|----------|----------|--------|
| Discord | 无 | 完整集成 | 1 周 |
| Telegram | 无 | 完整集成 | 1 周 |
| Slack | 无 | 完整集成 | 1 周 |
| 微信/飞书 | 无 | 完整集成 | 1 周 |

### 六、LLM 提供商 (优先级: P1)

| 模块 | 当前状态 | 目标状态 | 工作量 |
|------|----------|----------|--------|
| OpenAI | 无 | 完整支持 | 0.5 周 |
| Anthropic | 无 | 完整支持 | 0.5 周 |
| Gemini | 无 | 完整支持 | 0.5 周 |
| 本地模型 | Ollama | Ollama + vLLM | 0.5 周 |

### 七、可观测性 (优先级: P2)

| 模块 | 当前状态 | 目标状态 | 工作量 |
|------|----------|----------|--------|
| 日志系统 | 基础 | 结构化日志 | 0.5 周 |
| 指标收集 | 无 | Prometheus | 1 周 |
| 链路追踪 | 无 | OpenTelemetry | 1 周 |
| 健康检查 | 无 | 完整检查 | 0.5 周 |

---

## 🗓️ 分阶段开发计划

### 第一阶段: 核心架构升级 (4 周)

#### Week 1-2: 意图理解与工具选择

**目标**: 建立多层意图解析和工具策略管道

**任务清单**:
```
□ 1.1 设计钩子系统架构
  □ 1.1.1 定义钩子接口 (HookContext, HookResult)
  □ 1.1.2 实现钩子注册器 (HookRegistry)
  □ 1.1.3 实现钩子运行器 (HookRunner)
  
□ 1.2 实现前置处理钩子
  □ 1.2.1 before_model_resolve - 模型选择前
  □ 1.2.2 before_tool_call - 工具调用前
  □ 1.2.3 before_exec - 命令执行前
  
□ 1.3 实现工具策略管道
  □ 1.3.1 工具白名单/黑名单
  □ 1.3.2 参数 Schema 验证
  □ 1.3.3 敏感操作检测
  
□ 1.4 实现后置处理钩子
  □ 1.4.1 after_tool_call - 工具调用后
  □ 1.4.2 after_exec - 命令执行后
  □ 1.4.3 结果过滤与脱敏
```

**交付物**:
- `src/hooks/` - 钩子系统
- `src/policy/` - 策略管道
- 单元测试覆盖率 > 80%

---

#### Week 3-4: 上下文管理与错误恢复

**目标**: 实现智能上下文管理和多层错误恢复

**任务清单**:
```
□ 2.1 上下文窗口管理
  □ 2.1.1 Token 计数器 (Tokenizer)
  □ 2.1.2 上下文窗口监控 (ContextWindowGuard)
  □ 2.1.3 溢出检测与预警
  
□ 2.2 会话压缩
  □ 2.2.1 压缩策略选择器
  □ 2.2.2 摘要生成器
  □ 2.2.3 自动压缩触发器
  
□ 2.3 工具结果处理
  □ 2.3.1 结果截断器
  □ 2.3.2 大文件分块
  □ 2.3.3 二进制文件处理
  
□ 2.4 错误恢复系统
  □ 2.4.1 错误分类器 (ErrorClassifier)
  □ 2.4.2 Failover 管理器
  □ 2.4.3 重试策略 (RetryPolicy)
  □ 2.4.4 认证 Profile 轮换
```

**交付物**:
- `src/context/` - 上下文管理
- `src/recovery/` - 错误恢复
- 集成测试用例

---

### 第二阶段: 执行引擎重构 (4 周)

#### Week 5-6: 沙箱隔离与进程管理

**目标**: 建立安全的执行环境

**任务清单**:
```
□ 3.1 Docker 沙箱
  □ 3.1.1 沙箱管理器 (SandboxManager)
  □ 3.1.2 容器生命周期管理
  □ 3.1.3 资源限制配置
  □ 3.1.4 网络隔离策略
  □ 3.1.5 卷挂载管理
  
□ 3.2 进程管理
  □ 3.2.1 进程注册表 (ProcessRegistry)
  □ 3.2.2 PTY 终端支持
  □ 3.2.3 后台进程管理
  □ 3.2.4 进程信号处理
  
□ 3.3 超时管理
  □ 3.3.1 多级超时配置
  □ 3.3.2 超时检测器
  □ 3.3.3 优雅终止
```

**交付物**:
- `src/sandbox/` - 沙箱系统
- `src/process/` - 进程管理
- Docker 镜像

---

#### Week 7-8: 权限控制与安全体系

**目标**: 建立完整的安全控制体系

**任务清单**:
```
□ 4.1 权限审批系统
  □ 4.1.1 审批请求生成器
  □ 4.1.2 审批 ID 管理
  □ 4.1.3 用户确认流程
  □ 4.1.4 审批超时处理
  
□ 4.2 敏感操作检测
  □ 4.2.1 危险命令模式库
  □ 4.2.2 文件系统操作检测
  □ 4.2.3 网络操作检测
  
□ 4.3 数据安全
  □ 4.3.1 敏感数据检测增强
  □ 4.3.2 数据脱敏器
  □ 4.3.3 审计日志
  
□ 4.4 SSRF 防护
  □ 4.4.1 URL 验证器
  □ 4.4.2 IP 黑名单
  □ 4.4.3 网络请求代理
```

**交付物**:
- `src/security/` - 安全系统 (增强)
- `src/approval/` - 审批系统
- 安全测试报告

---

### 第三阶段: 记忆系统升级 (3 周)

#### Week 9-10: 向量搜索与嵌入

**目标**: 实现企业级记忆系统

**任务清单**:
```
□ 5.1 嵌入系统
  □ 5.1.1 嵌入提供者接口
  □ 5.1.2 OpenAI 嵌入适配器
  □ 5.1.3 本地嵌入适配器
  □ 5.1.4 批量嵌入优化
  
□ 5.2 向量存储
  □ 5.2.1 SQLite-vec 集成
  □ 5.2.2 向量索引管理
  □ 5.2.3 相似度搜索
  
□ 5.3 混合检索
  □ 5.3.1 FTS 全文搜索
  □ 5.3.2 向量 + FTS 融合
  □ 5.3.3 MMR 多样性重排
  □ 5.3.4 时间衰减权重
```

**交付物**:
- `src/embeddings/` - 嵌入系统
- `src/vector/` - 向量存储
- 性能测试报告

---

#### Week 11: 记忆同步与缓存

**任务清单**:
```
□ 6.1 文件监控
  □ 6.1.1 Chokidar 集成
  □ 6.1.2 增量索引
  □ 6.1.3 自动同步触发
  
□ 6.2 嵌入缓存
  □ 6.2.1 缓存存储
  □ 6.2.2 缓存命中检测
  □ 6.2.3 缓存失效策略
  
□ 6.3 记忆管理
  □ 6.3.1 记忆分块
  □ 6.3.2 记忆过期
  □ 6.3.3 记忆合并
```

**交付物**:
- `src/memory/` - 记忆系统 (增强)
- 同步测试用例

---

### 第四阶段: 多渠道与 LLM 支持 (3 周)

#### Week 12-13: 多渠道集成

**任务清单**:
```
□ 7.1 渠道抽象层
  □ 7.1.1 渠道接口定义
  □ 7.1.2 消息格式转换
  □ 7.1.3 事件处理框架
  
□ 7.2 Discord 集成
  □ 7.2.1 Discord.js 集成
  □ 7.2.2 消息收发
  □ 7.2.3 Slash 命令
  
□ 7.3 Telegram 集成
  □ 7.3.1 grammy 集成
  □ 7.3.2 消息收发
  □ 7.3.3 Inline 按钮
  
□ 7.4 Slack 集成
  □ 7.4.1 Slack Bolt 集成
  □ 7.4.2 消息收发
  □ 7.4.3 App Home
```

**交付物**:
- `src/channels/` - 渠道系统
- 各渠道适配器

---

#### Week 14-15: LLM 提供商扩展

**任务清单**:
```
□ 8.1 提供者抽象
  □ 8.1.1 统一接口定义
  □ 8.1.2 流式响应处理
  □ 8.1.3 工具调用适配
  
□ 8.2 OpenAI 集成
  □ 8.2.1 GPT-4/4o 支持
  □ 8.2.2 Function Calling
  □ 8.2.3 Vision 支持
  
□ 8.3 Anthropic 集成
  □ 8.3.1 Claude 3.5 支持
  □ 8.3.2 Tool Use
  □ 8.3.3 Vision 支持
  
□ 8.4 其他提供商
  □ 8.4.1 Gemini
  □ 8.4.2 Groq
  □ 8.4.3 本地模型 (vLLM)
```

**交付物**:
- `src/providers/` - 提供者系统
- 各提供商适配器

---

### 第五阶段: 可观测性与优化 (1-2 周)

#### Week 16: 可观测性完善

**任务清单**:
```
□ 9.1 结构化日志
  □ 9.1.1 JSON 格式日志
  □ 9.1.2 日志级别管理
  □ 9.1.3 敏感信息过滤
  
□ 9.2 指标收集
  □ 9.2.1 Prometheus 集成
  □ 9.2.2 自定义指标
  □ 9.2.3 指标导出
  
□ 9.3 链路追踪
  □ 9.3.1 OpenTelemetry 集成
  □ 9.3.2 Span 管理
  □ 9.3.3 追踪导出
  
□ 9.4 健康检查
  □ 9.4.1 健康检查端点
  □ 9.4.2 就绪检查
  □ 9.4.3 存活检查
```

**交付物**:
- `src/observability/` - 可观测性系统 (增强)
- Grafana 仪表盘

---

## 📁 目标目录结构

```
baize_repo/
├── src/
│   ├── core/
│   │   ├── brain/              # 决策中心
│   │   ├── router/             # 路由器
│   │   ├── context/            # 上下文管理 (增强)
│   │   │   ├── ContextManager.ts
│   │   │   ├── ContextCompressor.ts
│   │   │   ├── Tokenizer.ts
│   │   │   └── ContextWindowGuard.ts
│   │   ├── recovery/           # 错误恢复 (增强)
│   │   │   ├── ErrorClassifier.ts
│   │   │   ├── FailoverManager.ts
│   │   │   └── RetryPolicy.ts
│   │   └── state/              # 状态管理
│   │
│   ├── hooks/                  # 钩子系统 (新增)
│   │   ├── HookRegistry.ts
│   │   ├── HookRunner.ts
│   │   ├── types.ts
│   │   └── builtins/
│   │
│   ├── policy/                 # 策略系统 (新增)
│   │   ├── ToolPolicy.ts
│   │   ├── PolicyPipeline.ts
│   │   └── schemas/
│   │
│   ├── executor/               # 执行器 (重构)
│   │   ├── Executor.ts
│   │   ├── SandboxExecutor.ts
│   │   └── ApprovalManager.ts
│   │
│   ├── sandbox/                # 沙箱系统 (增强)
│   │   ├── SandboxManager.ts
│   │   ├── DockerSandbox.ts
│   │   ├── ResourceLimiter.ts
│   │   └── NetworkPolicy.ts
│   │
│   ├── process/                # 进程管理 (新增)
│   │   ├── ProcessRegistry.ts
│   │   ├── PtyManager.ts
│   │   ├── ProcessSupervisor.ts
│   │   └── TimeoutManager.ts
│   │
│   ├── security/               # 安全系统 (增强)
│   │   ├── SecurityManager.ts
│   │   ├── SecretDetector.ts
│   │   ├── ApprovalRequest.ts
│   │   ├── AuditLogger.ts
│   │   └── SSRFProtection.ts
│   │
│   ├── memory/                 # 记忆系统 (增强)
│   │   ├── MemorySystem.ts
│   │   ├── VectorStore.ts
│   │   ├── EmbeddingManager.ts
│   │   ├── HybridSearch.ts
│   │   └── MemorySync.ts
│   │
│   ├── embeddings/             # 嵌入系统 (新增)
│   │   ├── EmbeddingProvider.ts
│   │   ├── OpenAIEmbedding.ts
│   │   ├── LocalEmbedding.ts
│   │   └── EmbeddingCache.ts
│   │
│   ├── channels/               # 渠道系统 (新增)
│   │   ├── ChannelManager.ts
│   │   ├── BaseChannel.ts
│   │   ├── DiscordChannel.ts
│   │   ├── TelegramChannel.ts
│   │   ├── SlackChannel.ts
│   │   └── WechatChannel.ts
│   │
│   ├── providers/              # LLM 提供者 (新增)
│   │   ├── LLMProvider.ts
│   │   ├── OpenAIProvider.ts
│   │   ├── AnthropicProvider.ts
│   │   ├── GeminiProvider.ts
│   │   ├── GroqProvider.ts
│   │   └── LocalProvider.ts
│   │
│   ├── observability/          # 可观测性 (增强)
│   │   ├── Logger.ts
│   │   ├── Metrics.ts
│   │   ├── Tracing.ts
│   │   └── HealthCheck.ts
│   │
│   ├── skills/                 # 技能系统
│   ├── tools/                  # 工具系统
│   └── types/                  # 类型定义
│
├── docker/                     # Docker 配置 (新增)
│   ├── Dockerfile.sandbox
│   ├── docker-compose.yml
│   └── sandbox-image/
│
├── config/                     # 配置文件
│   ├── default.yaml
│   ├── security.yaml
│   └── providers.yaml
│
├── tests/                      # 测试 (增强)
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
└── docs/                       # 文档
    ├── ARCHITECTURE.md
    ├── SECURITY.md
    └── DEPLOYMENT.md
```

---

## 🔧 核心技术方案

### 1. 钩子系统设计

```typescript
// src/hooks/types.ts
export interface HookContext {
  sessionId: string;
  userId?: string;
  workspaceDir: string;
  timestamp: number;
  metadata: Record<string, unknown>;
}

export interface HookResult {
  proceed: boolean;
  modifications?: {
    providerOverride?: string;
    modelOverride?: string;
    toolOverride?: string;
    paramsOverride?: Record<string, unknown>;
  };
  error?: string;
}

export type HookName = 
  | 'before_model_resolve'
  | 'before_tool_call'
  | 'before_exec'
  | 'after_tool_call'
  | 'after_exec'
  | 'on_error';

// src/hooks/HookRegistry.ts
export class HookRegistry {
  private hooks: Map<HookName, Set<HookHandler>> = new Map();
  
  register(name: HookName, handler: HookHandler): void {
    if (!this.hooks.has(name)) {
      this.hooks.set(name, new Set());
    }
    this.hooks.get(name)!.add(handler);
  }
  
  async run(name: HookName, context: HookContext): Promise<HookResult> {
    const handlers = this.hooks.get(name) || new Set();
    
    for (const handler of handlers) {
      const result = await handler(context);
      if (!result.proceed) {
        return result;
      }
      // 应用修改
      if (result.modifications) {
        context.metadata = { ...context.metadata, ...result.modifications };
      }
    }
    
    return { proceed: true };
  }
}
```

### 2. 策略管道设计

```typescript
// src/policy/PolicyPipeline.ts
export interface PolicyStage {
  name: string;
  check: (context: PolicyContext) => Promise<PolicyResult>;
}

export interface PolicyResult {
  allowed: boolean;
  reason?: string;
  modifications?: Record<string, unknown>;
}

export class PolicyPipeline {
  private stages: PolicyStage[] = [];
  
  addStage(stage: PolicyStage): this {
    this.stages.push(stage);
    return this;
  }
  
  async execute(context: PolicyContext): Promise<PolicyResult> {
    for (const stage of this.stages) {
      const result = await stage.check(context);
      if (!result.allowed) {
        return result;
      }
      if (result.modifications) {
        context.params = { ...context.params, ...result.modifications };
      }
    }
    return { allowed: true };
  }
}

// 内置策略阶段
export const ToolAllowlistStage: PolicyStage = {
  name: 'tool_allowlist',
  check: async (ctx) => {
    const allowlist = ctx.config.toolAllowlist;
    if (allowlist && !allowlist.includes(ctx.toolName)) {
      return { allowed: false, reason: `Tool ${ctx.toolName} not in allowlist` };
    }
    return { allowed: true };
  }
};

export const ParamValidationStage: PolicyStage = {
  name: 'param_validation',
  check: async (ctx) => {
    const schema = getToolSchema(ctx.toolName);
    if (schema) {
      const result = validateParams(ctx.params, schema);
      if (!result.valid) {
        return { allowed: false, reason: result.errors.join(', ') };
      }
    }
    return { allowed: true };
  }
};

export const SensitiveOperationStage: PolicyStage = {
  name: 'sensitive_operation',
  check: async (ctx) => {
    if (isSensitiveOperation(ctx.toolName, ctx.params)) {
      ctx.requiresApproval = true;
    }
    return { allowed: true };
  }
};
```

### 3. 沙箱执行器设计

```typescript
// src/sandbox/DockerSandbox.ts
export interface SandboxConfig {
  image: string;
  memoryLimit: number;  // bytes
  cpuQuota: number;     // microseconds
  timeout: number;      // milliseconds
  networkDisabled: boolean;
  mounts: Array<{
    host: string;
    container: string;
    mode: 'ro' | 'rw';
  }>;
}

export class DockerSandbox {
  private docker: Docker;
  private containers: Map<string, Container> = new Map();
  
  async create(config: SandboxConfig): Promise<SandboxInstance> {
    const container = await this.docker.createContainer({
      Image: config.image,
      HostConfig: {
        Memory: config.memoryLimit,
        CpuQuota: config.cpuQuota,
        NetworkMode: config.networkDisabled ? 'none' : 'bridge',
        Binds: config.mounts.map(m => 
          `${m.host}:${m.container}:${m.mode}`
        ),
        SecurityOpt: ['no-new-privileges'],
        ReadonlyRootfs: true,
      },
    });
    
    await container.start();
    this.containers.set(container.id, container);
    
    return {
      id: container.id,
      exec: async (command: string, options?: ExecOptions) => {
        return this.execInContainer(container.id, command, options);
      },
      destroy: async () => {
        await container.stop();
        await container.remove();
        this.containers.delete(container.id);
      },
    };
  }
  
  private async execInContainer(
    containerId: string, 
    command: string,
    options?: ExecOptions
  ): Promise<ExecResult> {
    const container = this.containers.get(containerId);
    if (!container) {
      throw new Error(`Container ${containerId} not found`);
    }
    
    const exec = await container.exec({
      Cmd: ['bash', '-c', command],
      AttachStdout: true,
      AttachStderr: true,
      Env: options?.env ? Object.entries(options.env).map(([k, v]) => `${k}=${v}`) : [],
    });
    
    const stream = await exec.start();
    
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        reject(new Error('Execution timeout'));
      }, options?.timeout || 30000);
      
      stream.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      
      stream.on('error', (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });
      
      stream.on('end', () => {
        clearTimeout(timeout);
        resolve({ stdout, stderr, exitCode: 0 });
      });
    });
  }
}
```

### 4. 错误恢复系统设计

```typescript
// src/recovery/ErrorClassifier.ts
export type ErrorCategory = 
  | 'auth'
  | 'rate_limit'
  | 'billing'
  | 'context_overflow'
  | 'timeout'
  | 'network'
  | 'unknown';

export interface ClassifiedError {
  category: ErrorCategory;
  retryable: boolean;
  retryAfter?: number;
  profileSwitch?: boolean;
  message: string;
}

export class ErrorClassifier {
  private patterns: Map<RegExp, ErrorCategory> = new Map([
    [/401|unauthorized|invalid.*api.*key/i, 'auth'],
    [/429|rate.*limit|too.*many.*requests/i, 'rate_limit'],
    [/quota|billing|insufficient/i, 'billing'],
    [/context.*overflow|token.*limit|too.*long/i, 'context_overflow'],
    [/timeout|timed.*out/i, 'timeout'],
    [/network|connection|econnrefused/i, 'network'],
  ]);
  
  classify(error: Error): ClassifiedError {
    const message = error.message.toLowerCase();
    
    for (const [pattern, category] of this.patterns) {
      if (pattern.test(message)) {
        return this.createResult(category, message);
      }
    }
    
    return this.createResult('unknown', message);
  }
  
  private createResult(category: ErrorCategory, message: string): ClassifiedError {
    return {
      category,
      retryable: ['rate_limit', 'timeout', 'network'].includes(category),
      retryAfter: category === 'rate_limit' ? 60000 : undefined,
      profileSwitch: ['auth', 'rate_limit', 'billing'].includes(category),
      message,
    };
  }
}

// src/recovery/FailoverManager.ts
export class FailoverManager {
  private profiles: AuthProfile[] = [];
  private currentIndex = 0;
  private cooldowns: Map<string, number> = new Map();
  
  addProfile(profile: AuthProfile): void {
    this.profiles.push(profile);
  }
  
  getCurrentProfile(): AuthProfile | null {
    return this.profiles[this.currentIndex] || null;
  }
  
  async advanceProfile(): Promise<boolean> {
    const startIndex = this.currentIndex;
    
    do {
      this.currentIndex = (this.currentIndex + 1) % this.profiles.length;
      const profile = this.profiles[this.currentIndex];
      
      // 检查冷却
      const cooldownEnd = this.cooldowns.get(profile.id) || 0;
      if (Date.now() > cooldownEnd) {
        return true;
      }
    } while (this.currentIndex !== startIndex);
    
    return false; // 所有 Profile 都在冷却
  }
  
  markFailure(profileId: string, duration: number): void {
    this.cooldowns.set(profileId, Date.now() + duration);
  }
  
  markSuccess(profileId: string): void {
    this.cooldowns.delete(profileId);
  }
}

// src/recovery/RetryPolicy.ts
export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  retryableErrors: ErrorCategory[];
}

export class RetryPolicy {
  constructor(private config: RetryConfig) {}
  
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;
    let delay = this.config.baseDelay;
    
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        
        const classified = this.classifier.classify(lastError);
        
        if (!this.config.retryableErrors.includes(classified.category)) {
          throw lastError;
        }
        
        if (attempt < this.config.maxRetries) {
          await this.sleep(delay);
          delay = Math.min(delay * this.config.backoffMultiplier, this.config.maxDelay);
        }
      }
    }
    
    throw lastError;
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### 5. 上下文压缩设计

```typescript
// src/context/ContextCompressor.ts
export interface CompressionConfig {
  maxTokens: number;
  targetTokens: number;
  preserveRecent: number;  // 保留最近 N 条消息
  strategy: 'summary' | 'truncate' | 'hybrid';
}

export class ContextCompressor {
  constructor(
    private config: CompressionConfig,
    private tokenizer: Tokenizer,
    private llm: LLMProvider
  ) {}
  
  async compress(messages: Message[]): Promise<Message[]> {
    const currentTokens = this.tokenizer.countTokens(messages);
    
    if (currentTokens <= this.config.maxTokens) {
      return messages;
    }
    
    // 保留最近消息
    const recentMessages = messages.slice(-this.config.preserveRecent);
    const oldMessages = messages.slice(0, -this.config.preserveRecent);
    
    // 压缩旧消息
    const compressed = await this.compressMessages(oldMessages);
    
    return [...compressed, ...recentMessages];
  }
  
  private async compressMessages(messages: Message[]): Promise<Message[]> {
    switch (this.config.strategy) {
      case 'summary':
        return this.summarizeMessages(messages);
      case 'truncate':
        return this.truncateMessages(messages);
      case 'hybrid':
        return this.hybridCompress(messages);
    }
  }
  
  private async summarizeMessages(messages: Message[]): Promise<Message[]> {
    const content = messages.map(m => 
      `${m.role}: ${m.content}`
    ).join('\n');
    
    const summary = await this.llm.chat([
      { role: 'system', content: 'Summarize the following conversation concisely:' },
      { role: 'user', content },
    ], { maxTokens: 500 });
    
    return [{
      role: 'system',
      content: `[Previous conversation summary]\n${summary.content}`,
    }];
  }
  
  private truncateMessages(messages: Message[]): Promise<Message[]> {
    // 保留首尾，删除中间
    const head = messages.slice(0, 2);
    const tail = messages.slice(-2);
    
    return [
      ...head,
      { role: 'system', content: `[${messages.length - 4} messages omitted]` },
      ...tail,
    ];
  }
}
```

---

## 📊 测试策略

### 单元测试覆盖率目标

| 模块 | 目标覆盖率 |
|------|-----------|
| 钩子系统 | > 90% |
| 策略管道 | > 90% |
| 沙箱执行 | > 85% |
| 错误恢复 | > 90% |
| 上下文管理 | > 85% |
| 记忆系统 | > 80% |

### 集成测试场景

```
1. 工具调用流程
   - 正常调用
   - 参数验证失败
   - 敏感操作审批
   - 超时处理

2. 错误恢复流程
   - 认证失败切换
   - 速率限制重试
   - 上下文溢出压缩

3. 沙箱执行流程
   - 容器创建
   - 命令执行
   - 资源限制
   - 容器销毁

4. 多渠道流程
   - 消息接收
   - 意图识别
   - 响应发送
```

### E2E 测试场景

```
1. 完整对话流程
2. 技能执行流程
3. 多轮对话记忆
4. 跨渠道消息
```

---

## 📈 里程碑与交付

### Milestone 1: 核心架构 (Week 4)
- ✅ 钩子系统
- ✅ 策略管道
- ✅ 上下文管理
- ✅ 错误恢复

### Milestone 2: 执行引擎 (Week 8)
- ✅ Docker 沙箱
- ✅ 进程管理
- ✅ 权限控制
- ✅ 安全体系

### Milestone 3: 记忆系统 (Week 11)
- ✅ 向量搜索
- ✅ 混合检索
- ✅ 自动同步

### Milestone 4: 多渠道支持 (Week 14)
- ✅ Discord
- ✅ Telegram
- ✅ Slack
- ✅ LLM 提供商

### Milestone 5: 可观测性 (Week 16)
- ✅ 结构化日志
- ✅ 指标收集
- ✅ 链路追踪
- ✅ 文档完善

---

## 🚀 立即开始

第一步，我将创建钩子系统的核心代码。是否继续？
