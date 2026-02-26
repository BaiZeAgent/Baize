# 白泽3.0 部署文档

**版本**: 3.0.2  
**适用对象**: 运维人员、系统管理员  
**最后更新**: 2025年2月

---

## 目录

1. [部署概述](#1-部署概述)
2. [本地部署](#2-本地部署)
3. [Docker部署](#3-docker部署)
4. [生产环境部署](#4-生产环境部署)
5. [配置说明](#5-配置说明)
6. [运维指南](#6-运维指南)
7. [故障排查](#7-故障排查)

---

## 1. 部署概述

### 1.1 部署架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     生产环境部署架构                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐       │
│  │   Nginx     │────▶│  白泽实例   │────▶│   SQLite    │       │
│  │  反向代理   │     │  (Node.js)  │     │   数据库    │       │
│  └─────────────┘     └─────────────┘     └─────────────┘       │
│        │                    │                                   │
│        │                    ▼                                   │
│        │             ┌─────────────┐                           │
│        │             │  LLM API    │                           │
│        │             │  (阿里云等) │                           │
│        │             └─────────────┘                           │
│        │                                                       │
│        ▼                                                       │
│  ┌─────────────┐                                              │
│  │   用户端    │                                              │
│  │  CLI/Web   │                                              │
│  └─────────────┘                                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 系统要求

| 组件 | 最低要求 | 推荐配置 |
|-----|---------|---------|
| CPU | 1核 | 2核+ |
| 内存 | 512MB | 1GB+ |
| 磁盘 | 100MB | 1GB+ |
| Node.js | 18.0+ | 20.0+ |
| 操作系统 | Linux/Windows/macOS | Linux |

### 1.3 网络要求

| 端口 | 用途 |
|-----|------|
| 3000 | HTTP API |
| 3001 | WebSocket (可选) |

---

## 2. 本地部署

### 2.1 快速开始

```bash
# 1. 克隆仓库
git clone https://github.com/your-repo/baize-nodejs.git
cd baize-nodejs

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env，填入必要的API Key

# 4. 编译项目
npm run build

# 5. 启动服务
npm start
```

### 2.2 配置API Key

创建 `.env` 文件：

```bash
# 阿里云百炼
ALIYUN_API_KEY=your_aliyun_api_key

# 智谱AI (可选)
ZHIPU_API_KEY=your_zhipu_api_key

# Ollama (本地)
OLLAMA_BASE_URL=http://localhost:11434

# 日志级别
LOG_LEVEL=info
```

### 2.3 验证安装

```bash
# 运行测试
npm test

# 启动并测试对话
npm start
# 输入: 你好
```

---

## 3. Docker部署

### 3.1 Dockerfile

```dockerfile
# Dockerfile
FROM node:20-alpine

WORKDIR /app

# 安装依赖
COPY package*.json ./
RUN npm ci --only=production

# 复制代码
COPY . .

# 编译
RUN npm run build

# 创建数据目录
RUN mkdir -p /app/data /app/logs /app/skills

# 暴露端口
EXPOSE 3000

# 启动命令
CMD ["node", "dist/interaction/api.js"]
```

### 3.2 docker-compose.yml

```yaml
version: '3.8'

services:
  baize:
    build: .
    container_name: baize
    ports:
      - "3000:3000"
    environment:
      - ALIYUN_API_KEY=${ALIYUN_API_KEY}
      - LOG_LEVEL=info
    volumes:
      - ./data:/app/data
      - ./logs:/app/logs
      - ./skills:/app/skills
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### 3.3 部署命令

```bash
# 构建镜像
docker build -t baize:3.0 .

# 运行容器
docker run -d \
  --name baize \
  -p 3000:3000 \
  -e ALIYUN_API_KEY=your_key \
  -v $(pwd)/data:/app/data \
  baize:3.0

# 或使用 docker-compose
docker-compose up -d

# 查看日志
docker logs -f baize

# 停止服务
docker-compose down
```

---

## 4. 生产环境部署

### 4.1 使用PM2

```bash
# 安装PM2
npm install -g pm2

# 启动服务
pm2 start dist/interaction/api.js --name baize

# 查看状态
pm2 status

# 查看日志
pm2 logs baize

# 设置开机自启
pm2 startup
pm2 save
```

### 4.2 PM2配置文件

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'baize',
    script: 'dist/interaction/api.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production',
      LOG_LEVEL: 'info'
    },
    env_production: {
      NODE_ENV: 'production'
    }
  }]
};
```

### 4.3 Nginx反向代理

```nginx
# /etc/nginx/sites-available/baize
server {
    listen 80;
    server_name baize.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket支持
    location /ws {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
    }
}
```

```bash
# 启用配置
sudo ln -s /etc/nginx/sites-available/baize /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 4.4 SSL配置

```bash
# 使用Let's Encrypt
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d baize.example.com
```

### 4.5 防火墙配置

```bash
# Ubuntu/Debian
sudo ufw allow 80
sudo ufw allow 443
sudo ufw enable

# CentOS/RHEL
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

---

## 5. 配置说明

### 5.1 系统配置 (config/system.yaml)

```yaml
version: "3.0"
name: "白泽"
mode: "production"

logging:
  level: "info"          # debug, info, warn, error
  file: "logs/baize.log"
  maxSize: 10485760      # 10MB
  maxFiles: 5

database:
  path: "data/baize.db"
  backup:
    enabled: true
    interval: 86400      # 每天备份
    path: "data/backups"

executor:
  maxWorkers: 5
  timeout: 300000        # 5分钟
  retryAttempts: 3
```

### 5.2 LLM配置 (config/llm.yaml)

```yaml
default: "aliyun"

providers:
  aliyun:
    enabled: true
    type: "openai-compatible"
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
    model: "qwen-max"
    apiKey: "${ALIYUN_API_KEY}"
    
  ollama:
    enabled: true
    type: "ollama"
    baseURL: "http://localhost:11434"
    model: "llama2"

costControl:
  dailyBudget: 10        # 美元
  perTaskBudget: 0.5
  alertThreshold: 80     # 百分比
  hardLimit: true

strategy:
  taskMapping:
    simple: "qwen-turbo"
    complex: "qwen-max"
  fallback: "ollama"
```

### 5.3 进化配置 (config/evolution.yaml)

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
```

### 5.4 用户配置 (config/user.yaml)

```yaml
user:
  name: "用户"
  language: "zh-CN"
  timezone: "Asia/Shanghai"

preferences:
  responseStyle: "friendly"   # friendly, professional, concise
  confirmHighRisk: true
  saveHistory: true

shortcuts:
  "w": "天气"
  "t": "时间"
```

---

## 6. 运维指南

### 6.1 日常运维

```bash
# 查看服务状态
pm2 status

# 查看日志
pm2 logs baize --lines 100

# 重启服务
pm2 restart baize

# 查看资源使用
pm2 monit

# 数据库备份
sqlite3 data/baize.db ".backup data/backups/baize_$(date +%Y%m%d).db"
```

### 6.2 日志管理

```bash
# 日志位置
logs/
├── baize.log          # 主日志
├── baize.log.1        # 轮转日志
└── error.log          # 错误日志

# 查看实时日志
tail -f logs/baize.log

# 搜索日志
grep "ERROR" logs/baize.log
grep "用户:" logs/baize.log | tail -20
```

### 6.3 数据库管理

```bash
# 查看数据库大小
ls -lh data/baize.db

# 查看表结构
sqlite3 data/baize.db ".schema"

# 查看记忆数量
sqlite3 data/baize.db "SELECT COUNT(*) FROM episodic_memory;"

# 清理旧记忆（保留最近1000条）
sqlite3 data/baize.db "DELETE FROM episodic_memory WHERE id NOT IN (SELECT id FROM episodic_memory ORDER BY timestamp DESC LIMIT 1000);"

# 数据库优化
sqlite3 data/baize.db "VACUUM;"
```

### 6.4 监控告警

```bash
# 简单监控脚本
#!/bin/bash
# monitor.sh

# 检查服务是否运行
if ! pm2 pid baize > /dev/null; then
  echo "白泽服务已停止，正在重启..."
  pm2 restart baize
fi

# 检查磁盘空间
DISK_USAGE=$(df -h / | tail -1 | awk '{print $5}' | sed 's/%//')
if [ $DISK_USAGE -gt 80 ]; then
  echo "磁盘使用率: ${DISK_USAGE}%"
fi

# 检查内存
MEM_USAGE=$(free | grep Mem | awk '{print int($3/$2 * 100)}')
if [ $MEM_USAGE -gt 80 ]; then
  echo "内存使用率: ${MEM_USAGE}%"
fi
```

### 6.5 更新升级

```bash
# 1. 备份数据
cp -r data data_backup_$(date +%Y%m%d)

# 2. 拉取最新代码
git pull origin main

# 3. 安装依赖
npm install

# 4. 编译
npm run build

# 5. 重启服务
pm2 restart baize

# 6. 验证
curl http://localhost:3000/health
```

---

## 7. 故障排查

### 7.1 常见问题

#### 服务无法启动

```bash
# 检查端口占用
lsof -i :3000

# 检查Node版本
node --version

# 检查依赖
npm install

# 查看错误日志
pm2 logs baize --err
```

#### LLM调用失败

```bash
# 检查API Key
echo $ALIYUN_API_KEY

# 测试API连接
curl -X POST https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions \
  -H "Authorization: Bearer $ALIYUN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen-max","messages":[{"role":"user","content":"hi"}]}'

# 检查网络
ping dashscope.aliyuncs.com
```

#### 数据库错误

```bash
# 检查数据库完整性
sqlite3 data/baize.db "PRAGMA integrity_check;"

# 修复数据库
sqlite3 data/baize.db ".recover" > recover.sql
sqlite3 data/baize_new.db < recover.sql
mv data/baize_new.db data/baize.db
```

#### 内存占用过高

```bash
# 查看内存使用
pm2 monit

# 重启服务释放内存
pm2 restart baize

# 设置内存限制
pm2 start dist/interaction/api.js --max-memory-restart 500M
```

### 7.2 日志分析

```bash
# 统计错误数量
grep -c "ERROR" logs/baize.log

# 查看最近的错误
grep "ERROR" logs/baize.log | tail -20

# 分析LLM调用
grep "LLM" logs/baize.log | tail -50

# 分析成本
grep "成本" logs/baize.log | tail -20
```

### 7.3 性能调优

```bash
# 增加Node.js内存限制
export NODE_OPTIONS="--max-old-space-size=1024"

# 调整并发数
# 在 config/system.yaml 中设置 executor.maxWorkers

# 启用缓存
# 在 config/system.yaml 中设置 cache.enabled: true
```

---

## 附录

### A. 服务管理命令

| 命令 | 说明 |
|-----|------|
| `pm2 start baize` | 启动服务 |
| `pm2 stop baize` | 停止服务 |
| `pm2 restart baize` | 重启服务 |
| `pm2 logs baize` | 查看日志 |
| `pm2 monit` | 监控资源 |
| `pm2 status` | 查看状态 |

### B. 目录结构

```
/opt/baize/
├── config/          # 配置文件
├── data/            # 数据目录
│   ├── baize.db    # 数据库
│   └── backups/    # 备份
├── logs/            # 日志目录
├── skills/          # 技能目录
├── dist/            # 编译输出
└── node_modules/    # 依赖
```

### C. 相关链接

- [开发文档](./DEVELOPMENT.md)
- [API文档](./API.md)
- [架构设计](./architecture.md)
