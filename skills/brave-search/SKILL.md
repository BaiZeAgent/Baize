---
name: brave-search
version: 1.0.1
description: 使用Brave搜索引擎进行网络搜索
capabilities:
  - search
  - web_search
  - brave_search
  - internet_search
risk_level: low
author: baize-team
---

# Brave Search 技能

## 功能说明
使用 Brave Search API 进行网络搜索，获取搜索结果。

## 参数说明

| 参数 | 类型 | 必填 | 说明 |
|-----|------|------|------|
| query | string | 是 | 搜索关键词 |
| count | number | 否 | 返回结果数量，默认5 |
| offset | number | 否 | 偏移量，默认0 |

## 使用示例

用户说: "搜索Python教程"
系统调用: brave-search
参数: { "query": "Python教程" }

## 返回值说明

成功返回:
```json
{
  "success": true,
  "data": {
    "results": [
      {
        "title": "结果标题",
        "url": "https://...",
        "description": "结果描述"
      }
    ]
  },
  "message": "找到 5 个结果"
}
```

## 配置要求

需要设置环境变量 BRAVE_API_KEY：
```bash
export BRAVE_API_KEY=your_api_key_here
```

获取 API Key: https://brave.com/search/api/
