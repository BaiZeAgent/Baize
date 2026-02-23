---
name: fs
version: 1.0.0
author: baize
description: 文件系统操作，支持创建目录、创建文件、列出目录、删除文件等
capabilities:
  - fs
  - filesystem
  - mkdir
  - touch
  - ls
  - rm
  - directory
risk_level: medium
step_by_step: false
auto_execute: true
timeout: 10000
input_schema:
  type: object
  properties:
    action:
      type: string
      enum: [mkdir, touch, ls, rm, write, read]
      description: 操作类型
    path:
      type: string
      description: 文件或目录路径
    content:
      type: string
      description: 文件内容（write时使用）
  required: [action, path]
output_schema:
  type: object
  properties:
    success:
      type: boolean
    message:
      type: string
    data:
      type: object
examples:
  - input:
      action: mkdir
      path: "G:/test_dir"
    output:
      success: true
      message: "目录已创建: G:/test_dir"
  - input:
      action: touch
      path: "G:/test_dir/hello.txt"
    output:
      success: true
      message: "文件已创建: G:/test_dir/hello.txt"
  - input:
      action: ls
      path: "G:/test_dir"
    output:
      success: true
      data:
        items: ["hello.txt"]
---

# 文件系统操作技能

## 功能说明

提供简单的文件系统操作能力：

| 操作 | 说明 | 示例 |
|-----|------|------|
| mkdir | 创建目录 | `{"action": "mkdir", "path": "G:/test"}` |
| touch | 创建空文件 | `{"action": "touch", "path": "G:/test.txt"}` |
| ls | 列出目录内容 | `{"action": "ls", "path": "G:/test"}` |
| rm | 删除文件或目录 | `{"action": "rm", "path": "G:/test.txt"}` |
| write | 写入文件 | `{"action": "write", "path": "G:/test.txt", "content": "hello"}` |
| read | 读取文件 | `{"action": "read", "path": "G:/test.txt"}` |

## 使用示例

### 创建目录
```json
{"action": "mkdir", "path": "G:/my_project"}
```

### 创建文件
```json
{"action": "touch", "path": "G:/my_project/readme.md"}
```

### 写入内容
```json
{"action": "write", "path": "G:/my_project/readme.md", "content": "# 我的项目\n\n这是我的测试项目"}
```

### 列出目录
```json
{"action": "ls", "path": "G:/my_project"}
```

### 读取文件
```json
{"action": "read", "path": "G:/my_project/readme.md"}
```

### 删除文件
```json
{"action": "rm", "path": "G:/my_project/readme.md"}
```

## 注意事项

- 路径支持绝对路径和相对路径
- mkdir会自动创建父目录
- rm删除目录时会删除目录下所有内容
