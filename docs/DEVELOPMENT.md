# 白泽3.0 开发文档

**版本**: 3.0.2  
**适用对象**: 二次开发者、系统维护者  
**最后更新**: 2025年2月

---

## 目录

1. [开发环境搭建](#1-开发环境搭建)
2. [项目结构](#2-项目结构)
3. [核心模块详解](#3-核心模块详解)
4. [扩展开发指南](#4-扩展开发指南)
5. [调试与测试](#5-调试与测试)
6. [性能优化](#6-性能优化)
7. [常见问题](#7-常见问题)

---

## 1. 开发环境搭建

### 1.1 系统要求

| 要求 | 说明 |
|-----|------|
| Node.js | >= 18.0.0 |
| npm | >= 9.0.0 |
| Python | >= 3.8（可选，用于Python技能） |
| 操作系统 | Windows / Linux / macOS |

### 1.2 安装步骤

```bash
# 1. 克隆仓库
git clone https://github.com/your-repo/baize-nodejs.git
cd baize-nodejs

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env 文件，填入 API Key

# 4. 编译项目
npm run build

# 5. 运行测试
npm test

# 6. 启动系统
npm start
```

### 1.3 开发工具推荐

| 工具 | 用途 |
|-----|------|
| VS Code | 代码编辑器 |
| TypeScript 扩展 | 类型检查 |
| ESLint | 代码规范 |
| Prettier | 代码格式化 |
| SQLite Viewer | 数据库查看 |

### 1.4 VS Code 配置

```json
// .vscode/settings.json
{
  "typescript.tsdk": "node_modules/typescript/lib",
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "typescript.preferences.importModuleSpecifier": "relative"
}
```

---

## 2. 项目结构

### 2.1 目录结构

```
baize-nodejs/
├── config/                    # 配置文件
│   ├── system.yaml           # 系统配置
│   ├── llm.yaml              # LLM配置
│   ├── evolution.yaml        # 进化配置
│   └── user.yaml             # 用户配置
│
├── src/                      # 源代码
│   ├── cli/                  # CLI交互层
│   ├── core/                 # 核心模块
│   │   ├── brain/           # 大脑（决策中心）
│   │   ├── confirmation/    # 确认管理
│   │   ├── context/         # 上下文管理
│   │   ├── cost/            # 成本控制
│   │   ├── state/           # 状态管理
│   │   └── thinking/        # 思考引擎
│   ├── evolution/            # 自进化系统
│   │   ├── approval/        # 审批流程
│   │   ├── executor/        # 进化执行
│   │   ├── gap/             # 能力缺口检测
│   │   ├── permission/      # 权限管理
│   │   └── team/            # 角色团队
│   ├── executor/             # 执行层
│   ├── interaction/          # 交互层（HTTP API）
│   ├── knowledge/            # 知识层
│   ├── llm/                  # LLM管理
│   │   └── providers/       # LLM提供商
│   ├── memory/               # 记忆系统
│   ├── observability/        # 可观测性
│   ├── scheduler/            # 调度层
│   ├── security/             # 安全系统
│   ├── skills/               # 技能系统
│   │   ├── builtin/         # 内置技能
│   │   ├── loader.ts        # 技能加载器
│   │   ├── market/          # 技能市场
│   │   └── registry.ts      # 技能注册表
│   ├── types/                # 类型定义
│   └── utils/                # 工具函数
│
├── skills/                   # 技能目录
│   ├── chat/                # 对话技能
│   ├── file/                # 文件技能
│   ├── fs/                  # 文件系统技能
│   └── time/                # 时间技能
│
├── data/                     # 数据目录
│   └── baize.db             # SQLite数据库
│
├── logs/                     # 日志目录
│
├── tests/                    # 测试文件
│
├── docs/                     # 文档
│
├── dist/                     # 编译输出
│
├── package.json
├── tsconfig.json
└── README.md
```

### 2.2 模块依赖关系

```
┌─────────────────────────────────────────────────────────────────┐
│                        模块依赖关系                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  CLI ──────► Brain ──────► ThinkingEngine                       │
│    │            │                │                              │
│    │            ▼                ▼                              │
│    │      Confirmation      LLMManager                          │
│    │            │                │                              │
│    │            ▼                ▼                              │
│    └──────► Executor ◄────► SkillRegistry                       │
│                  │                │                              │
│                  ▼                ▼                              │
│             Scheduler ◄────► SkillLoader                        │
│                  │                                              │
│                  ▼                                              │
│              Memory ◄────► Database                             │
│                  │                                              │
│                  ▼                                              │
│             Security                                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. 核心模块详解

### 3.1 思考引擎 (ThinkingEngine)

**位置**: `src/core/thinking/engine.ts`

**职责**: 实现六阶段思考协议

**核心方法**:

```typescript
class ThinkingEngine {
  /**
   * 处理用户输入
   * @param userInput 用户输入
   * @param context 上下文
   * @returns 思考过程
   */
  async process(userInput: string, context?: Record<string, unknown>): Promise<ThoughtProcess>;

  /**
   * 阶段1: 理解
   */
  private async understand(userInput: string, context: Record<string, unknown>): Promise<Understanding>;

  /**
   * 阶段2: 拆解
   */
  private async decompose(understanding: Understanding, context: Record<string, unknown>): Promise<Decomposition>;

  /**
   * 阶段3: 规划
   */
  private async plan(understanding: Understanding, decomposition: Decomposition, context: Record<string, unknown>): Promise<Planning>;

  /**
   * 阶段4: 调度
   */
  private schedule(decomposition: Decomposition): Scheduling;

  /**
   * 阶段5: 验收
   */
  async validate(thoughtProcess: ThoughtProcess, taskResults: TaskResult[]): Promise<Validation>;

  /**
   * 阶段6: 反思
   */
  async reflect(thoughtProcess: ThoughtProcess, validation: Validation): Promise<Reflection>;
}
```

**使用示例**:

```typescript
import { ThinkingEngine } from './core/thinking/engine';

const engine = new ThinkingEngine();

// 处理用户输入
const thought = await engine.process('帮我创建一个文件');

console.log(thought.understanding.coreNeed);  // 核心需求
console.log(thought.decomposition.tasks);      // 任务列表
console.log(thought.planning.needConfirm);     // 是否需要确认
```

### 3.2 技能系统

**位置**: `src/skills/`

**核心组件**:

| 组件 | 文件 | 职责 |
|-----|------|------|
| SkillLoader | `loader.ts` | 动态加载技能 |
| SkillRegistry | `registry.ts` | 技能注册和查找 |
| DynamicSkill | `base.ts` | 技能基类 |

**技能加载流程**:

```typescript
import { getSkillLoader } from './skills/loader';
import { getSkillRegistry } from './skills/registry';

// 加载所有技能
const loader = getSkillLoader();
const skills = await loader.loadAll();

// 注册到注册表
const registry = getSkillRegistry();
for (const skill of skills) {
  registry.register(skill);
}

// 查找技能
const chatSkill = registry.get('chat');
const fileSkills = registry.findByCapability('file');
```

### 3.3 记忆系统

**位置**: `src/memory/`

**核心方法**:

```typescript
import { getMemory } from './memory';

const memory = getMemory();

// 情景记忆
memory.recordEpisode('conversation', '用户问了天气');
const episodes = memory.getEpisodes('conversation', 10);

// 声明式记忆
memory.remember('user.preference.language', '中文', 0.9);
const lang = memory.recall('user.preference.language');

// 程序性记忆
memory.learnProcedure('create_file', '1.检查路径 2.创建文件');
const procedure = memory.getProcedure('create_file');

// 信任记录
memory.recordSuccess('file.create');
memory.recordFailure('file.delete');
const canSkip = memory.canSkipConfirm('file.create');
```

### 3.4 LLM管理器

**位置**: `src/llm/`

**使用方法**:

```typescript
import { getLLMManager } from './llm';

const llm = getLLMManager();

// 获取可用提供商
const providers = llm.getAvailableProviders();
// ['aliyun', 'ollama']

// 调用LLM
const response = await llm.chat([
  { role: 'system', content: '你是一个助手' },
  { role: 'user', content: '你好' }
], { temperature: 0.7 });

console.log(response.content);
console.log(response.usage);  // Token使用量
```

### 3.5 执行器

**位置**: `src/executor/`

**使用方法**:

```typescript
import { getExecutor } from './executor';

const executor = getExecutor();

// 执行任务
const result = await executor.execute(
  tasks,           // 任务列表
  parallelGroups,  // 并行分组
  context          // 执行上下文
);

console.log(result.success);
console.log(result.taskResults);
console.log(result.finalMessage);
```

---

## 4. 扩展开发指南

### 4.1 开发新技能

#### 步骤1: 创建技能目录

```bash
mkdir -p skills/my_skill
```

#### 步骤2: 创建SKILL.md

```markdown
---
name: my_skill
version: 1.0.0
description: 我的自定义技能
capabilities:
  - my_capability
  - custom_action
risk_level: low
step_by_step: false
---

# 我的技能

## 功能说明
这个技能用于...

## 参数说明
- param1: 参数1说明
- param2: 参数2说明

## 使用示例
用户说: "帮我执行xxx"
系统调用: my_skill
```

#### 步骤3: 创建实现文件

**JavaScript实现** (`main.js`):

```javascript
#!/usr/bin/env node
/**
 * 我的技能 - JavaScript实现
 */

function main() {
  try {
    // 获取参数
    let input = {};
    
    if (process.env.BAIZE_PARAMS) {
      input = JSON.parse(process.env.BAIZE_PARAMS);
    }
    
    const { params = {} } = input;
    const { param1, param2 } = params;
    
    // 执行技能逻辑
    const result = doSomething(param1, param2);
    
    // 返回结果
    console.log(JSON.stringify({
      success: true,
      data: result,
      message: '执行成功'
    }));
    
  } catch (error) {
    console.log(JSON.stringify({
      success: false,
      error: error.message
    }));
    process.exit(1);
  }
}

function doSomething(param1, param2) {
  // 技能逻辑
  return { result: 'done' };
}

main();
```

**Python实现** (`main.py`):

```python
#!/usr/bin/env python3
"""
我的技能 - Python实现
"""

import os
import sys
import json

def main():
    try:
        # 获取参数
        params = {}
        
        if 'BAIZE_PARAMS' in os.environ:
            input_data = json.loads(os.environ['BAIZE_PARAMS'])
            params = input_data.get('params', {})
        
        param1 = params.get('param1')
        param2 = params.get('param2')
        
        # 执行技能逻辑
        result = do_something(param1, param2)
        
        # 返回结果
        print(json.dumps({
            'success': True,
            'data': result,
            'message': '执行成功'
        }))
        
    except Exception as e:
        print(json.dumps({
            'success': False,
            'error': str(e)
        }))
        sys.exit(1)

def do_something(param1, param2):
    # 技能逻辑
    return {'result': 'done'}

if __name__ == '__main__':
    main()
```

#### 步骤4: 测试技能

```bash
# 直接测试
echo '{"params":{"param1":"value1"}}' | node skills/my_skill/main.js

# 通过系统测试
npm start
# 输入: 帮我执行xxx
```

### 4.2 添加新的LLM提供商

#### 步骤1: 创建提供商类

```typescript
// src/llm/providers/my-provider.ts

import { BaseLLMProvider } from '../base';
import { LLMMessage, LLMResponse, LLMProviderConfig } from '../../types';

export class MyProvider extends BaseLLMProvider {
  private config: LLMProviderConfig;

  constructor(config: LLMProviderConfig) {
    super(config);
    this.config = config;
  }

  async chat(messages: LLMMessage[], options?: Record<string, unknown>): Promise<LLMResponse> {
    // 实现调用逻辑
    const response = await fetch(this.config.baseURL + '/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        messages,
        model: this.config.model,
        ...options,
      }),
    });

    const data = await response.json();

    return {
      content: data.choices[0].message.content,
      usage: {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      },
      model: this.config.model,
      provider: 'my-provider',
    };
  }
}
```

#### 步骤2: 注册提供商

```typescript
// src/llm/index.ts

import { MyProvider } from './providers/my-provider';

// 在 createProvider 方法中添加
case 'my-provider':
  return new MyProvider(config);
```

#### 步骤3: 配置提供商

```yaml
# config/llm.yaml
providers:
  my-provider:
    enabled: true
    type: 'my-provider'
    baseURL: 'https://api.my-provider.com'
    model: 'my-model'
    apiKey: '${MY_PROVIDER_API_KEY}'
```

### 4.3 扩展思考引擎

#### 添加新的思考阶段

```typescript
// src/core/thinking/engine.ts

// 添加新阶段方法
private async newPhase(thoughtProcess: ThoughtProcess): Promise<NewPhaseResult> {
  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: '你是一个...',
    },
    {
      role: 'user',
      content: `...`,
    },
  ];

  const response = await this.llm.chat(messages);
  return this.parseJSON(response.content);
}

// 在 process 方法中调用
async process(userInput: string, context: Record<string, unknown>): Promise<ThoughtProcess> {
  // ... 现有阶段
  
  // 添加新阶段
  const newPhaseResult = await this.newPhase(thoughtProcess);
  
  return {
    ...thoughtProcess,
    newPhase: newPhaseResult,
  };
}
```

---

## 5. 调试与测试

### 5.1 日志调试

```typescript
import { getLogger } from './observability/logger';

const logger = getLogger('my-module');

logger.debug('调试信息', { data });
logger.info('普通信息');
logger.warn('警告信息');
logger.error('错误信息', { error });
```

### 5.2 运行测试

```bash
# 运行所有测试
npm test

# 运行特定测试
npx mocha tests/skills.test.ts

# 测试覆盖率
npx nyc npm test
```

### 5.3 单元测试示例

```typescript
// tests/thinking.test.ts

import { describe, it, expect } from 'vitest';
import { ThinkingEngine } from '../src/core/thinking/engine';

describe('ThinkingEngine', () => {
  it('should understand user input', async () => {
    const engine = new ThinkingEngine();
    const thought = await engine.process('你好');
    
    expect(thought.understanding).toBeDefined();
    expect(thought.understanding.coreNeed).toContain('问候');
  });
});
```

### 5.4 调试技巧

```bash
# 设置日志级别
export LOG_LEVEL=debug

# 查看数据库
sqlite3 data/baize.db ".tables"
sqlite3 data/baize.db "SELECT * FROM episodic_memory LIMIT 10;"

# 监控日志
tail -f logs/baize.log
```

---

## 6. 性能优化

### 6.1 Token优化

```typescript
// 使用上下文管理器控制Token
import { getContextManager } from './core/context';

const contextManager = getContextManager();

// 检查Token预算
if (!contextManager.isOverBudget(estimatedTokens)) {
  // 执行LLM调用
}

// 压缩上下文
contextManager.compress();
```

### 6.2 缓存优化

```typescript
// 使用语义缓存
import { getSemanticCache } from './core/cache';

const cache = getSemanticCache();

// 先查缓存
const cached = await cache.get(query);
if (cached) {
  return cached;
}

// 调用LLM
const response = await llm.chat(messages);

// 存入缓存
await cache.set(query, response.content);
```

### 6.3 并行执行

```typescript
// 使用并行执行器
import { getExecutor } from './executor';

const executor = getExecutor();

// 任务会按并行组执行
const result = await executor.execute(tasks, parallelGroups);
```

---

## 7. 常见问题

### Q1: 如何添加新的配置项？

```typescript
// 1. 在 config/ 目录添加配置文件
// 2. 在代码中加载配置
import YAML from 'yaml';
import fs from 'fs';

const config = YAML.parse(fs.readFileSync('config/my-config.yaml', 'utf-8'));
```

### Q2: 如何修改数据库结构？

```typescript
// 在 src/memory/database.ts 中添加新表
this.db.run(`
  CREATE TABLE IF NOT EXISTS my_table (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL
  )
`);
```

### Q3: 如何自定义错误处理？

```typescript
import { BaizeError, ErrorCategory } from './core/error';

throw new BaizeError(
  '自定义错误',
  ErrorCategory.CUSTOM,
  ErrorSeverity.HIGH
);
```

### Q4: 如何添加新的API端点？

```typescript
// 在 src/interaction/api.ts 中添加
app.post('/api/my-endpoint', async (req, res) => {
  const result = await myHandler(req.body);
  res.json(result);
});
```

---

## 附录

### A. npm 脚本

| 脚本 | 命令 | 说明 |
|-----|------|------|
| start | `npm start` | 启动系统 |
| build | `npm run build` | 编译项目 |
| test | `npm test` | 运行测试 |
| lint | `npm run lint` | 代码检查 |

### B. 环境变量

| 变量 | 说明 |
|-----|------|
| ALIYUN_API_KEY | 阿里云API密钥 |
| ZHIPU_API_KEY | 智谱API密钥 |
| LOG_LEVEL | 日志级别 |
| NODE_ENV | 运行环境 |

### C. 相关链接

- [架构设计文档](./architecture.md)
- [API文档](./API.md)
- [贡献指南](./CONTRIBUTING.md)
