<p align="center">
  <img src="web/logo.png" alt="白泽 Logo" width="200">
</p>

<h1 align="center">白泽 3.0</h1>

<p align="center">
  JARVIS级AI助手 - Node.js/TypeScript实现
</p>

<p align="center">
  <a href="#特性">特性</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#架构">架构</a> •
  <a href="#核心功能">核心功能</a> •
  <a href="#技能市场">技能市场</a>
</p>

---

## 联系方式

📧 baizehub@163.com

## 特性

- 🧠 **六阶段思考协议**: 理解→拆解→规划→调度→验收→反思
- 🔄 **主动任务机制**: 时间触发、事件触发、条件触发
- 📚 **三层记忆系统**: 情景记忆、声明式记忆、程序性记忆
- 🛠️ **可扩展技能系统**: 插件式技能架构，支持 ClawHub 技能市场
- 🤖 **多LLM支持**: 阿里云百炼、智谱清言、Ollama
- 🔒 **安全边界设计**: 四级风险确认机制
- 🧬 **自进化能力**: 角色化思考、安全沙箱
- ✨ **智能后处理**: LLM根据记忆和经验自动优化回复

## 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    白泽3.0 架构                                   │
├─────────────────────────────────────────────────────────────────┤
│  L9 交互层      CLI / API / Web                                  │
│  L8 安全层      认证 / 权限 / 审计                                │
│  L7 决策层      思考引擎 / 确认策略 / 技能匹配                     │
│  L6 调度层      任务调度器 / 主动任务                              │
│  L5 执行层      并行执行器 / LLM后处理                             │
│  L4 能力层      技能注册表 / 技能加载器 / ClawHub客户端            │
│  L3 知识层      向量存储 / RAG                                    │
│  L2 数据层      SQLite (sql.js)                                  │
│  L1 可观测层    日志 / 指标 / 追踪                                │
│                                                                 │
│  独立模块: 自进化系统 / 记忆系统                                   │
└─────────────────────────────────────────────────────────────────┘
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制环境变量模板：

```bash
cp .env.example .env
```

编辑 `.env` 文件，填入你的API Key：

```
# 阿里云百炼（推荐）
ALIYUN_API_KEY=your_api_key

# 智谱清言
ZHIPU_API_KEY=your_api_key

# Ollama（本地运行，无需Key）
# 确保Ollama服务已启动: ollama serve
```

### 3. 编译

```bash
# 编译TypeScript
npm run build

# 或者使用tsc
npx tsc
```

### 4. 启动

#### 交互模式（推荐）

```bash
# 方式1: 使用npm
npm start

# 方式2: 直接运行
node dist/cli/index.js start

# 方式3: 开发模式（需要ts-node）
npm run dev
```

#### Web服务模式

```bash
# 启动Web服务（API + Web界面）
node dist/cli/index.js web

# 只启动API服务
node dist/cli/index.js api

# 指定端口
node dist/cli/index.js api 8080
```

#### 单次对话模式

```bash
node dist/cli/index.js chat "你好"
```

#### 运行测试

```bash
node dist/cli/index.js test
```

## 支持的LLM

| 提供商 | 类型 | 配置 | 说明 |
|--------|------|------|------|
| 阿里云百炼 | OpenAI兼容 | ALIYUN_API_KEY | 推荐，稳定 |
| 智谱清言 | OpenAI兼容 | ZHIPU_API_KEY | 备选 |
| Ollama | 本地 | 无需Key | 需要本地运行Ollama |

## 技能市场

白泽3.0 集成了 [ClawHub](https://clawhub.ai) 技能市场，可以一键安装各种技能：

```bash
# 搜索技能
node dist/cli/index.js skill search weather

# 安装技能
node dist/cli/index.js skill install weather

# 列出已安装技能
node dist/cli/index.js skill list

# 查看技能详情
node dist/cli/index.js skill info weather

# 卸载技能
node dist/cli/index.js skill uninstall weather
```

### 可用技能示例

| 技能 | 说明 | 类型 |
|------|------|------|
| weather | 天气查询（无需API Key） | 文档型 |
| brave-search | Brave搜索 | 脚本型 |
| file | 文件操作 | 脚本型 |
| fs | 文件系统操作 | 脚本型 |
| time | 时间查询 | 脚本型 |

## 项目结构

```
Baize/
├── src/                    # 源代码
│   ├── cli/               # CLI入口
│   ├── core/              # 核心层
│   │   ├── brain/         # 大脑决策
│   │   ├── thinking/      # 思考引擎（六阶段）
│   │   ├── confirmation/  # 确认策略
│   │   └── error.ts       # 错误处理
│   ├── llm/               # LLM适配器
│   ├── memory/            # 记忆系统
│   ├── skills/            # 技能系统
│   │   ├── base.ts        # 技能基类
│   │   ├── registry.ts    # 技能注册表
│   │   ├── loader.ts      # 技能加载器
│   │   └── market/        # ClawHub客户端
│   ├── executor/          # 执行层
│   ├── evolution/         # 自进化模块
│   ├── interaction/       # 交互层（API/Web）
│   ├── observability/     # 可观测层
│   └── types/             # 类型定义
├── dist/                   # 编译输出
├── skills/                 # 技能目录
├── data/                   # 数据目录
├── web/                    # Web界面
├── package.json
├── tsconfig.json
└── README.md
```

## 核心功能

### 六阶段思考协议

1. **理解**: 解析用户意图，提取核心需求
2. **拆解**: 将复杂任务分解为原子任务
3. **规划**: 选择技能，制定执行计划
4. **调度**: 安排执行顺序，管理并行组
5. **验收**: 检查执行结果，收集问题
6. **反思**: 分析失败原因，提出改进方案

### 三层记忆系统

- **情景记忆**: 对话历史、事件记录
- **声明式记忆**: 用户偏好、事实知识
- **程序性记忆**: 任务模式、执行流程

### 智能后处理

技能执行后，LLM会根据以下因素自动优化回复：

1. **用户明确指令** - "总结一下"、"显示原始结果"
2. **记忆和经验** - 用户偏好简洁还是详细
3. **结果复杂度** - 简单结果直接返回，复杂结果智能处理

```
用户: 今天杭州天气怎么样
     ↓
技能执行: curl wttr.in/Hangzhou
     ↓
原始结果: 一大堆天气图表
     ↓
LLM后处理: "杭州今天有雾，气温9°C，下午可能有小雨，建议带伞"
```

### 自进化系统

- 角色化思考（产品经理、开发者、测试、用户）
- 安全沙箱机制
- 权限分级管理
- 能力差距检测

## API接口

启动API服务后，可以通过以下接口调用：

### 对话接口

```bash
# 对话
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "今天杭州天气怎么样"}'

# 获取对话历史
curl http://localhost:3000/api/chat/history

# 清空对话历史
curl -X DELETE http://localhost:3000/api/chat/history
```

### 技能接口

```bash
# 获取技能列表
curl http://localhost:3000/api/skills

# 执行技能
curl -X POST http://localhost:3000/api/skills/execute \
  -H "Content-Type: application/json" \
  -d '{"skillName": "time", "params": {}}'
```

### 其他接口

```bash
# 健康检查
curl http://localhost:3000/health

# 成本统计
curl http://localhost:3000/api/cost/stats

# LLM配置
curl http://localhost:3000/api/config/llm
```

## 开发

```bash
# 开发模式（热重载）
npm run dev

# 编译
npm run build

# 测试
npm test

# 清理编译文件
npm run clean
```

## 命令行工具完整列表

```bash
# 交互模式
baize start
baize                    # 同上

# 单次对话
baize chat "你好"

# 测试
baize test

# 技能管理
baize skill list              # 列出已安装技能
baize skill search weather    # 搜索技能
baize skill install weather   # 安装技能
baize skill uninstall weather # 卸载技能
baize skill info weather      # 查看技能详情

# Web服务
baize web                     # 启动Web服务
baize api                     # 启动API服务
baize api 8080                # 指定端口

# 帮助
baize help
baize --help
```

## 常见问题

### 1. LLM调用失败

检查 `.env` 文件中的API Key是否正确配置。

### 2. 技能执行失败

- 检查技能是否正确安装
- 检查网络连接（文档型技能需要访问外部API）
- 查看日志获取详细错误信息

### 3. 编译错误

```bash
# 清理后重新编译
rm -rf dist
npm run build
```

## 许可证

MIT License

---

<p align="center">
  Made with ❤️ by BaiZe Team
</p>
