---
name: time
slug: time
description: 获取当前时间和日期信息。用于回答"现在几点"、"今天星期几"、"今天日期"等问题。
when_to_use: 当用户询问当前时间、日期、星期几时使用此技能。
metadata: {"openclaw":{"requires":{"bins":["date"]}}}
---

# time

获取当前时间和日期信息。

## When to Use

✅ **USE this skill when:**

- "现在几点了"
- "今天星期几"
- "今天几号"
- "现在是什么时间"
- "今天是几月几日"

## When NOT to Use

❌ **DON'T use this skill when:**

- 询问时区转换 → 使用时区转换工具
- 询问历史日期 → 直接回答
- 询问未来日期计算 → 直接回答

## Commands

### 获取当前时间

```bash
date "+%Y-%m-%d %H:%M:%S %A"
```

输出格式: 2026-02-25 14:30:00 Wednesday

### 获取当前时间（中文）

```bash
date "+%Y年%m月%d日 %H:%M:%S %A" 2>/dev/null || date "+%Y-%m-%d %H:%M:%S %A"
```

### 获取星期几

```bash
date "+%A"
```

### 获取日期

```bash
date "+%Y-%m-%d"
```

### 获取时间

```bash
date "+%H:%M:%S"
```

### 获取时区

```bash
date "+%Z %z"
```

## Quick Responses

**"现在几点了"**

```bash
date "+现在是 %Y年%m月%d日 %H:%M:%S，%A"
```

**"今天星期几"**

```bash
date "+今天是 %A"
```

**"今天几号"**

```bash
date "+今天是 %Y年%m月%d日"
```

## Notes

- 使用系统 date 命令，无需额外安装
- 时区使用系统默认时区
- 支持所有类 Unix 系统（Linux, macOS）
