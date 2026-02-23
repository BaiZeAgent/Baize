# 白泽3.0 贡献指南

**版本**: 3.0.2  
**适用对象**: 开发者、贡献者  
**最后更新**: 2025年2月

---

## 目录

1. [贡献概述](#1-贡献概述)
2. [开发流程](#2-开发流程)
3. [代码规范](#3-代码规范)
4. [提交规范](#4-提交规范)
5. [测试规范](#5-测试规范)
6. [文档规范](#6-文档规范)
7. [发布流程](#7-发布流程)

---

## 1. 贡献概述

### 1.1 贡献方式

| 方式 | 说明 |
|-----|------|
| 提交代码 | 修复Bug、添加功能 |
| 开发技能 | 开发新的技能模块 |
| 完善文档 | 改进文档、翻译 |
| 报告问题 | 提交Issue |
| 参与讨论 | 参与功能讨论 |

### 1.2 行为准则

- 尊重所有贡献者
- 保持专业和友好的交流
- 接受建设性批评
- 关注对社区最有利的事情

---

## 2. 开发流程

### 2.1 Fork和Clone

```bash
# 1. Fork仓库到你的账号

# 2. Clone你的Fork
git clone https://github.com/YOUR_USERNAME/baize-nodejs.git
cd baize-nodejs

# 3. 添加上游仓库
git remote add upstream https://github.com/ORIGINAL_REPO/baize-nodejs.git

# 4. 同步上游更新
git fetch upstream
git checkout main
git merge upstream/main
```

### 2.2 创建分支

```bash
# 创建功能分支
git checkout -b feature/my-feature

# 或创建修复分支
git checkout -b fix/my-fix
```

### 2.3 分支命名规范

| 前缀 | 说明 | 示例 |
|-----|------|------|
| feature/ | 新功能 | feature/add-weather-skill |
| fix/ | Bug修复 | fix/chat-response-error |
| docs/ | 文档更新 | docs/update-api-doc |
| refactor/ | 代码重构 | refactor/thinking-engine |
| test/ | 测试相关 | test/add-unit-tests |

### 2.4 开发和测试

```bash
# 安装依赖
npm install

# 编译项目
npm run build

# 运行测试
npm test

# 运行特定测试
npm test -- --grep "ThinkingEngine"

# 代码检查
npm run lint

# 格式化代码
npm run format
```

### 2.5 提交Pull Request

```bash
# 1. 确保代码通过测试
npm test

# 2. 提交代码
git add .
git commit -m "feat: 添加天气技能"

# 3. 推送到Fork
git push origin feature/my-feature

# 4. 在GitHub上创建Pull Request
```

---

## 3. 代码规范

### 3.1 TypeScript规范

```typescript
// ✅ 好的实践

// 使用接口定义类型
interface UserConfig {
  name: string;
  age: number;
}

// 使用const/let，避免var
const config: UserConfig = { name: '白泽', age: 1 };

// 使用箭头函数
const greet = (name: string): string => `你好，${name}`;

// 使用可选链
const value = obj?.nested?.property;

// 使用空值合并
const name = user.name ?? '未知';

// 添加类型注释
function process(input: string): Result {
  // ...
}

// ❌ 不好的实践

// 使用any类型
function process(input: any): any {  // 避免
  // ...
}

// 忽略类型检查
// @ts-ignore  // 避免
```

### 3.2 命名规范

| 类型 | 规范 | 示例 |
|-----|------|------|
| 类名 | PascalCase | `ThinkingEngine` |
| 函数名 | camelCase | `processInput` |
| 变量名 | camelCase | `userName` |
| 常量名 | UPPER_SNAKE_CASE | `MAX_TOKENS` |
| 文件名 | kebab-case | `thinking-engine.ts` |
| 接口名 | PascalCase | `UserConfig` |

### 3.3 注释规范

```typescript
/**
 * 思考引擎 - 实现六阶段思考协议
 * 
 * @example
 * const engine = new ThinkingEngine();
 * const thought = await engine.process('你好');
 */
export class ThinkingEngine {
  /**
   * 处理用户输入
   * 
   * @param userInput - 用户输入字符串
   * @param context - 可选的上下文信息
   * @returns 思考过程结果
   * @throws {BaizeError} 当处理失败时抛出
   */
  async process(
    userInput: string,
    context?: Record<string, unknown>
  ): Promise<ThoughtProcess> {
    // 实现...
  }
}
```

### 3.4 文件结构

```typescript
// 标准文件结构

// 1. 导入语句（按类型分组）
import { native } from 'module';           // Node.js原生模块
import { external } from 'package';        // 外部包
import { internal } from '../internal';    // 内部模块
import { types } from '../../types';       // 类型定义

// 2. 常量定义
const MAX_RETRIES = 3;
const DEFAULT_CONFIG = { ... };

// 3. 接口/类型定义
interface LocalConfig { ... }

// 4. 类定义
export class MyClass { ... }

// 5. 辅助函数
function helper() { ... }

// 6. 导出
export { MyClass, helper };
```

---

## 4. 提交规范

### 4.1 Commit Message格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

### 4.2 Type类型

| 类型 | 说明 | 示例 |
|-----|------|------|
| feat | 新功能 | feat: 添加天气技能 |
| fix | Bug修复 | fix: 修复对话响应错误 |
| docs | 文档更新 | docs: 更新API文档 |
| style | 代码格式 | style: 格式化代码 |
| refactor | 重构 | refactor: 重构思考引擎 |
| test | 测试 | test: 添加单元测试 |
| chore | 构建/工具 | chore: 更新依赖 |

### 4.3 Scope范围

| 范围 | 说明 |
|-----|------|
| thinking | 思考引擎 |
| skill | 技能系统 |
| memory | 记忆系统 |
| api | API接口 |
| cli | CLI交互 |
| docs | 文档 |

### 4.4 提交示例

```bash
# 新功能
git commit -m "feat(skill): 添加天气查询技能"

# Bug修复
git commit -m "fix(thinking): 修复简单对话判断逻辑"

# 文档更新
git commit -m "docs(api): 更新WebSocket接口文档"

# 多行提交
git commit -m "feat(core): 添加语义缓存功能

- 实现SemanticCache类
- 支持相似度阈值配置
- 添加LRU淘汰策略

Closes #123"
```

---

## 5. 测试规范

### 5.1 测试文件结构

```
tests/
├── unit/              # 单元测试
│   ├── thinking.test.ts
│   └── memory.test.ts
├── integration/       # 集成测试
│   └── api.test.ts
└── e2e/              # 端到端测试
    └── chat.test.ts
```

### 5.2 测试编写规范

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { ThinkingEngine } from '../src/core/thinking/engine';

describe('ThinkingEngine', () => {
  let engine: ThinkingEngine;

  beforeEach(() => {
    engine = new ThinkingEngine();
  });

  describe('process', () => {
    it('should return thought process for user input', async () => {
      const result = await engine.process('你好');
      
      expect(result).toBeDefined();
      expect(result.understanding).toBeDefined();
      expect(result.duration).toBeGreaterThan(0);
    });

    it('should handle simple chat without tasks', async () => {
      const result = await engine.process('你是谁');
      
      expect(result.understanding.isSimpleChat).toBe(true);
      expect(result.decomposition.tasks).toHaveLength(0);
    });

    it('should throw error for invalid input', async () => {
      await expect(engine.process('')).rejects.toThrow();
    });
  });
});
```

### 5.3 测试覆盖率

```bash
# 运行覆盖率测试
npm run test:coverage

# 覆盖率目标
# - 语句覆盖率: > 80%
# - 分支覆盖率: > 70%
# - 函数覆盖率: > 80%
# - 行覆盖率: > 80%
```

---

## 6. 文档规范

### 6.1 文档类型

| 文档 | 位置 | 说明 |
|-----|------|------|
| README.md | 根目录 | 项目介绍 |
| architecture.md | docs/ | 架构设计 |
| DEVELOPMENT.md | docs/ | 开发文档 |
| API.md | docs/ | API文档 |
| CHANGELOG.md | 根目录 | 更新日志 |

### 6.2 Markdown规范

```markdown
# 一级标题（文档标题）

## 二级标题（章节）

### 三级标题（小节）

**粗体** 用于强调重要内容
*斜体* 用于术语或引用

- 无序列表项1
- 无序列表项2

1. 有序列表项1
2. 有序列表项2

| 表头1 | 表头2 |
|-------|-------|
| 内容1 | 内容2 |

```代码块```

[链接文本](url)

![图片描述](image-url)
```

### 6.3 代码示例规范

```typescript
// ✅ 好的代码示例

/**
 * 使用思考引擎处理用户输入
 */
import { ThinkingEngine } from 'baize';

// 创建引擎实例
const engine = new ThinkingEngine();

// 处理用户输入
const thought = await engine.process('你好');

// 输出结果
console.log(thought.understanding.coreNeed);
```

---

## 7. 发布流程

### 7.1 版本号规范

使用语义化版本号：`MAJOR.MINOR.PATCH`

| 类型 | 说明 | 示例 |
|-----|------|------|
| MAJOR | 不兼容的API变更 | 3.0.0 → 4.0.0 |
| MINOR | 向后兼容的功能新增 | 3.0.0 → 3.1.0 |
| PATCH | 向后兼容的问题修复 | 3.0.0 → 3.0.1 |

### 7.2 发布检查清单

```bash
# 1. 更新版本号
npm version minor  # 或 major/patch

# 2. 更新CHANGELOG
# 编辑 CHANGELOG.md

# 3. 运行测试
npm test

# 4. 编译项目
npm run build

# 5. 创建标签
git tag v3.1.0

# 6. 推送代码和标签
git push origin main --tags

# 7. 发布到npm（如果需要）
npm publish
```

### 7.3 CHANGELOG格式

```markdown
# 更新日志

## [3.1.0] - 2025-02-24

### 新增
- 添加语义缓存功能
- 添加能力缺口检测

### 修复
- 修复简单对话处理逻辑
- 修复Windows下技能执行问题

### 变更
- 优化Token预算分配
- 改进错误提示信息

### 移除
- 移除废弃的API接口
```

---

## 附录

### A. 开发工具

| 工具 | 用途 |
|-----|------|
| VS Code | 代码编辑 |
| ESLint | 代码检查 |
| Prettier | 代码格式化 |
| Vitest | 单元测试 |
| TypeScript | 类型检查 |

### B. 相关链接

- [架构设计文档](./architecture.md)
- [开发文档](./DEVELOPMENT.md)
- [API文档](./API.md)

### C. 联系方式

- GitHub Issues: 提交问题和建议
- GitHub Discussions: 参与讨论
