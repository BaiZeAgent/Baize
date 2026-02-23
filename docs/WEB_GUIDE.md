# 白泽3.0 Web 前端开发指南

**版本**: 3.0.2  
**适用对象**: Web 前端开发者、第三方开发者  
**最后更新**: 2025年2月

---

## 目录

1. [架构概述](#1-架构概述)
2. [API 接口](#2-api-接口)
3. [WebSocket 实时通信](#3-websocket-实时通信)
4. [前端项目示例](#4-前端项目示例)
5. [部署方案](#5-部署方案)

---

## 1. 架构概述

### 1.1 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    Web 前端 (独立项目)                           │
│                   baize-web (React/Vue)                          │
│                                                                 │
│   ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐              │
│   │ 对话界面 │ │技能管理 │ │记忆管理 │ │成本管理 │              │
│   └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘              │
│        │           │           │           │                    │
│        └───────────┴───────────┴───────────┘                    │
│                          │                                      │
│                    HTTP API / WebSocket                          │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    白泽 API 服务                                 │
│                  (标准化 REST API)                               │
│                                                                 │
│   端口: 3000 (可配置)                                            │
│   CORS: 已启用                                                   │
└─────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    核心服务层                                    │
│   Brain / ThinkingEngine / Skills / Memory / Executor           │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 技术栈建议

| 层级 | 推荐技术 |
|-----|---------|
| 前端框架 | React 18+ / Vue 3+ |
| UI 组件 | Ant Design / Element Plus / shadcn/ui |
| 状态管理 | Zustand / Pinia |
| HTTP 客户端 | Axios / Fetch |
| WebSocket | Socket.io-client |
| 构建工具 | Vite / Next.js |

---

## 2. API 接口

### 2.1 基础信息

```
Base URL: http://localhost:3000
Content-Type: application/json
```

### 2.2 健康检查

```http
GET /health
```

响应：
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

### 2.3 对话接口

#### 发送消息

```http
POST /api/chat
Content-Type: application/json

{
  "message": "你好"
}
```

响应：
```json
{
  "success": true,
  "data": {
    "type": "reply",
    "response": "早上好！有什么我可以帮助你的吗？",
    "intent": "greeting",
    "duration": 0.001
  }
}
```

#### 获取对话历史

```http
GET /api/chat/history
```

响应：
```json
{
  "success": true,
  "data": {
    "history": [
      { "role": "user", "content": "你好" },
      { "role": "assistant", "content": "早上好！" }
    ]
  }
}
```

#### 清空对话历史

```http
DELETE /api/chat/history
```

### 2.4 技能接口

#### 获取技能列表

```http
GET /api/skills
```

响应：
```json
{
  "success": true,
  "data": {
    "skills": [
      {
        "name": "time",
        "description": "获取当前时间",
        "capabilities": ["time", "datetime"],
        "riskLevel": "low"
      }
    ],
    "total": 4
  }
}
```

#### 执行技能

```http
POST /api/skills/execute
Content-Type: application/json

{
  "skillName": "time",
  "params": {}
}
```

响应：
```json
{
  "success": true,
  "data": {
    "result": "2026-02-23 10:30:00"
  },
  "message": "现在是 2026/2/23 10:30:00"
}
```

### 2.5 成本接口

#### 获取成本统计

```http
GET /api/cost/stats
```

响应：
```json
{
  "success": true,
  "data": {
    "todayCost": 0.05,
    "todayRequests": 100,
    "monthCost": 1.5,
    "budgetRemaining": 8.5
  }
}
```

---

## 3. WebSocket 实时通信

### 3.1 连接

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000');

socket.on('connect', () => {
  console.log('已连接');
});
```

### 3.2 发送消息

```javascript
socket.emit('chat', { message: '你好' });
```

### 3.3 接收响应

```javascript
socket.on('chat_response', (data) => {
  if (data.success) {
    console.log('回复:', data.decision.response);
  }
});
```

---

## 4. 前端项目示例

### 4.1 React 项目结构

```
baize-web/
├── src/
│   ├── components/
│   │   ├── Chat/
│   │   │   ├── ChatWindow.tsx
│   │   │   ├── MessageList.tsx
│   │   │   └── InputBox.tsx
│   │   ├── Skills/
│   │   │   ├── SkillList.tsx
│   │   │   └── SkillCard.tsx
│   │   └── Layout/
│   │       └── Sidebar.tsx
│   ├── hooks/
│   │   ├── useChat.ts
│   │   └── useSocket.ts
│   ├── services/
│   │   └── api.ts
│   ├── stores/
│   │   └── chatStore.ts
│   └── App.tsx
├── package.json
└── vite.config.ts
```

### 4.2 API 服务封装

```typescript
// src/services/api.ts
const API_BASE = 'http://localhost:3000';

export const api = {
  // 对话
  async chat(message: string) {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    return res.json();
  },

  // 获取历史
  async getHistory() {
    const res = await fetch(`${API_BASE}/api/chat/history`);
    return res.json();
  },

  // 清空历史
  async clearHistory() {
    const res = await fetch(`${API_BASE}/api/chat/history`, {
      method: 'DELETE',
    });
    return res.json();
  },

  // 获取技能
  async getSkills() {
    const res = await fetch(`${API_BASE}/api/skills`);
    return res.json();
  },

  // 执行技能
  async executeSkill(skillName: string, params: any) {
    const res = await fetch(`${API_BASE}/api/skills/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillName, params }),
    });
    return res.json();
  },

  // 获取成本
  async getCostStats() {
    const res = await fetch(`${API_BASE}/api/cost/stats`);
    return res.json();
  },
};
```

### 4.3 对话组件示例

```tsx
// src/components/Chat/ChatWindow.tsx
import { useState } from 'react';
import { api } from '../../services/api';

export function ChatWindow() {
  const [messages, setMessages] = useState<Array<{
    role: 'user' | 'assistant';
    content: string;
  }>>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const sendMessage = async () => {
    if (!input.trim()) return;

    const userMessage = { role: 'user' as const, content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await api.chat(input);
      
      if (response.success) {
        const assistantMessage = {
          role: 'assistant' as const,
          content: response.data.response || '任务执行完成',
        };
        setMessages(prev => [...prev, assistantMessage]);
      }
    } catch (error) {
      console.error('发送失败:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="chat-window">
      <div className="messages">
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            {msg.content}
          </div>
        ))}
        {loading && <div className="loading">思考中...</div>}
      </div>
      
      <div className="input-area">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="输入消息..."
        />
        <button onClick={sendMessage} disabled={loading}>
          发送
        </button>
      </div>
    </div>
  );
}
```

---

## 5. 部署方案

### 5.1 开发环境

```bash
# 启动白泽 API
cd baize-nodejs
node dist/interaction/api.js

# 启动前端开发服务器
cd baize-web
npm run dev
```

### 5.2 生产环境

```yaml
# docker-compose.yml
version: '3'
services:
  baize-api:
    build: ./baize-nodejs
    ports:
      - "3000:3000"
    environment:
      - ALIYUN_API_KEY=${ALIYUN_API_KEY}
    volumes:
      - ./data:/app/data

  baize-web:
    build: ./baize-web
    ports:
      - "80:80"
    depends_on:
      - baize-api
```

### 5.3 Nginx 配置

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 前端静态文件
    location / {
        root /var/www/baize-web;
        try_files $uri $uri/ /index.html;
    }

    # API 代理
    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # WebSocket 代理
    location /socket.io {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

---

## 附录

### A. API 错误码

| 状态码 | 说明 |
|-------|------|
| 200 | 成功 |
| 400 | 请求参数错误 |
| 404 | 资源不存在 |
| 500 | 服务器内部错误 |

### B. 前端项目模板

推荐使用以下模板快速开始：

- React: https://github.com/your-repo/baize-web-react
- Vue: https://github.com/your-repo/baize-web-vue

### C. 相关文档

- [API 文档](./API.md)
- [开发文档](./DEVELOPMENT.md)
- [部署文档](./DEPLOYMENT.md)
