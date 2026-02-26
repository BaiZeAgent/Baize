---
name: file
version: 1.0.0
author: baize
description: 文件读写操作，支持创建、读取、写入、删除文件
capabilities:
  - file
  - read
  - write
  - create
  - delete
  - exists
risk_level: medium
step_by_step: false
auto_execute: true
timeout: 30000
input_schema:
  type: object
  properties:
    action:
      type: string
      enum: [read, write, create, delete, exists]
      description: 操作类型
    path:
      type: string
      description: 文件路径（支持绝对路径和相对路径）
    content:
      type: string
      description: 写入内容（write/create时需要）
    encoding:
      type: string
      default: utf-8
      description: 文件编码
  required: [action, path]
output_schema:
  type: object
  properties:
    success:
      type: boolean
    content:
      type: string
      description: 文件内容（read时返回）
    path:
      type: string
      description: 文件路径
    size:
      type: number
      description: 文件大小（字节）
    exists:
      type: boolean
      description: 文件是否存在（exists时返回）
examples:
  - input:
      action: create
      path: "G:/test.txt"
      content: "Hello World"
    output:
      success: true
      path: "G:/test.txt"
      size: 11
    description: 创建文件并写入内容
  - input:
      action: read
      path: "G:/test.txt"
    output:
      success: true
      content: "Hello World"
    description: 读取文件内容
---

# 文件操作技能

## 功能说明

提供文件系统操作能力，包括：

| 操作 | 说明 | 风险等级 |
|-----|------|---------|
| read | 读取文件内容 | 低 |
| write | 写入文件（覆盖已有内容） | 中 |
| create | 创建新文件（如存在则覆盖） | 中 |
| delete | 删除文件 | 高 |
| exists | 检查文件是否存在 | 低 |

## 使用示例

### 创建文件
```json
{
  "action": "create",
  "path": "G:/test.txt",
  "content": "Hello World"
}
```

### 读取文件
```json
{
  "action": "read",
  "path": "G:/test.txt"
}
```

### 写入文件
```json
{
  "action": "write",
  "path": "G:/test.txt",
  "content": "新的内容"
}
```

### 删除文件
```json
{
  "action": "delete",
  "path": "G:/test.txt"
}
```

### 检查文件是否存在
```json
{
  "action": "exists",
  "path": "G:/test.txt"
}
```

## 注意事项

1. **路径格式**：支持绝对路径（如 `G:/test.txt`）和相对路径
2. **自动创建目录**：write和create操作会自动创建不存在的父目录
3. **删除警告**：delete操作不可恢复，请谨慎使用
4. **编码支持**：默认使用UTF-8编码

## 错误处理

| 错误 | 原因 | 解决方案 |
|-----|------|---------|
| 文件不存在 | read/delete时文件不存在 | 先使用exists检查 |
| 权限不足 | 没有读写权限 | 检查文件权限 |
| 路径无效 | 路径格式错误 | 使用正确的路径格式 |
