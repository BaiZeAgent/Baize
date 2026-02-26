# 白泽3.0 配置指南

**版本**: 3.0.2  
**最后更新**: 2025年2月

---

## 目录

1. [配置文件结构](#1-配置文件结构)
2. [环境变量](#2-环境变量)
3. [LLM配置](#3-llm配置)
4. [系统配置](#4-系统配置)
5. [进化配置](#5-进化配置)
6. [用户配置](#6-用户配置)

---

## 1. 配置文件结构

```
config/
├── system.yaml      # 系统配置
├── llm.yaml         # LLM配置
├── evolution.yaml   # 进化配置
└── user.yaml        # 用户配置
```

---

## 2. 环境变量

### 2.1 创建 .env 文件

```bash
# 复制示例
cp .env.example .env

# 编辑
nano .env  # 或使用你喜欢的编辑器
```

### 2.2 环境变量列表

| 变量 | 必填 | 说明 |
|-----|------|------|
| `ALIYUN_API_KEY` | 是* | 阿里云百炼 API Key |
| `ZHIPU_API_KEY` | 否 | 智谱AI API Key |
| `OLLAMA_BASE_URL` | 否 | Ollama 服务地址 |
| `BRAVE_API_KEY` | 否 | Brave Search API Key |
| `LOG_LEVEL` | 否 | 日志级别 (debug/info/warn/error) |

> *至少需要一个 LLM API Key

### 2.3 获取 API Key

| 服务 | 获取地址 | 说明 |
|-----|---------|------|
| 阿里云百炼 | https://bailian.console.aliyun.com/ | 推荐，稳定可靠 |
| 智谱AI | https://open.bigmodel.cn/ | 备选 |
| Ollama | https://ollama.ai | 本地免费 |
| Brave Search | https://brave.com/search/api/ | 搜索功能需要 |

---

## 3. LLM配置

### 3.1 配置文件位置

`config/llm.yaml`

### 3.2 完整配置示例

```yaml
# 默认提供商
default: "aliyun"

# 提供商配置
providers:
  # 阿里云百炼（推荐）
  aliyun:
    enabled: true
    type: "openai-compatible"
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
    model: "qwen-max"
    apiKey: "${ALIYUN_API_KEY}"  # 从环境变量读取
    
    # 可选：模型参数
    options:
      temperature: 0.7
      max_tokens: 2000

  # 智谱AI
  zhipu:
    enabled: true
    type: "openai-compatible"
    baseURL: "https://open.bigmodel.cn/api/paas/v4"
    model: "glm-4"
    apiKey: "${ZHIPU_API_KEY}"

  # Ollama（本地）
  ollama:
    enabled: true
    type: "ollama"
    baseURL: "http://localhost:11434"
    model: "llama2"

# 成本控制
costControl:
  dailyBudget: 10        # 每日预算（美元）
  perTaskBudget: 0.5     # 单任务预算
  alertThreshold: 80     # 告警阈值（%）
  hardLimit: true        # 超限是否拒绝

# 模型策略
strategy:
  taskMapping:
    simple: "qwen-turbo"   # 简单任务用便宜模型
    complex: "qwen-max"    # 复杂任务用强大模型
  fallback: "ollama"       # 回退模型
```

### 3.3 模型选择建议

| 场景 | 推荐模型 | 说明 |
|-----|---------|------|
| 日常使用 | qwen-turbo | 便宜快速 |
| 复杂任务 | qwen-max | 能力强 |
| 本地部署 | llama2 | 免费、隐私 |
| 开发测试 | qwen-turbo | 成本低 |

### 3.4 成本估算

| 模型 | 输入价格 | 输出价格 | 说明 |
|-----|---------|---------|------|
| qwen-turbo | $0.0003/1K | $0.0006/1K | 便宜 |
| qwen-max | $0.002/1K | $0.006/1K | 强大 |
| llama2 (本地) | 免费 | 免费 | 需要本地部署 |

---

## 4. 系统配置

### 4.1 配置文件位置

`config/system.yaml`

### 4.2 完整配置示例

```yaml
# 系统版本
version: "3.0"
name: "白泽"
mode: "production"

# 日志配置
logging:
  level: "info"           # debug, info, warn, error
  file: "logs/baize.log"
  maxSize: 10485760       # 10MB
  maxFiles: 5
  console: true

# 数据库配置
database:
  path: "data/baize.db"
  backup:
    enabled: true
    interval: 86400       # 每天备份
    path: "data/backups"
    maxBackups: 7

# 执行器配置
executor:
  maxWorkers: 5           # 最大并发数
  timeout: 300000         # 超时时间（毫秒）
  retryAttempts: 3        # 重试次数

# 缓存配置
cache:
  enabled: true
  ttl: 3600              # 缓存时间（秒）
  maxSize: 1000          # 最大缓存数

# API配置
api:
  port: 3000
  host: "0.0.0.0"
  cors:
    enabled: true
    origins: ["*"]
```

---

## 5. 进化配置

### 5.1 配置文件位置

`config/evolution.yaml`

### 5.2 完整配置示例

```yaml
# 进化系统开关
evolution:
  enabled: true

  # 能力缺口检测
  capabilityGapDetection:
    enabled: true
    confidenceThreshold: 0.8
    autoPrompt: true

  # 技能市场
  skillMarket:
    enabled: true
    endpoint: "https://clawhub.ai"
    autoInstall: false
    verifiedOnly: true

  # 权限控制
  permissions:
    - path: "core/"
      permission: "denied"
      reason: "核心代码禁止修改"
    
    - path: "security/"
      permission: "denied"
      reason: "安全模块禁止修改"
    
    - path: "skills/"
      permission: "confirm"
      reason: "技能修改需要确认"
    
    - path: "data/"
      permission: "auto"
      reason: "数据目录自动允许"

  # 角色团队
  team:
    - name: "产品经理"
      responsibilities: ["需求分析", "功能规划"]
    
    - name: "开发者"
      responsibilities: ["代码实现", "Bug修复"]
    
    - name: "测试者"
      responsibilities: ["功能测试", "回归测试"]
```

---

## 6. 用户配置

### 6.1 配置文件位置

`config/user.yaml`

### 6.2 完整配置示例

```yaml
# 用户信息
user:
  name: "用户"
  language: "zh-CN"
  timezone: "Asia/Shanghai"

# 偏好设置
preferences:
  responseStyle: "friendly"   # friendly, professional, concise
  confirmHighRisk: true       # 高风险操作需要确认
  saveHistory: true           # 保存对话历史
  maxHistoryLength: 100       # 最大历史长度

# 快捷方式
shortcuts:
  "w": "天气"
  "t": "时间"
  "f": "文件"

# 个性化设置
personalization:
  rememberPreferences: true   # 记住用户偏好
  learnFromFeedback: true    # 从反馈学习
```

---

## 附录

### A. 配置优先级

```
环境变量 > 配置文件 > 默认值
```

### B. 配置验证

```bash
# 运行测试验证配置
npm test

# 检查配置加载
node -e "console.log(require('./dist/config/loader').loadConfig())"
```

### C. 常见问题

**Q: 配置修改后不生效？**
A: 重启白泽服务。

**Q: 如何查看当前配置？**
A: 查看日志文件或运行测试。

**Q: 环境变量优先级最高？**
A: 是的，环境变量会覆盖配置文件中的值。
