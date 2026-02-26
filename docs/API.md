# 白泽3.0 API 接口文档

**版本**: 3.0.2  
**适用对象**: 第三方开发者、GUI开发者  
**最后更新**: 2025年2月

---

## 目录

1. [概述](#1-概述)
2. [REST API](#2-rest-api)
3. [WebSocket API](#3-websocket-api)
4. [CLI 接口](#4-cli-接口)
5. [技能开发接口](#5-技能开发接口)
6. [SDK 使用](#6-sdk-使用)
7. [错误处理](#7-错误处理)

---

## 1. 概述

### 1.1 API 基础信息

| 项目 | 说明 |
|-----|------|
| 基础URL | `http://localhost:3000` |
| 协议 | HTTP/1.1, WebSocket |
| 数据格式 | JSON |
| 字符编码 | UTF-8 |
| 认证方式 | API Key（可选） |

### 1.2 快速开始

```bash
# 启动服务
npm start

# 或启动HTTP服务
node dist/interaction/api.js
```

### 1.3 通用响应格式

```typescript
// 成功响应
{
  "success": true,
  "data": { ... },
  "message": "操作成功"
}

// 错误响应
{
  "success": false,
  "error": "错误信息",
  "code": "ERROR_CODE"
}
```

---

## 2. REST API

### 2.1 健康检查

**GET** `/health`

检查服务是否正常运行。

**请求示例**:
```bash
curl http://localhost:3000/health
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "version": "3.0.2",
    "uptime": 3600
  }
}
```

---

### 2.2 对话接口

#### 2.2.1 发送消息

**POST** `/api/chat`

发送消息并获取回复。

**请求参数**:

| 参数 | 类型 | 必填 | 说明 |
|-----|------|------|------|
| message | string | 是 | 用户消息 |
| conversationId | string | 否 | 会话ID（用于多轮对话） |
| context | object | 否 | 额外上下文 |

**请求示例**:
```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "你好，请介绍一下你自己",
    "conversationId": "conv_001"
  }'
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "conversationId": "conv_001",
    "response": "你好！我是白泽，一个智能助手...",
    "thoughtProcess": {
      "understanding": {
        "coreNeed": "自我介绍",
        "isSimpleChat": true
      },
      "duration": 1.5
    },
    "tasks": [],
    "cost": {
      "tokens": 150,
      "cost": 0.001
    }
  }
}
```

#### 2.2.2 获取对话历史

**GET** `/api/chat/history/:conversationId`

获取指定会话的对话历史。

**请求示例**:
```bash
curl http://localhost:3000/api/chat/history/conv_001
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "conversationId": "conv_001",
    "messages": [
      {
        "role": "user",
        "content": "你好",
        "timestamp": "2025-02-23T10:00:00Z"
      },
      {
        "role": "assistant",
        "content": "你好！我是白泽...",
        "timestamp": "2025-02-23T10:00:02Z"
      }
    ]
  }
}
```

---

### 2.3 技能接口

#### 2.3.1 获取技能列表

**GET** `/api/skills`

获取所有已加载的技能。

**请求示例**:
```bash
curl http://localhost:3000/api/skills
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "skills": [
      {
        "name": "chat",
        "description": "对话技能",
        "capabilities": ["chat", "conversation"],
        "riskLevel": "low"
      },
      {
        "name": "file",
        "description": "文件操作技能",
        "capabilities": ["file", "read", "write"],
        "riskLevel": "medium"
      },
      {
        "name": "time",
        "description": "时间查询技能",
        "capabilities": ["time", "datetime"],
        "riskLevel": "low"
      }
    ],
    "total": 3
  }
}
```

#### 2.3.2 执行技能

**POST** `/api/skills/execute`

直接执行指定技能。

**请求参数**:

| 参数 | 类型 | 必填 | 说明 |
|-----|------|------|------|
| skillName | string | 是 | 技能名称 |
| params | object | 是 | 技能参数 |

**请求示例**:
```bash
curl -X POST http://localhost:3000/api/skills/execute \
  -H "Content-Type: application/json" \
  -d '{
    "skillName": "time",
    "params": {
      "format": "%Y-%m-%d %H:%M:%S"
    }
  }'
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "result": "2025-02-23 10:30:00",
    "duration": 0.05
  }
}
```

#### 2.3.3 安装技能

**POST** `/api/skills/install`

从技能市场安装技能。

**请求参数**:

| 参数 | 类型 | 必填 | 说明 |
|-----|------|------|------|
| skillId | string | 是 | 技能ID |
| version | string | 否 | 版本号 |

**请求示例**:
```bash
curl -X POST http://localhost:3000/api/skills/install \
  -H "Content-Type: application/json" \
  -d '{
    "skillId": "weather",
    "version": "1.0.0"
  }'
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "skillName": "weather",
    "version": "1.0.0",
    "path": "skills/weather",
    "message": "技能安装成功"
  }
}
```

---

### 2.4 技能市场接口

#### 2.4.1 搜索技能

**GET** `/api/market/search`

搜索技能市场中的技能。

**请求参数**:

| 参数 | 类型 | 必填 | 说明 |
|-----|------|------|------|
| q | string | 是 | 搜索关键词 |
| category | string | 否 | 分类 |
| limit | number | 否 | 返回数量 |

**请求示例**:
```bash
curl "http://localhost:3000/api/market/search?q=weather&limit=10"
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "results": [
      {
        "id": "weather",
        "name": "weather",
        "description": "天气查询技能",
        "capabilities": ["weather", "forecast"],
        "downloads": 10000,
        "rating": 4.8,
        "verified": true
      }
    ],
    "total": 1
  }
}
```

#### 2.4.2 获取技能详情

**GET** `/api/market/skill/:skillId`

获取技能市场中的技能详情。

**请求示例**:
```bash
curl http://localhost:3000/api/market/skill/weather
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "id": "weather",
    "name": "weather",
    "description": "天气查询技能",
    "capabilities": ["weather", "forecast"],
    "downloads": 10000,
    "rating": 4.8,
    "verified": true,
    "versions": ["1.0.0", "1.1.0", "2.0.0"],
    "author": "baize-team",
    "license": "MIT",
    "readme": "# Weather Skill\n\n..."
  }
}
```

---

### 2.5 记忆接口

#### 2.5.1 获取记忆统计

**GET** `/api/memory/stats`

获取记忆系统统计信息。

**请求示例**:
```bash
curl http://localhost:3000/api/memory/stats
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "episodic": {
      "total": 150,
      "byType": {
        "conversation": 100,
        "task": 50
      }
    },
    "declarative": {
      "total": 30,
      "topKeys": ["user.preference", "system.config"]
    },
    "procedural": {
      "total": 10
    }
  }
}
```

#### 2.5.2 查询记忆

**GET** `/api/memory/search`

搜索记忆内容。

**请求参数**:

| 参数 | 类型 | 必填 | 说明 |
|-----|------|------|------|
| q | string | 是 | 搜索关键词 |
| type | string | 否 | 记忆类型 |
| limit | number | 否 | 返回数量 |

**请求示例**:
```bash
curl "http://localhost:3000/api/memory/search?q=文件&type=episodic"
```

---

### 2.6 成本接口

#### 2.6.1 获取成本统计

**GET** `/api/cost/stats`

获取成本使用统计。

**请求示例**:
```bash
curl http://localhost:3000/api/cost/stats
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "today": 0.05,
    "yesterday": 0.12,
    "thisWeek": 0.35,
    "thisMonth": 1.20,
    "dailyBudget": 10,
    "usagePercent": 0.5
  }
}
```

#### 2.6.2 获取成本配置

**GET** `/api/cost/config`

获取当前成本配置。

**请求示例**:
```bash
curl http://localhost:3000/api/cost/config
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "dailyBudget": 10,
    "perTaskBudget": 0.5,
    "alertThreshold": 80,
    "hardLimit": true
  }
}
```

#### 2.6.3 更新成本配置

**PUT** `/api/cost/config`

更新成本配置。

**请求示例**:
```bash
curl -X PUT http://localhost:3000/api/cost/config \
  -H "Content-Type: application/json" \
  -d '{
    "dailyBudget": 20,
    "alertThreshold": 90
  }'
```

---

### 2.7 任务接口

#### 2.7.1 获取任务列表

**GET** `/api/tasks`

获取任务列表（包括主动任务）。

**请求示例**:
```bash
curl http://localhost:3000/api/tasks
```

**响应示例**:
```json
{
  "success": true,
  "data": {
    "tasks": [
      {
        "id": "task_001",
        "type": "time",
        "trigger": {
          "type": "time",
          "cron": "0 8 * * *"
        },
        "action": {
          "type": "notify",
          "message": "早上好！"
        },
        "status": "active"
      }
    ]
  }
}
```

#### 2.7.2 创建主动任务

**POST** `/api/tasks`

创建新的主动任务。

**请求参数**:

| 参数 | 类型 | 必填 | 说明 |
|-----|------|------|------|
| type | string | 是 | 任务类型 |
| trigger | object | 是 | 触发配置 |
| action | object | 是 | 动作配置 |

**请求示例**:
```bash
curl -X POST http://localhost:3000/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "type": "reminder",
    "trigger": {
      "type": "time",
      "datetime": "2025-02-24T09:00:00Z"
    },
    "action": {
      "type": "notify",
      "message": "开会提醒"
    }
  }'
```

---

## 3. WebSocket API

### 3.1 连接

**WebSocket URL**: `ws://localhost:3000/ws`

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');

ws.onopen = () => {
  console.log('已连接');
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('收到消息:', data);
};
```

### 3.2 消息格式

所有消息均为JSON格式：

```typescript
interface WSMessage {
  type: string;      // 消息类型
  id?: string;       // 消息ID（用于响应匹配）
  data?: any;        // 消息数据
}
```

### 3.3 消息类型

#### 3.3.1 发送消息

**客户端发送**:
```json
{
  "type": "chat",
  "id": "msg_001",
  "data": {
    "message": "你好"
  }
}
```

**服务端响应**:
```json
{
  "type": "chat_response",
  "id": "msg_001",
  "data": {
    "response": "你好！我是白泽...",
    "conversationId": "conv_001"
  }
}
```

#### 3.3.2 思考过程推送

**服务端推送**:
```json
{
  "type": "thinking_progress",
  "data": {
    "phase": "understanding",
    "message": "正在理解您的需求...",
    "progress": 20
  }
}
```

**阶段说明**:

| 阶段 | 说明 | 进度 |
|-----|------|------|
| understanding | 理解用户意图 | 0-20% |
| decomposing | 拆解任务 | 20-40% |
| planning | 制定计划 | 40-60% |
| scheduling | 调度执行 | 60-80% |
| executing | 执行任务 | 80-95% |
| completed | 完成 | 100% |

#### 3.3.3 任务执行推送

**服务端推送**:
```json
{
  "type": "task_progress",
  "data": {
    "taskId": "task_001",
    "status": "running",
    "skillName": "file",
    "message": "正在创建文件..."
  }
}
```

#### 3.3.4 成本告警

**服务端推送**:
```json
{
  "type": "cost_alert",
  "data": {
    "level": "warning",
    "message": "已使用80%的日预算",
    "usage": 8.5,
    "budget": 10
  }
}
```

### 3.4 完整示例

```javascript
// GUI 客户端示例
class BaizeClient {
  constructor(url = 'ws://localhost:3000/ws') {
    this.ws = new WebSocket(url);
    this.callbacks = new Map();
    
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleMessage(message);
    };
  }
  
  // 发送消息
  async chat(message) {
    const id = `msg_${Date.now()}`;
    
    return new Promise((resolve) => {
      this.callbacks.set(id, resolve);
      
      this.ws.send(JSON.stringify({
        type: 'chat',
        id,
        data: { message }
      }));
    });
  }
  
  // 处理消息
  handleMessage(message) {
    if (message.id && this.callbacks.has(message.id)) {
      const callback = this.callbacks.get(message.id);
      callback(message.data);
      this.callbacks.delete(message.id);
    }
    
    // 处理推送消息
    switch (message.type) {
      case 'thinking_progress':
        this.onThinkingProgress?.(message.data);
        break;
      case 'task_progress':
        this.onTaskProgress?.(message.data);
        break;
      case 'cost_alert':
        this.onCostAlert?.(message.data);
        break;
    }
  }
}

// 使用示例
const client = new BaizeClient();

client.onThinkingProgress = (data) => {
  console.log(`思考进度: ${data.progress}% - ${data.message}`);
};

client.onTaskProgress = (data) => {
  console.log(`任务进度: ${data.skillName} - ${data.status}`);
};

// 发送消息
const response = await client.chat('你好');
console.log('回复:', response.response);
```

---

## 4. CLI 接口

### 4.1 命令列表

| 命令 | 说明 |
|-----|------|
| `baize start` | 启动交互模式 |
| `baize chat <message>` | 单次对话 |
| `baize skill list` | 列出技能 |
| `baize skill install <name>` | 安装技能 |
| `baize task list` | 列出任务 |
| `baize task create` | 创建任务 |
| `baize cost stats` | 成本统计 |
| `baize memory search <query>` | 搜索记忆 |

### 4.2 命令详解

#### 4.2.1 启动交互模式

```bash
baize start [options]

选项:
  --provider <name>    指定LLM提供商
  --debug              调试模式
```

#### 4.2.2 单次对话

```bash
baize chat "你好" [options]

选项:
  --provider <name>    指定LLM提供商
  --json               JSON格式输出
```

**输出示例**:
```json
{
  "response": "你好！我是白泽...",
  "duration": 1.5,
  "cost": 0.001
}
```

#### 4.2.3 技能管理

```bash
# 列出技能
baize skill list

# 安装技能
baize skill install weather

# 执行技能
baize skill exec time --params '{"format":"%Y-%m-%d"}'
```

#### 4.2.4 任务管理

```bash
# 列出任务
baize task list

# 创建定时任务
baize task create --type time --cron "0 8 * * *" --action "notify" --message "早上好"

# 删除任务
baize task delete <task-id>
```

### 4.3 程序化调用

```javascript
// 从代码调用CLI
const { exec } = require('child_process');

// 单次对话
exec('node dist/cli/index.js chat "你好" --json', (error, stdout) => {
  if (!error) {
    const result = JSON.parse(stdout);
    console.log(result.response);
  }
});
```

---

## 5. 技能开发接口

### 5.1 技能输入格式

技能通过环境变量 `BAIZE_PARAMS` 接收参数：

```json
{
  "params": {
    // 技能参数
  },
  "context": {
    "userId": "user_001",
    "conversationId": "conv_001"
  }
}
```

### 5.2 技能输出格式

技能必须输出JSON格式到stdout：

```json
{
  "success": true,
  "data": {
    // 返回数据
  },
  "message": "执行成功"
}
```

### 5.3 技能参数规范

#### chat 技能

```json
{
  "params": {
    "message": "要发送的消息",
    "history": [
      { "role": "user", "content": "历史消息" }
    ]
  }
}
```

#### file 技能

```json
{
  "params": {
    "action": "read|write|create|delete|exists",
    "path": "文件路径",
    "content": "文件内容（写入时）",
    "encoding": "utf-8"
  }
}
```

#### time 技能

```json
{
  "params": {
    "format": "%Y-%m-%d %H:%M:%S",
    "timezone": "UTC"
  }
}
```

### 5.4 技能开发模板

#### JavaScript 模板

```javascript
#!/usr/bin/env node
/**
 * 技能名称 - JavaScript实现
 */

function main() {
  try {
    // 获取参数
    let input = { params: {} };
    
    if (process.env.BAIZE_PARAMS) {
      input = JSON.parse(process.env.BAIZE_PARAMS);
    }
    
    const { params = {} } = input;
    
    // 执行技能逻辑
    const result = execute(params);
    
    // 返回成功结果
    console.log(JSON.stringify({
      success: true,
      data: result,
      message: '执行成功'
    }));
    
  } catch (error) {
    // 返回错误结果
    console.log(JSON.stringify({
      success: false,
      error: error.message
    }));
    process.exit(1);
  }
}

function execute(params) {
  // 实现技能逻辑
  return {};
}

main();
```

#### Python 模板

```python
#!/usr/bin/env python3
"""
技能名称 - Python实现
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
        
        # 执行技能逻辑
        result = execute(params)
        
        # 返回成功结果
        print(json.dumps({
            'success': True,
            'data': result,
            'message': '执行成功'
        }))
        
    except Exception as e:
        # 返回错误结果
        print(json.dumps({
            'success': False,
            'error': str(e)
        }))
        sys.exit(1)

def execute(params):
    # 实现技能逻辑
    return {}

if __name__ == '__main__':
    main()
```

---

## 6. SDK 使用

### 6.1 JavaScript/TypeScript SDK

```typescript
import { BaizeClient } from 'baize-sdk';

// 创建客户端
const client = new BaizeClient({
  baseURL: 'http://localhost:3000',
  // apiKey: 'your-api-key'  // 可选
});

// 发送消息
const response = await client.chat('你好');
console.log(response.content);

// 执行技能
const result = await client.executeSkill('time', {
  format: '%Y-%m-%d'
});
console.log(result.data);

// 搜索技能市场
const skills = await client.searchMarket('weather');
console.log(skills);

// 安装技能
await client.installSkill('weather');
```

### 6.2 Python SDK

```python
from baize import BaizeClient

# 创建客户端
client = BaizeClient(base_url='http://localhost:3000')

# 发送消息
response = client.chat('你好')
print(response.content)

# 执行技能
result = client.execute_skill('time', {
    'format': '%Y-%m-%d'
})
print(result.data)
```

### 6.3 HTTP 直接调用

```bash
# 使用 curl
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "你好"}'
```

---

## 7. 错误处理

### 7.1 错误码

| 错误码 | 说明 |
|-------|------|
| SUCCESS | 成功 |
| INVALID_PARAMS | 参数无效 |
| SKILL_NOT_FOUND | 技能不存在 |
| SKILL_ERROR | 技能执行错误 |
| LLM_ERROR | LLM调用错误 |
| BUDGET_EXCEEDED | 预算超限 |
| PERMISSION_DENIED | 权限不足 |
| INTERNAL_ERROR | 内部错误 |

### 7.2 错误响应格式

```json
{
  "success": false,
  "error": "错误描述",
  "code": "ERROR_CODE",
  "details": {
    "field": "message",
    "reason": "消息不能为空"
  }
}
```

### 7.3 错误处理示例

```javascript
try {
  const response = await client.chat('你好');
} catch (error) {
  if (error.code === 'BUDGET_EXCEEDED') {
    console.log('预算已用完，请充值');
  } else if (error.code === 'SKILL_NOT_FOUND') {
    console.log('技能不存在');
  } else {
    console.log('发生错误:', error.message);
  }
}
```

---

## 附录

### A. 完整API列表

| 方法 | 路径 | 说明 |
|-----|------|------|
| GET | /health | 健康检查 |
| POST | /api/chat | 发送消息 |
| GET | /api/chat/history/:id | 获取历史 |
| GET | /api/skills | 技能列表 |
| POST | /api/skills/execute | 执行技能 |
| POST | /api/skills/install | 安装技能 |
| GET | /api/market/search | 搜索市场 |
| GET | /api/market/skill/:id | 技能详情 |
| GET | /api/memory/stats | 记忆统计 |
| GET | /api/memory/search | 搜索记忆 |
| GET | /api/cost/stats | 成本统计 |
| GET | /api/cost/config | 成本配置 |
| PUT | /api/cost/config | 更新配置 |
| GET | /api/tasks | 任务列表 |
| POST | /api/tasks | 创建任务 |
| DELETE | /api/tasks/:id | 删除任务 |

### B. WebSocket 消息类型

| 类型 | 方向 | 说明 |
|-----|------|------|
| chat | C→S | 发送消息 |
| chat_response | S→C | 消息响应 |
| thinking_progress | S→C | 思考进度 |
| task_progress | S→C | 任务进度 |
| cost_alert | S→C | 成本告警 |

### C. 相关链接

- [开发文档](./DEVELOPMENT.md)
- [架构设计](./architecture.md)
- [部署文档](./DEPLOYMENT.md)
