---
name: time
version: 1.0.0
author: baize
description: 获取当前时间和日期，支持多种格式输出
capabilities:
  - time
  - datetime
  - clock
  - date
  - timestamp
risk_level: low
step_by_step: false
auto_execute: true
timeout: 5000
input_schema:
  type: object
  properties:
    format:
      type: string
      enum: [full, date, time, timestamp, iso, unix]
      default: full
      description: 时间格式
    timezone:
      type: string
      default: local
      description: 时区（如 Asia/Shanghai）
output_schema:
  type: object
  properties:
    timestamp:
      type: string
      description: ISO格式时间戳
    formatted:
      type: string
      description: 格式化的时间字符串
    unix:
      type: number
      description: Unix时间戳（秒）
examples:
  - input: {}
    output:
      success: true
      timestamp: "2025-02-22T16:30:00.000Z"
      formatted: "2025/2/22 16:30:00"
      unix: 1740235800
    description: 获取完整时间
  - input:
      format: date
    output:
      success: true
      formatted: "2025/2/22"
    description: 获取日期
  - input:
      format: time
    output:
      success: true
      formatted: "16:30:00"
    description: 获取时间
---

# 时间技能

## 功能说明

获取当前时间和日期信息，支持多种输出格式。

| 格式 | 说明 | 示例 |
|-----|------|------|
| full | 完整日期时间 | 2025/2/22 16:30:00 |
| date | 仅日期 | 2025/2/22 |
| time | 仅时间 | 16:30:00 |
| timestamp | ISO时间戳 | 2025-02-22T16:30:00.000Z |
| iso | ISO格式 | 2025-02-22T16:30:00+08:00 |
| unix | Unix时间戳 | 1740235800 |

## 使用示例

### 获取完整时间
```json
{}
```

### 获取日期
```json
{
  "format": "date"
}
```

### 获取时间
```json
{
  "format": "time"
}
```

### 获取ISO时间戳
```json
{
  "format": "iso"
}
```

### 获取Unix时间戳
```json
{
  "format": "unix"
}
```

## 返回数据

```json
{
  "success": true,
  "data": {
    "timestamp": "2025-02-22T16:30:00.000Z",
    "formatted": "2025/2/22 16:30:00",
    "unix": 1740235800,
    "year": 2025,
    "month": 2,
    "day": 22,
    "hour": 16,
    "minute": 30,
    "second": 0,
    "weekday": "星期六"
  },
  "message": "现在是 2025/2/22 16:30:00"
}
```
