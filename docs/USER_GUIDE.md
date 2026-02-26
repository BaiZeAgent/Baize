# 白泽3.0 使用手册

**版本**: 3.0.2  
**适用对象**: 所有用户  
**最后更新**: 2025年2月

---

## 目录

1. [快速入门](#1-快速入门)
2. [基础对话](#2-基础对话)
3. [技能使用](#3-技能使用)
4. [命令参考](#4-命令参考)
5. [配置说明](#5-配置说明)
6. [常见场景](#6-常见场景)
7. [技巧与窍门](#7-技巧与窍门)

---

## 1. 快速入门

### 1.1 启动白泽

```bash
# 进入项目目录
cd baize-nodejs

# 启动交互模式
node dist/cli/index.js start

# 或使用 npm
npm start
```

### 1.2 第一次对话

```
🦌 白泽3.0 已启动
输入 "exit" 退出，输入 "help" 查看帮助

你: 你好
白泽: 早上好！有什么我可以帮助你的吗？

你: 你是谁
白泽: 我是白泽，你的智能助手。我可以帮你处理各种任务...
```

### 1.3 基本命令

| 命令 | 说明 |
|-----|------|
| `exit` | 退出程序 |
| `help` | 显示帮助 |
| `clear` | 清空对话历史 |
| `history` | 查看对话历史 |

---

## 2. 基础对话

### 2.1 对话类型

白泽支持两种对话模式：

**简单对话**（即时回复）：
- 问候语：你好、嗨、hello
- 自我介绍：你是谁
- 感谢/告别：谢谢、再见
- 闲聊：今天心情不好、讲个笑话

**任务执行**（需要处理）：
- 文件操作：创建文件、读取文件
- 时间查询：现在几点
- 网络搜索：搜索xxx

### 2.2 对话示例

```
你: 你好
白泽: 早上好！有什么我可以帮助你的吗？
[耗时 0.00s] ← 规则匹配，即时回复

你: 现在几点了
白泽: 现在是 2026/2/23 10:30:00
[耗时 3.21s] ← 任务执行

你: 帮我在G盘创建一个test.txt
白泽: 文件已创建: G:\test.txt
[耗时 5.43s] ← 任务执行
```

### 2.3 上下文对话

白泽会记住对话历史：

```
你: 我叫张三
白泽: 你好张三！很高兴认识你。

你: 我叫什么名字
白泽: 你叫张三。
```

---

## 3. 技能使用

### 3.1 查看已安装技能

```bash
node dist/cli/index.js skill list
```

输出：
```
已安装技能:
  brave-search - 使用Brave搜索引擎进行网络搜索
  file - 文件读写操作
  fs - 文件系统操作
  time - 获取当前时间
```

### 3.2 内置技能

| 技能 | 功能 | 示例 |
|-----|------|------|
| time | 查询时间 | "现在几点了" |
| file | 文件读写 | "创建一个文件" |
| fs | 文件系统 | "列出目录" |
| brave-search | 网络搜索 | "搜索Python教程" |

### 3.3 使用技能

**方式1：自然语言**

```
你: 现在几点了
白泽: 现在是 2026/2/23 10:30:00
```

**方式2：明确指令**

```
你: 使用time技能查询时间
白泽: 现在是 2026/2/23 10:30:00
```

### 3.4 安装新技能

```bash
# 搜索技能
node dist/cli/index.js skill search weather

# 安装技能
node dist/cli/index.js skill install weather
```

---

## 4. 命令参考

### 4.1 主命令

```bash
# 启动交互模式
node dist/cli/index.js start

# 单次对话
node dist/cli/index.js chat "你好"

# 运行测试
node dist/cli/index.js test

# 显示帮助
node dist/cli/index.js help
```

### 4.2 技能命令

```bash
# 列出技能
node dist/cli/index.js skill list

# 搜索技能
node dist/cli/index.js skill search <关键词>

# 安装技能
node dist/cli/index.js skill install <技能ID>

# 查看技能详情
node dist/cli/index.js skill info <技能ID>
```

### 4.3 交互模式命令

在交互模式中：

| 命令 | 说明 |
|-----|------|
| `exit` / `quit` | 退出程序 |
| `help` | 显示帮助 |
| `clear` | 清空对话历史 |
| `history` | 查看对话历史 |

---

## 5. 配置说明

### 5.1 环境变量

创建 `.env` 文件：

```bash
# LLM API Keys
ALIYUN_API_KEY=your_aliyun_key      # 阿里云百炼
ZHIPU_API_KEY=your_zhipu_key        # 智谱AI（可选）

# Brave Search API（可选）
BRAVE_API_KEY=your_brave_key

# 日志级别
LOG_LEVEL=info
```

### 5.2 LLM 配置

编辑 `config/llm.yaml`：

```yaml
# 默认提供商
default: "aliyun"

# 提供商配置
providers:
  aliyun:
    enabled: true
    model: "qwen-max"
    apiKey: "${ALIYUN_API_KEY}"
  
  ollama:
    enabled: true
    baseURL: "http://localhost:11434"
    model: "llama2"

# 成本控制
costControl:
  dailyBudget: 10      # 每日预算（美元）
  perTaskBudget: 0.5   # 单任务预算
  alertThreshold: 80   # 告警阈值（%）
  hardLimit: true      # 超限拒绝
```

### 5.3 系统配置

编辑 `config/system.yaml`：

```yaml
# 日志配置
logging:
  level: "info"
  file: "logs/baize.log"

# 数据库配置
database:
  path: "data/baize.db"

# 执行器配置
executor:
  maxWorkers: 5
  timeout: 300000
```

---

## 6. 常见场景

### 6.1 文件操作

```
你: 在D盘创建一个hello.txt，内容是"Hello World"
白泽: 文件已创建: D:\hello.txt

你: 读取D盘的hello.txt
白泽: 文件内容: Hello World

你: 删除D盘的hello.txt
白泽: 文件已删除: D:\hello.txt
```

### 6.2 时间查询

```
你: 现在几点了
白泽: 现在是 2026/2/23 10:30:00

你: 今天星期几
白泽: 今天是星期日

你: 今年有多少天
白泽: 2026年有365天
```

### 6.3 网络搜索

```
你: 搜索Python教程
白泽: 找到以下结果：
1. Python教程 - 菜鸟教程
   https://www.runoob.com/python/
   Python 基础教程...
```

### 6.4 信息查询

```
你: 什么是人工智能
白泽: 人工智能（Artificial Intelligence，简称AI）是...

你: 帮我翻译"Hello World"成中文
白泽: 你好世界
```

---

## 7. 技巧与窍门

### 7.1 提高响应速度

1. **使用规则匹配**：问候语、感谢等会即时回复
2. **明确指令**：清晰表达需求，减少思考时间
3. **使用本地LLM**：配置 Ollama 可大幅降低延迟

### 7.2 节省成本

1. **设置预算**：在 `config/llm.yaml` 中设置 `dailyBudget`
2. **使用便宜模型**：`qwen-turbo` 比 `qwen-max` 便宜
3. **启用缓存**：重复问题不会重复调用 LLM

### 7.3 获得更好结果

1. **提供上下文**：告诉白泽你的背景和需求
2. **分步提问**：复杂任务拆分为多个简单问题
3. **确认理解**：让白泽复述你的需求

### 7.4 调试技巧

```bash
# 查看详细日志
export LOG_LEVEL=debug
node dist/cli/index.js start

# 查看数据库
sqlite3 data/baize.db "SELECT * FROM episodic_memory LIMIT 10;"

# 测试技能
echo '{"params":{}}' | node skills/time/main.js
```

---

## 附录

### A. 快捷键

| 快捷键 | 说明 |
|-------|------|
| `Ctrl+C` | 退出程序 |
| `↑` / `↓` | 历史命令（部分终端支持） |

### B. 文件位置

| 文件 | 位置 |
|-----|------|
| 配置文件 | `config/` |
| 技能目录 | `skills/` |
| 数据库 | `data/baize.db` |
| 日志 | `logs/baize.log` |

### C. 获取帮助

- 查阅 [FAQ](./FAQ.md)
- 查看 [API文档](./API.md)
- 提交 [Issue](https://github.com/your-repo/baize-nodejs/issues)
