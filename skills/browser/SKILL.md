---
name: browser
description: 打开浏览器访问网页
when_to_use: 浏览器 打开网页 访问网站 打开网址 open browser
metadata: {"openclaw":{"requires":{"bins":["open","xdg-open","start"]}}}
---

# Browser

打开浏览器访问指定网页。

## When to Use

✅ **USE this skill when:**

- "打开浏览器"
- "帮我打开百度"
- "访问这个网址"
- "用浏览器打开"

## Commands

### macOS / Linux

```bash
open "https://example.com"
```

### Linux (备选)

```bash
xdg-open "https://example.com"
```

### Windows

```bash
start "" "https://example.com"
```

### 打开百度

```bash
open "https://www.baidu.com"
```

### 打开 Bilibili

```bash
open "https://www.bilibili.com"
```

## Notes

- 自动检测操作系统选择合适的命令
- 支持任意 URL
- 无需额外安装
