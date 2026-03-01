---
name: browser-automation
description: "浏览器自动化操作 - 打开网页、截图、提取内容、填表等"
version: "1.0.0"
author: "Baize Team"
capabilities:
  - browser
  - web-automation
  - screenshot
  - form-filling
  - content-extraction
risk_level: "medium"
when_to_use: "当用户需要打开网页、浏览网站、提取网页内容、自动填表、网页截图等浏览器操作时使用"
input_schema:
  type: object
  properties:
    action:
      type: string
      description: "要执行的操作"
      enum: ["open", "screenshot", "extract", "fill", "click", "scroll", "wait", "search"]
    url:
      type: string
      description: "网页URL（open操作必需）"
    selector:
      type: string
      description: "CSS选择器（用于提取、点击等操作）"
    value:
      type: string
      description: "要填入的值（fill操作使用）"
    waitTime:
      type: number
      description: "等待时间（毫秒）"
    screenshot_path:
      type: string
      description: "截图保存路径"
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
      action: "open"
      url: "https://www.baidu.com"
    output:
      success: true
      message: "已打开百度首页"
  - input:
      action: "screenshot"
      screenshot_path: "./screenshot.png"
    output:
      success: true
      message: "截图已保存"
---

# 浏览器自动化技能

## 功能说明

这个技能可以让白泽控制浏览器执行各种自动化操作，包括：

### 支持的操作

1. **open** - 打开网页
   - 参数：url（必需）
   - 示例：打开百度、打开新闻网站

2. **screenshot** - 网页截图
   - 参数：screenshot_path（可选，默认 ./screenshot.png）
   - 保存当前页面的截图

3. **extract** - 提取内容
   - 参数：selector（CSS选择器）
   - 提取指定元素的文本内容

4. **fill** - 填写表单
   - 参数：selector, value
   - 在指定输入框中填入内容

5. **click** - 点击元素
   - 参数：selector
   - 点击页面上的按钮或链接

6. **scroll** - 滚动页面
   - 参数：value（"top", "bottom", 或像素值）

7. **wait** - 等待
   - 参数：waitTime（毫秒）
   - 等待指定时间

8. **search** - 搜索
   - 参数：value（搜索关键词）
   - 在搜索引擎中搜索

## 使用场景

- 打开指定网页查看内容
- 自动填写表单
- 提取网页信息
- 网页截图保存
- 自动化测试

## 注意事项

- 需要安装 Playwright：`npm install playwright`
- 首次使用需要安装浏览器：`npx playwright install chromium`
- 某些网站可能有反爬虫机制

## 安装命令

```bash
npm install playwright
npx playwright install chromium
```

## 示例用法

```bash
# 打开网页
baize chat "打开百度首页"

# 搜索内容
baize chat "在百度搜索 人工智能"

# 截图
baize chat "给当前网页截图"

# 提取内容
baize chat "提取网页标题"
```
