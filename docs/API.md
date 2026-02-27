# 白泽 API 文档

## 概述

白泽提供 REST API 和流式 API 两种接口。

## 基础 URL

```
http://localhost:3000
```

## 端点

### 健康检查

```
GET /health
```

响应:
```json
{
  "status": "healthy",
  "version": "3.2.0"
}
```

### 聊天

```
POST /api/chat
```

请求:
```json
{
  "message": "你好",
  "sessionId": "optional-session-id"
}
```

响应:
```json
{
  "success": true,
  "data": {
    "response": "你好！有什么可以帮助你的？",
    "sessionId": "session-xxx"
  }
}
```

### 流式聊天

```
POST /api/chat/stream
```

请求:
```json
{
  "message": "你好"
}
```

响应 (SSE):
```
event: thinking
data: {"stage":"decide","message":"分析用户输入"}

event: content
data: {"text":"你好！","isDelta":true}

event: done
data: {"duration":1234}
```

### 技能列表

```
GET /api/skills
```

响应:
```json
{
  "success": true,
  "data": {
    "skills": [
      {
        "name": "web_search",
        "description": "搜索网络"
      }
    ]
  }
}
```

### 记忆统计

```
GET /api/memory/stats
```

响应:
```json
{
  "success": true,
  "data": {
    "episodes": 100,
    "declarative": 50,
    "procedural": 10
  }
}
```

## 错误处理

所有错误响应格式:
```json
{
  "success": false,
  "error": "错误描述"
}
```

## 认证

如果配置了 API_KEY，需要在请求头中添加:
```
Authorization: Bearer YOUR_API_KEY
```
