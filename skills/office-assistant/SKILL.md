---
name: office-assistant
description: "文员办公助手 - 文档处理、表格操作、格式转换、内容整理等"
version: "1.0.0"
author: "Baize Team"
capabilities:
  - document-processing
  - text-formatting
  - table-generation
  - content-summary
  - template-filling
risk_level: "low"
when_to_use: "当用户需要处理文档、整理内容、生成表格、格式转换、写报告、做总结等办公任务时使用"
input_schema:
  type: object
  properties:
    action:
      type: string
      description: "要执行的操作"
      enum: ["summarize", "format", "table", "template", "convert", "extract", "organize", "report"]
    content:
      type: string
      description: "要处理的内容"
    format:
      type: string
      description: "目标格式 (markdown, html, json, csv)"
    template:
      type: string
      description: "模板名称或内容"
    data:
      type: object
      description: "模板填充数据"
    options:
      type: object
      description: "其他选项"
  required:
    - action
output_schema:
  type: object
  properties:
    success:
      type: boolean
    data:
      type: object
    message:
      type: string
examples:
  - input:
      action: "summarize"
      content: "长文本内容..."
    output:
      success: true
      message: "已生成摘要"
      data:
        summary: "摘要内容..."
  - input:
      action: "table"
      content: "销售数据..."
    output:
      success: true
      message: "已生成表格"
---

# 文员办公助手技能

## 功能说明

这个技能提供各种办公自动化功能，帮助处理日常文员工作。

### 支持的操作

1. **summarize** - 内容摘要
   - 参数：content
   - 生成长文本的摘要

2. **format** - 格式化文本
   - 参数：content, format (markdown/html/json)
   - 将文本转换为指定格式

3. **table** - 生成表格
   - 参数：content, format (markdown/csv)
   - 将数据生成表格

4. **template** - 模板填充
   - 参数：template, data
   - 使用数据填充模板

5. **convert** - 格式转换
   - 参数：content, format
   - 转换内容格式

6. **extract** - 提取信息
   - 参数：content, options
   - 从内容中提取特定信息

7. **organize** - 整理内容
   - 参数：content
   - 整理和结构化内容

8. **report** - 生成报告
   - 参数：content, template
   - 根据内容生成报告

## 使用场景

- 会议纪要整理
- 文档摘要生成
- 数据表格制作
- 报告自动生成
- 内容格式转换
- 信息提取整理

## 示例用法

```bash
# 生成摘要
baize chat "帮我总结这段文字：..."

# 生成表格
baize chat "把这些数据做成表格：张三 90分，李四 85分"

# 格式转换
baize chat "把这段内容转成Markdown格式"

# 生成报告
baize chat "根据这些数据写一份周报"
```

## 内置模板

- 周报模板
- 会议纪要模板
- 工作总结模板
- 项目报告模板
