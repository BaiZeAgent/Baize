# 白泽3.0 架构设计文档

**版本**: 3.0.2  
**作者**: 白泽架构团队  
**日期**: 2025年2月  
**状态**: 正式发布

---

## 文档概述

### 文档目的

本文档定义了白泽3.0（Baize 3.0）的完整技术架构，旨在构建一个**JARVIS级别的AI智能助手系统**。白泽3.0不仅是一个对话机器人，更是一个具备**自主思考、动态规划、自我进化**能力的智能代理系统。

### 设计理念

```
核心理念：在一个不可靠的LLM之上构建一个可靠的软件系统
```

白泽3.0的核心难点不在于"让LLM思考"，而在于如何在一个不可靠的LLM之上构建一个可靠的软件系统。本架构通过分层设计、冗余机制、安全边界和持续学习来解决这个核心矛盾。

### 核心特性

| 特性 | 描述 |
|-----|------|
| 🧠 六阶段思考协议 | 理解→拆解→规划→调度→验收→反思 |
| 🔄 动态技能加载 | 运行时加载Python/JS/Shell技能 |
| 📚 三层记忆系统 | 情景记忆+声明式记忆+程序性记忆 |
| 🧬 自进化能力 | 能力缺口检测+技能市场+角色化思考 |
| 🛡️ 安全边界 | 禁止区域+限制区域+自由区域 |
| 🎯 上下文管理 | Token预算+滑动窗口+压缩机制 |
| 🔒 沙箱隔离 | Docker容器+静态分析+资源锁 |
| 💰 成本控制 | 预算管理+成本追踪+告警机制 |
| 💾 状态管理 | Agent状态持久化+恢复机制 |

---

## 目录

1. [系统概述](#第一章-系统概述)
2. [分层架构设计](#第二章-分层架构设计)
3. [思考调度系统](#第三章-思考调度系统)
4. [技能系统](#第四章-技能系统)
5. [执行层](#第五章-执行层)
6. [调度层](#第六章-调度层)
7. [记忆系统](#第七章-记忆系统)
8. [安全系统](#第八章-安全系统)
9. [自进化系统](#第九章-自进化系统)
10. [可观测性](#第十章-可观测性)
11. [交互层](#第十一章-交互层)
12. [上下文管理](#第十二章-上下文管理)
13. [成本控制](#第十三章-成本控制)
14. [状态管理](#第十四章-状态管理)
15. [评测体系](#第十五章-评测体系)
16. [运维与部署](#第十六章-运维与部署)
17. [数据类型定义](#第十七章-数据类型定义)
18. [开发路线图](#第十八章-开发路线图)
19. [附录](#附录)

---

## 第一章 系统概述

### 1.1 系统定位

白泽3.0定位为**个人智能助理**，对标漫威宇宙中的JARVIS系统。它不仅能进行自然语言对话，还能：

- 🗂️ 操作文件系统
- 🌐 访问网络资源
- ⏰ 执行定时任务
- 📊 分析数据
- 🔧 自我优化升级
- 🛒 自主获取新能力

### 1.2 系统架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                        L9 交互层 (Interaction)                   │
│                    CLI / HTTP API / WebSocket                    │
├─────────────────────────────────────────────────────────────────┤
│                        L8 安全层 (Security)                      │
│              身份认证 / 权限控制 / 审计日志 / 隐私保护            │
├─────────────────────────────────────────────────────────────────┤
│                        L7 决策层 (Thinking)                      │
│                   六阶段思考协议 / 上下文管理                     │
├─────────────────────────────────────────────────────────────────┤
│                        L6 调度层 (Scheduler)                     │
│              任务调度 / 主动任务 / 资源锁 / DAG调度               │
├─────────────────────────────────────────────────────────────────┤
│                        L5 执行层 (Executor)                      │
│              并行执行 / 沙箱隔离 / 错误恢复 / 状态追踪             │
├─────────────────────────────────────────────────────────────────┤
│                        L4 能力层 (Skills)                        │
│           动态技能加载 / Python-JS-Shell / 技能市场               │
├─────────────────────────────────────────────────────────────────┤
│                        L3 知识层 (Knowledge)                     │
│                 向量存储 / RAG检索 / 语义缓存                     │
├─────────────────────────────────────────────────────────────────┤
│                        L2 数据层 (Data)                          │
│              SQLite存储 / 三层记忆 / 状态持久化                   │
├─────────────────────────────────────────────────────────────────┤
│                        L1 可观测层 (Observability)               │
│           结构化日志 / 分布式追踪 / 性能指标 / 告警               │
└─────────────────────────────────────────────────────────────────┘
```

### 1.3 技术栈

| 层级 | 技术选型 |
|-----|---------|
| L1 可观测层 | Winston + OpenTelemetry |
| L2 数据层 | sql.js (SQLite in WASM) |
| L3 知识层 | 内存向量存储 / Chroma (可选) |
| L4 能力层 | 动态加载 + Docker沙箱 + 技能市场 |
| L5 执行层 | Node.js spawn + 并行调度 |
| L6 调度层 | 事件驱动 + DAG调度 |
| L7 决策层 | LLM驱动 + 六阶段协议 |
| L8 安全层 | RBAC + 审计日志 |
| L9 交互层 | CLI (Inquirer) + HTTP API |

### 1.4 核心设计原则

1. **分层解耦**：每层独立可测试、可替换
2. **渐进增强**：从简单到复杂，逐步添加能力
3. **安全优先**：任何操作都必须经过安全检查
4. **可观测性**：所有操作都有日志和追踪
5. **容错设计**：假设任何组件都可能失败
6. **成本可控**：Token消耗有预算限制
7. **自主进化**：系统能检测能力缺口并自主获取新能力

---

## 第二章 分层架构设计

### 2.1 九层架构详解

#### L1 可观测层 (Observability)

**职责**：提供系统的"眼睛"和"耳朵"

```
┌─────────────────────────────────────┐
│           可观测层组件               │
├─────────────────────────────────────┤
│  ┌─────────┐ ┌─────────┐ ┌────────┐ │
│  │ 日志系统 │ │ 追踪系统 │ │ 指标系统│ │
│  │ Winston │ │ Tracing │ │ Metrics│ │
│  └─────────┘ └─────────┘ └────────┘ │
├─────────────────────────────────────┤
│  ┌─────────────────────────────────┐│
│  │        告警系统 (Alerting)       ││
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
```

**核心组件**：

| 组件 | 功能 | 实现 |
|-----|------|------|
| 日志系统 | 结构化日志输出 | Winston |
| 追踪系统 | 请求链路追踪 | TraceContext + Span |
| 指标系统 | 性能指标收集 | 自定义Metrics |
| 告警系统 | 异常告警通知 | 阈值触发 |

**日志格式**：
```
2025-02-23 04:45:03 | INFO | [trace-id-xxx] 成本记录 {"module":"cost:manager","provider":"aliyun"}
```

---

#### L2 数据层 (Data)

**职责**：数据的持久化存储

```
┌─────────────────────────────────────┐
│             数据层架构               │
├─────────────────────────────────────┤
│  ┌─────────────────────────────────┐│
│  │      SQLite (sql.js)            ││
│  │    ┌───────────────────────┐    ││
│  │    │  episodic_memory      │    ││
│  │    │  declarative_memory   │    ││
│  │    │  procedural_memory    │    ││
│  │    │  proactive_tasks      │    ││
│  │    │  task_history         │    ││
│  │    │  evolution_history    │    ││
│  │    │  trust_records        │    ││
│  │    │  confirmation_history │    ││
│  │    │  agent_states         │    ││
│  │    │  capability_gaps      │    ││
│  │    │  memory_snapshots     │    ││
│  │    └───────────────────────┘    ││
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
```

**数据库表设计**：

```sql
-- 情景记忆表
CREATE TABLE episodic_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 声明式记忆表
CREATE TABLE declarative_memory (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  confidence REAL DEFAULT 0.5,
  times_reinforced INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 程序性记忆表
CREATE TABLE procedural_memory (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Agent状态表
CREATE TABLE agent_states (
  conversation_id TEXT PRIMARY KEY,
  current_phase TEXT NOT NULL,
  thought_process TEXT,
  executed_tasks TEXT,
  pending_tasks TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- 记忆快照表
CREATE TABLE memory_snapshots (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  trigger TEXT NOT NULL,
  episodic TEXT,
  declarative TEXT,
  procedural TEXT
);
```

---

#### L3 知识层 (Knowledge)

**职责**：知识的存储、检索和增强

```
┌─────────────────────────────────────┐
│             知识层架构               │
├─────────────────────────────────────┤
│  ┌─────────────────────────────────┐│
│  │        向量存储                  ││
│  │  ┌───────────────────────────┐  ││
│  │  │  MemoryVectorStore        │  ││
│  │  │  - 余弦相似度计算          │  ││
│  │  │  - 语义检索               │  ││
│  │  └───────────────────────────┘  ││
│  └─────────────────────────────────┘│
├─────────────────────────────────────┤
│  ┌─────────────────────────────────┐│
│  │        RAG系统                   ││
│  │  - 知识添加                      ││
│  │  - 上下文构建                    ││
│  │  - 语义缓存                      ││
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
```

---

#### L4 能力层 (Skills)

**职责**：技能的动态加载、执行和市场集成

```
┌─────────────────────────────────────┐
│             能力层架构               │
├─────────────────────────────────────┤
│  ┌─────────────────────────────────┐│
│  │        技能加载器                ││
│  │  - 动态扫描skills目录            ││
│  │  - 解析SKILL.md定义              ││
│  │  - 支持Python/JS/Shell           ││
│  └─────────────────────────────────┘│
├─────────────────────────────────────┤
│  ┌─────────────────────────────────┐│
│  │        技能注册表                ││
│  │  - 技能查找                      ││
│  │  - 能力索引                      ││
│  │  - 版本管理                      ││
│  └─────────────────────────────────┘│
├─────────────────────────────────────┤
│  ┌─────────────────────────────────┐│
│  │        技能市场客户端            ││
│  │  - 搜索技能                      ││
│  │  - 下载安装                      ││
│  │  - 安全验证                      ││
│  └─────────────────────────────────┘│
├─────────────────────────────────────┤
│  ┌─────────────────────────────────┐│
│  │        沙箱执行器                ││
│  │  - Docker容器隔离                ││
│  │  - 资源限制                      ││
│  │  - 安全审计                      ││
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
```

---

#### L5-L9 层级（简化说明）

| 层级 | 职责 | 核心组件 |
|-----|------|---------|
| L5 执行层 | 任务执行 | 并行执行器、错误恢复、重试机制、资源管理 |
| L6 调度层 | 任务调度 | DAG调度、主动任务、资源锁 |
| L7 决策层 | 核心思考 | 六阶段思考、上下文管理、重规划机制 |
| L8 安全层 | 安全防护 | 认证授权、安全边界、审计、隐私保护 |
| L9 交互层 | 用户交互 | CLI、HTTP API、WebSocket |

---

## 第三章 思考调度系统

### 3.1 六阶段思考协议

白泽3.0的核心创新是**六阶段思考协议**，模拟人类的思考过程：

```
┌─────────────────────────────────────────────────────────────────┐
│                     六阶段思考协议                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐      │
│  │ 阶段1   │───▶│ 阶段2   │───▶│ 阶段3   │───▶│ 阶段4   │      │
│  │ 理解    │    │ 拆解    │    │ 规划    │    │ 调度    │      │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘      │
│       │              │              │              │            │
│       ▼              ▼              ▼              ▼            │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐      │
│  │解析意图 │    │分解任务 │    │选择技能 │    │安排顺序 │      │
│  │提取约束 │    │识别依赖 │    │评估风险 │    │并行分组 │      │
│  └─────────┘    └─────────┘    └─────────┘    └─────────┘      │
│                                                                 │
│                      ┌─────────┐    ┌─────────┐                │
│                      │ 阶段5   │───▶│ 阶段6   │                │
│                      │ 验收    │    │ 反思    │                │
│                      └─────────┘    └─────────┘                │
│                           │              │                      │
│                           ▼              ▼                      │
│                      ┌─────────┐    ┌─────────┐                │
│                      │检查结果 │    │分析失败 │                │
│                      │收集问题 │    │提出改进 │                │
│                      └─────────┘    └─────────┘                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 各阶段详解

#### 阶段1: 理解 (Understanding)

**目标**：解析用户意图，提取核心需求

**输出**：
```typescript
interface Understanding {
  literalMeaning: string;    // 字面意思
  implicitIntent: string;    // 隐含意图
  context: Record<string, unknown>; // 上下文
  constraints: string[];     // 约束条件
  coreNeed: string;          // 核心需求
}
```

#### 阶段2: 拆解 (Decomposition)

**目标**：将复杂任务分解为原子任务

**输出**：
```typescript
interface Decomposition {
  tasks: Task[];
  dependencies: Record<string, string[]>;
  parallelGroups: string[][];
}
```

#### 阶段3: 规划 (Planning)

**目标**：为每个任务选择技能，评估风险

**输出**：
```typescript
interface Planning {
  skillSelections: SkillSelection[];
  executionOrder: string[];
  estimatedTime: number;
  risks: string[];
  needConfirm: boolean;
}
```

#### 阶段4: 调度 (Scheduling)

**目标**：安排执行顺序和并行策略

**输出**：
```typescript
interface Scheduling {
  executionId: string;
  parallelGroups: string[][];
  timeout: number;
  retryPolicy: RetryPolicy;
}
```

#### 阶段5: 验收 (Validation)

**目标**：检查执行结果

**输出**：
```typescript
interface Validation {
  passed: boolean;
  issues: string[];
  suggestions: string[];
  needRetry: boolean;
}
```

#### 阶段6: 反思 (Reflection)

**目标**：分析失败，提出改进

**输出**：
```typescript
interface Reflection {
  successRate: number;
  failureAnalysis: string;
  rootCauses: string[];
  improvements: string[];
}
```

### 3.3 动态重规划机制

当执行过程中发现最初的理解错误时，系统可动态调整计划。

**触发条件**：

| 条件 | 阈值 | 动作 |
|-----|------|------|
| 连续执行失败 | ≥2次 | 回退到理解阶段 |
| 结果偏差 | >30% | 回退到拆解阶段 |
| 能力缺口检测 | 检测到 | 触发自进化流程 |

**重规划流程**：

```typescript
class ReplanManager {
  needsReplanning(validation: Validation): boolean {
    // 连续失败超过阈值
    if (this.consecutiveFailures >= 2) return true;
    // 问题过多
    if (validation.issues?.length > 3) return true;
    return false;
  }
  
  generateReplanPrompt(originalUnderstanding: Understanding, validation: Validation): string {
    return `${originalUnderstanding.coreNeed}
    
注意: 之前的尝试失败了。
失败原因: ${validation.issues?.join(', ') || '未知'}
请重新分析并制定新的执行计划。`;
  }
}
```

### 3.4 上下文管理策略

#### Token预算管理

```typescript
interface TokenBudget {
  total: number;        // 总预算
  system: number;       // 系统提示词
  context: number;      // 上下文
  current: number;      // 当前任务
  reserved: number;     // 预留
}

// 默认预算分配
const DEFAULT_BUDGET: TokenBudget = {
  total: 4096,
  system: 500,      // 15%
  context: 1000,    // 25%
  current: 2000,    // 50%
  reserved: 596,    // 10%
};
```

#### 滑动窗口机制

```
完整历史:  [理解][拆解][规划][调度][执行][验收][反思]
滑动窗口:              [规划][调度][执行][验收]
压缩摘要:  [理解摘要][拆解摘要][规划输出]
```

---

## 第四章 技能系统

### 4.1 技能定义规范

#### 目录结构

```
skills/
├── {skill_name}/
│   ├── SKILL.md          # 技能定义（必需）
│   ├── main.py           # Python实现
│   ├── main.js           # JavaScript实现
│   └── run.sh            # Shell实现
```

#### SKILL.md格式

```markdown
---
name: skill_name
version: 1.0.0
description: 技能描述
capabilities:
  - capability1
risk_level: low
step_by_step: false
---

# 技能说明
...
```

### 4.2 技能加载机制

```typescript
class SkillLoader {
  async loadAll(): Promise<DynamicSkill[]>;
  private async loadSkill(skillPath: string): Promise<DynamicSkill | null>;
}
```

### 4.3 技能执行机制

**执行优先级**：Python > JavaScript > Shell

**跨平台兼容**：

| 平台 | Python命令 | 处理方式 |
|-----|-----------|---------|
| Windows | python | 检测+fallback |
| Linux/macOS | python3 | 直接执行 |

### 4.4 沙箱隔离

| 级别 | 实现方式 | 适用场景 |
|-----|---------|---------|
| L1 进程隔离 | Node.js spawn | 低风险技能 |
| L2 容器隔离 | Docker | 中风险技能 |
| L3 虚拟机隔离 | Firecracker | 高风险技能 |

### 4.5 资源锁机制

```typescript
class ResourceLockManager {
  async acquire(resource: string, type: 'read' | 'write', taskId: string): Promise<boolean>;
  release(resource: string, taskId: string): void;
}
```

**锁类型**：

| 锁类型 | 说明 | 兼容性 |
|-------|------|--------|
| 读锁 | 共享锁 | 读锁+读锁 |
| 写锁 | 排他锁 | 独占 |

---

## 第五章 执行层

### 5.1 并行执行策略

```typescript
class ParallelExecutor {
  async execute(tasks: Task[], parallelGroups: string[][]): Promise<ExecutionResult>;
  async executeStepByStep(tasks: Task[], stepCallback: StepCallback): Promise<ExecutionResult>;
}
```

### 5.2 step_by_step模式

某些复杂任务需要逐步执行，每步完成后与思考层通讯。

**触发条件**：技能定义中设置 `step_by_step: true`

### 5.3 错误恢复

```typescript
interface RetryPolicy {
  maxRetries: number;      // 最大重试次数
  initialDelay: number;    // 初始延迟
  maxDelay: number;        // 最大延迟
  backoffMultiplier: number; // 退避乘数
  retryableErrors: string[]; // 可重试错误
}

class RetryExecutor {
  async execute(task: Task, executor: Function): Promise<TaskResult>;
}
```

**重试策略**：

| 错误类型 | 是否重试 | 延迟策略 |
|---------|---------|---------|
| timeout | 是 | 指数退避 |
| network | 是 | 指数退避 |
| rate limit | 是 | 指数退避 |
| validation | 否 | - |
| permission | 否 | - |

---

## 第六章 调度层

### 6.1 任务调度器

```typescript
class DAGScheduler {
  buildDAG(tasks: Task[], locks: Map<string, string[]>): DAG;
  topologicalSort(dag: DAG): string[];
}
```

### 6.2 主动任务系统

| 触发类型 | 说明 | 示例 |
|---------|------|------|
| 时间触发 | 定时执行 | 每天早上8点提醒 |
| 事件触发 | 事件驱动 | 收到邮件时通知 |
| 条件触发 | 条件满足时 | 文件变化时备份 |

```typescript
interface ProactiveTask {
  id: string;
  type: 'time' | 'event' | 'condition';
  triggerConfig: Record<string, unknown>;
  actionConfig: Record<string, unknown>;
  status: TaskStatus;
}
```

---

## 第七章 记忆系统

### 7.1 三层记忆架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     三层记忆架构                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   情景记忆 (Episodic)                    │   │
│  │  存储具体的事件和对话，按时间顺序组织                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                  声明式记忆 (Declarative)                │   │
│  │  存储事实知识和用户偏好，以键值对形式组织                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                  程序性记忆 (Procedural)                 │   │
│  │  存储技能和流程，以过程形式组织                           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 7.2 五维度学习

| 维度 | 说明 | 存储位置 |
|-----|------|---------|
| 用户偏好学习 | 记录用户偏好 | 声明式记忆 |
| 任务模式学习 | 记录成功模式 | 程序性记忆 |
| 错误恢复学习 | 记录解决方案 | 程序性记忆 |
| 技能进化学习 | 优化技能参数 | 程序性记忆 |
| 知识积累学习 | 持续学习知识 | 声明式记忆 |

### 7.3 记忆管理

```typescript
class MemorySystem {
  // 情景记忆
  recordEpisode(type: string, content: string): void;
  getEpisodes(type?: string, limit?: number): EpisodicMemory[];
  
  // 声明式记忆
  remember(key: string, value: string, confidence?: number): void;
  recall(key: string): DeclarativeMemory | null;
  
  // 程序性记忆
  learnProcedure(key: string, procedure: string): void;
  getProcedure(key: string): ProceduralMemory | null;
}
```

### 7.4 记忆回滚

```typescript
class MemoryRollback {
  createSnapshot(trigger: string): MemorySnapshot;
  rollback(snapshotId: string): boolean;
  listSnapshots(limit?: number): MemorySnapshot[];
}
```

---

## 第八章 安全系统

### 8.1 安全边界

```
┌─────────────────────────────────────────────────────────────────┐
│                     安全边界设计                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    禁止区域 (DENIED)                     │   │
│  │  core/ security/ config/system.yaml                      │   │
│  │  行为: 拒绝所有修改请求                                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    限制区域 (CONFIRM)                    │   │
│  │  skills/ prompts/ memory/                                │   │
│  │  行为: 需要用户确认后才能修改                            │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    自由区域 (AUTO)                       │   │
│  │  data/ logs/ temp/                                       │   │
│  │  行为: 自动执行，无需确认                                │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 8.2 权限控制

| 角色 | 权限 |
|-----|------|
| guest | chat |
| user | chat, execute_skill, view_memory |
| developer | user + manage_skills |
| admin | 所有权限 |

### 8.3 审计日志

```typescript
interface AuditLog {
  id: number;
  userId: string;
  action: string;
  resource: string;
  result: string;
  timestamp: Date;
  details: Record<string, unknown>;
}
```

---

## 第九章 自进化系统

### 9.1 概述

自进化系统是白泽3.0的核心能力之一，使系统能够：

1. **检测能力缺口** - 识别当前无法完成的任务
2. **自主获取能力** - 从技能市场安装或自主开发
3. **安全进化** - 通过角色化思考确保安全
4. **可回滚** - 支持进化失败后恢复

```
┌─────────────────────────────────────────────────────────────────┐
│                     自进化系统架构                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                      ┌─────────────┐                            │
│                      │  用户请求   │                            │
│                      └─────────────┘                            │
│                            │                                    │
│                            ▼                                    │
│                 ┌──────────────────┐                            │
│                 │   思考引擎       │                            │
│                 └──────────────────┘                            │
│                            │                                    │
│                            ▼                                    │
│                 ┌──────────────────┐                            │
│                 │  能力缺口检测    │◄─────────────────┐         │
│                 └──────────────────┘                  │         │
│                            │                          │         │
│              ┌─────────────┴─────────────┐           │         │
│              ▼                           ▼           │         │
│     ┌────────────────┐          ┌────────────────┐   │         │
│     │  无缺口        │          │  检测到缺口    │   │         │
│     │  正常执行      │          └────────────────┘   │         │
│     └────────────────┘                  │           │         │
│                                         ▼           │         │
│                              ┌──────────────────┐   │         │
│                              │  技能市场搜索    │   │         │
│                              └──────────────────┘   │         │
│                                         │           │         │
│                         ┌───────────────┴───────┐   │         │
│                         ▼                       ▼   │         │
│                  ┌────────────┐         ┌────────────┐│         │
│                  │ 找到技能   │         │ 未找到     ││         │
│                  └────────────┘         └────────────┘│         │
│                         │                       │    │         │
│                         ▼                       ▼    │         │
│                  ┌────────────┐         ┌────────────┐│         │
│                  │ 用户确认   │         │ 自主开发   ││         │
│                  │ 安装技能   │         │ 新技能     ││         │
│                  └────────────┘         └────────────┘│         │
│                         │                       │    │         │
│                         └───────────┬───────────┘    │         │
│                                     ▼                │         │
│                           ┌──────────────────┐       │         │
│                           │  角色化思考审批  │       │         │
│                           └──────────────────┘       │         │
│                                     │                │         │
│                                     ▼                │         │
│                           ┌──────────────────┐       │         │
│                           │  安装/执行技能   │───────┘         │
│                           └──────────────────┘                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 9.2 能力缺口检测

#### 检测机制

```typescript
interface CapabilityGap {
  id: string;
  detectedAt: Date;
  userInput: string;
  understanding: Understanding;
  missingCapabilities: string[];
  suggestedSkills: string[];
  confidence: number;
  resolution: 'pending' | 'installing' | 'developing' | 'resolved' | 'rejected';
}

class CapabilityGapDetector {
  async detect(understanding: Understanding, availableSkills: Skill[]): Promise<CapabilityGap | null>;
}
```

#### 触发条件

| 条件 | 说明 | 置信度 |
|-----|------|--------|
| 无匹配技能 | 任务类型无对应技能 | 高 |
| 技能执行失败 | 现有技能无法完成任务 | 中 |
| 用户显式请求 | 用户明确要求新能力 | 高 |
| 频繁失败模式 | 同类任务多次失败 | 中 |

#### 决策流程

```
检测到能力缺口
    ↓
评估置信度
    ↓
置信度 >= 0.8 → 直接提示用户
    ↓
用户确认
    ↓
搜索技能市场
    ├── 找到 → 提示安装
    └── 未找到 → 提示开发
```

### 9.3 技能市场集成

#### 市场架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     技能市场架构                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   技能市场服务端                         │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │   │
│  │  │ 技能仓库    │  │ 搜索引擎    │  │ 安全扫描    │      │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                            ▲ HTTPS                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                   技能市场客户端                         │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │   │
│  │  │ 搜索接口    │  │ 下载管理    │  │ 本地缓存    │      │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### 客户端接口

```typescript
interface SkillMarketClient {
  search(query: string, options?: SearchOptions): Promise<SkillSearchResult[]>;
  getSkillDetails(skillId: string): Promise<SkillDetails>;
  download(skillId: string, version?: string): Promise<SkillPackage>;
  install(pkg: SkillPackage): Promise<InstallResult>;
}

interface SkillSearchResult {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  downloads: number;
  rating: number;
  verified: boolean;
  versions: string[];
}
```

#### 安全验证

```typescript
class SkillSecurityValidator {
  async validate(pkg: SkillPackage): Promise<ValidationResult> {
    const checks = [
      this.checkSignature(pkg),      // 数字签名验证
      this.checkDependencies(pkg),   // 依赖安全检查
      this.checkCodeAnalysis(pkg),   // 静态代码分析
      this.checkPermissions(pkg),    // 权限检查
    ];
    
    return { passed: results.every(r => r.passed), issues: [...] };
  }
}
```

#### 安装流程

```
1. 用户确认安装
2. 下载技能包
3. 安全验证
4. 解压到skills目录
5. 注册到技能注册表
6. 记录安装历史
7. 通知用户安装完成
```

### 9.4 角色化思考

```
┌─────────────────────────────────────────────────────────────────┐
│                     角色团队设计                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐           │
│  │产品经理 │  │ 开发者  │  │ 测试者  │  │安全审计 │           │
│  │  PM     │  │  Dev    │  │ Tester  │  │ Auditor │           │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘           │
│       │            │            │            │                  │
│       ▼            ▼            ▼            ▼                  │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐           │
│  │需求分析 │  │代码生成 │  │功能测试 │  │安全扫描 │           │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 9.5 进化流程

```
触发方式: 用户请求 / 能力缺口检测 / 技能市场发现
    ↓
产品经理: 分析需求
    ↓
开发者: 生成代码
    ↓
测试者: 功能测试
    ↓
安全审计员: 安全扫描
    ↓
审查员: 代码审查
    ↓
用户: 最终确认
    ↓
执行安装
    ↓
记录进化历史
```

### 9.6 安全审计机制

- 静态代码扫描
- 红队测试
- 依赖安全检查

### 9.7 回滚机制

```typescript
class EvolutionRollback {
  async createCheckpoint(requestId: string): Promise<Checkpoint>;
  async rollback(checkpointId: string): Promise<void>;
}
```

### 9.8 用户确认策略

| 场景 | 确认方式 | 说明 |
|-----|---------|------|
| 安装市场技能 | 单次确认 | 显示技能信息和风险等级 |
| 自主开发技能 | 详细确认 | 显示代码和测试结果 |
| 高风险技能 | 强制确认 | 需要用户明确同意 |
| 低风险技能 | 可配置 | 用户可设置自动安装 |

---

## 第十章 可观测性

### 10.1 日志系统

```typescript
class BaizeLogger {
  static setup(): void;
}
```

### 10.2 分布式追踪

```typescript
class TracingManager {
  startTrace(metadata?: Record<string, unknown>): string;
  startSpan(name: string, metadata?: Record<string, unknown>): string;
}
```

### 10.3 性能指标

| 指标 | 说明 | 目标值 |
|-----|------|--------|
| 意图识别准确率 | 正确识别用户意图的比例 | >95% |
| 任务拆解成功率 | 正确拆解复杂任务的比例 | >90% |
| 技能执行成功率 | 技能正确执行的比例 | >95% |

---

## 第十一章 交互层

### 11.1 CLI交互

```bash
baize start          # 启动交互模式
baize chat "你好"    # 单次对话
baize skill list     # 列出技能
baize skill install weather  # 安装技能
```

### 11.2 HTTP API

| 端点 | 方法 | 说明 |
|-----|------|------|
| /health | GET | 健康检查 |
| /api/chat | POST | 对话 |
| /api/skills | GET | 技能列表 |
| /api/skills/install | POST | 安装技能 |
| /api/market/search | GET | 搜索技能市场 |

### 11.3 思考过程可视化

```typescript
interface ThinkingProgress {
  phase: 'understanding' | 'decomposing' | 'planning' | 'scheduling' | 'executing' | 'validating';
  message: string;
  progress: number;
}
```

---

## 第十二章 上下文管理

### 12.1 Token预算分配

```
总预算: 4096 tokens
├── 系统提示词: 500 tokens (15%)
├── 上下文历史: 1000 tokens (25%)
├── 当前任务: 2000 tokens (50%)
└── 预留: 596 tokens (10%)
```

### 12.2 上下文压缩策略

| 内容类型 | 压缩方式 | 压缩比 |
|---------|---------|--------|
| 对话历史 | 摘要提取 | 10:1 |
| 任务列表 | 仅保留ID和状态 | 5:1 |
| 错误信息 | 仅保留关键错误 | 8:1 |

### 12.3 语义缓存

```typescript
class SemanticCache {
  async get(query: string, threshold?: number): Promise<string | null>;
  async set(query: string, response: string, ttl?: number): Promise<void>;
}
```

---

## 第十三章 成本控制

### 13.1 预算配置

```typescript
interface CostConfig {
  dailyBudget: number;      // 每日预算（美元）
  perTaskBudget: number;    // 单任务预算
  alertThreshold: number;   // 告警阈值（百分比）
  hardLimit: boolean;       // 是否硬限制
}

const DEFAULT_CONFIG: CostConfig = {
  dailyBudget: 10,          // $10/天
  perTaskBudget: 0.5,       // $0.5/任务
  alertThreshold: 80,       // 80%告警
  hardLimit: true,          // 超限拒绝
};
```

### 13.2 成本追踪

```typescript
class CostManager {
  canProceed(estimatedTokens: number, model: string): boolean;
  recordUsage(provider: string, model: string, inputTokens: number, outputTokens: number): CostRecord;
  getStats(): CostStats;
}
```

### 13.3 模型定价

| 模型 | 输入价格 ($/1K tokens) | 输出价格 ($/1K tokens) |
|-----|----------------------|----------------------|
| qwen-max | 0.002 | 0.006 |
| qwen-plus | 0.0004 | 0.0012 |
| glm-4 | 0.001 | 0.001 |
| gpt-4 | 0.03 | 0.06 |

---

## 第十四章 状态管理

### 14.1 Agent状态

```typescript
interface AgentState {
  conversationId: string;
  currentPhase: 'thinking' | 'executing' | 'waiting' | 'completed';
  thoughtProcess: ThoughtProcess;
  executedTasks: TaskResult[];
  pendingTasks: Task[];
  createdAt: Date;
  updatedAt: Date;
}
```

### 14.2 状态持久化

```typescript
class StateManager {
  save(state: AgentState): void;
  restore(conversationId: string): AgentState | null;
  listIncomplete(): AgentState[];
  markComplete(conversationId: string): void;
}
```

---

## 第十五章 评测体系

### 15.1 基准测试集

```typescript
interface BenchmarkCase {
  id: string;
  category: string;
  input: string;
  expectedOutput: ExpectedOutput;
  evaluationCriteria: EvaluationCriteria;
}
```

### 15.2 评测指标

| 指标 | 说明 | 目标值 |
|-----|------|--------|
| 意图识别准确率 | 正确识别用户意图的比例 | >95% |
| 任务拆解成功率 | 正确拆解复杂任务的比例 | >90% |
| 技能执行成功率 | 技能正确执行的比例 | >95% |
| 端到端成功率 | 完整任务成功完成的比例 | >85% |

---

## 第十六章 运维与部署

### 16.1 部署架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     部署架构                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    负载均衡器                            │   │
│  └─────────────────────────────────────────────────────────┘   │
│                            │                                    │
│         ┌──────────────────┼──────────────────┐                │
│         ▼                  ▼                  ▼                │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐        │
│  │  白泽实例1  │    │  白泽实例2  │    │  白泽实例3  │        │
│  └─────────────┘    └─────────────┘    └─────────────┘        │
│                            │                                    │
│                            ▼                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    共享存储                              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 16.2 灰度发布

```typescript
class CanaryDeployer {
  async deploy(newVersion: string, config: CanaryConfig): Promise<void>;
}
```

---

## 第十七章 数据类型定义

### 17.1 枚举类型

```typescript
enum TaskStatus { PENDING, RUNNING, COMPLETED, FAILED, CANCELLED }
enum RiskLevel { LOW, MEDIUM, HIGH, CRITICAL }
enum EvolutionPermission { DENIED, CONFIRM, AUTO }
```

### 17.2 核心接口

```typescript
interface ThoughtProcess { understanding, decomposition, planning, scheduling, validation, reflection }
interface Task { id, description, type, skillName, params, riskLevel, dependencies }
interface SkillResult { success, data, message, error }
interface CapabilityGap { id, missingCapabilities, suggestedSkills, confidence, resolution }
interface AgentState { conversationId, currentPhase, thoughtProcess, executedTasks, pendingTasks }
interface CostConfig { dailyBudget, perTaskBudget, alertThreshold, hardLimit }
```

---

## 第十八章 开发路线图

### 18.1 里程碑规划

```
M1: 核心框架 ✅
M2: 思考引擎 ✅
M3: 技能系统 ✅
M4: 记忆系统 ✅
M5: 安全系统 ✅
M6: 自进化系统 ✅
    ├── 角色化思考 ✅
    ├── 能力缺口检测 ✅
    ├── 技能市场集成 ✅
    └── 安全审计 ✅
M7: 基础设施 ✅
    ├── 上下文管理 ✅
    ├── 成本控制 ✅
    ├── 状态管理 ✅
    ├── 资源锁 ✅
    ├── 语义缓存 ✅
    └── 记忆回滚 ✅
M8: 评测体系 (计划中)
M9: 生产就绪 (计划中)
```

### 18.2 版本规划

| 版本 | 发布时间 | 主要特性 |
|-----|---------|---------|
| v3.0.0 | 2025 Q1 | 核心架构、六阶段思考、动态技能 |
| v3.0.1 | 2025 Q1 | 能力缺口检测、技能市场设计 |
| v3.0.2 | 2025 Q1 | 上下文管理、成本控制、状态管理 |
| v3.1.0 | 2025 Q2 | 完善自进化、评测体系 |
| v3.2.0 | 2025 Q3 | 多模态、多Agent |
| v3.3.0 | 2025 Q4 | 技能市场公测、生产就绪 |

---

## 附录

### A. 配置文件示例

#### A.1 系统配置 (config/system.yaml)

```yaml
version: "3.0"
name: "白泽"
mode: "production"

logging:
  level: "info"
  file: "logs/baize.log"

database:
  path: "data/baize.db"

executor:
  maxWorkers: 5
  timeout: 300000
```

#### A.2 LLM配置 (config/llm.yaml)

```yaml
default: "aliyun"

providers:
  aliyun:
    enabled: true
    type: "openai-compatible"
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
    model: "qwen-max"

costControl:
  dailyBudget: 10
  perTaskBudget: 0.5
  alertThreshold: 80
  hardLimit: true
```

#### A.3 进化配置 (config/evolution.yaml)

```yaml
evolution:
  enabled: true
  
  capabilityGapDetection:
    enabled: true
    confidenceThreshold: 0.8
    autoPrompt: true
  
  skillMarket:
    enabled: true
    endpoint: "https://market.baize.ai"
    autoInstall: false
    verifiedOnly: true
  
  permissions:
    - path: "core/"
      permission: "denied"
    - path: "skills/"
      permission: "confirm"
```

### B. 技能开发指南

#### B.1 创建新技能

```bash
mkdir -p skills/my_skill
```

#### B.2 SKILL.md模板

```markdown
---
name: my_skill
description: 我的技能
capabilities:
  - my_capability
risk_level: low
---

# 功能说明
...
```

### C. API参考

| 端点 | 方法 | 说明 |
|-----|------|------|
| /health | GET | 健康检查 |
| /api/chat | POST | 对话 |
| /api/skills | GET | 技能列表 |
| /api/skills/install | POST | 安装技能 |
| /api/market/search | GET | 搜索市场 |

---

## 文档修订历史

| 版本 | 日期 | 修订内容 |
|-----|------|---------|
| 3.0.0 | 2025-02-22 | 初始版本 |
| 3.0.1 | 2025-02-23 | 新增能力缺口检测、技能市场集成章节 |
| 3.0.2 | 2025-02-23 | 新增上下文管理、成本控制、状态管理等章节，完善所有P0/P1功能 |

---

**文档结束**

*白泽3.0 - 让AI真正成为你的智能助手*
