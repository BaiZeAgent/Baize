# 白泽3.0 技能开发文档

**版本**: 3.0.2  
**适用对象**: 技能开发者、技能共享者  
**最后更新**: 2025年2月

---

## 目录

1. [技能概述](#1-技能概述)
2. [技能开发规范](#2-技能开发规范)
3. [可用接口与功能](#3-可用接口与功能)
4. [技能开发模板](#4-技能开发模板)
5. [技能调试](#5-技能调试)
6. [技能发布](#6-技能发布)
7. [最佳实践](#7-最佳实践)
8. [示例技能](#8-示例技能)

---

## 1. 技能概述

### 1.1 什么是技能？

技能是白泽3.0的能力扩展单元，每个技能负责完成特定类型的任务。

```
┌─────────────────────────────────────────────────────────────────┐
│                     技能架构                                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  用户输入 ──▶ 思考引擎 ──▶ 技能选择 ──▶ 技能执行 ──▶ 结果返回   │
│                                                                 │
│  技能组成:                                                       │
│  ┌─────────────┐                                               │
│  │  SKILL.md   │  ← 技能定义（必需）                            │
│  ├─────────────┤                                               │
│  │  main.js    │  ← JavaScript实现                             │
│  │  main.py    │  ← Python实现                                 │
│  │  run.sh     │  ← Shell实现                                  │
│  └─────────────┘                                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 技能类型

| 类型 | 风险等级 | 说明 | 示例 |
|-----|---------|------|------|
| 信息查询 | low | 只读操作，无副作用 | time、weather |
| 文件操作 | medium | 读写文件系统 | file、fs |
| 网络请求 | medium | 调用外部API | http、weather |
| 系统操作 | high | 修改系统配置 | system |
| 危险操作 | critical | 高风险操作 | exec |

### 1.3 技能执行流程

```
1. 思考引擎分析用户输入
2. 匹配技能能力标签
3. 选择最合适的技能
4. 准备技能参数
5. 执行技能
6. 返回结果
```

---

## 2. 技能开发规范

### 2.1 目录结构

```
skills/
└── {skill_name}/           # 技能目录（小写，下划线分隔）
    ├── SKILL.md            # 技能定义（必需）
    ├── main.js             # JavaScript实现
    ├── main.py             # Python实现
    ├── run.sh              # Shell实现
    ├── README.md           # 技能说明（可选）
    ├── tests/              # 测试文件（可选）
    │   └── test.js
    └── assets/             # 资源文件（可选）
        └── icon.png
```

### 2.2 SKILL.md 规范

SKILL.md 是技能的定义文件，**必须存在**。

```markdown
---
# 必需字段
name: skill_name              # 技能名称（小写，下划线分隔）
version: 1.0.0               # 版本号（语义化版本）
description: 技能描述          # 简短描述（一句话）
capabilities:                # 能力标签列表
  - capability_1
  - capability_2
risk_level: low              # 风险等级: low/medium/high/critical

# 可选字段
author: 作者名称
license: MIT
homepage: https://example.com
repository: https://github.com/xxx/xxx
keywords:
  - 关键词1
  - 关键词2
step_by_step: false          # 是否逐步执行
dependencies:                # 依赖
  - npm: axios
  - pip: requests
---

# 技能名称

## 功能说明

详细描述技能的功能...

## 参数说明

| 参数 | 类型 | 必填 | 说明 |
|-----|------|------|------|
| param1 | string | 是 | 参数1说明 |
| param2 | number | 否 | 参数2说明 |

## 使用示例

用户说: "帮我查询xxx"
系统调用: skill_name

## 返回值说明

成功返回:
```json
{
  "success": true,
  "data": { ... }
}
```

## 注意事项

- 注意事项1
- 注意事项2
```

### 2.3 字段详解

#### name（必需）

- 格式：小写字母、数字、下划线
- 长度：2-50个字符
- 示例：`weather`, `file_manager`, `http_request`

#### version（必需）

- 格式：语义化版本 `MAJOR.MINOR.PATCH`
- 示例：`1.0.0`, `2.1.3`

#### description（必需）

- 长度：10-200个字符
- 语言：中文或英文
- 要求：简洁明了，一句话描述

#### capabilities（必需）

- 格式：能力标签数组
- 用途：用于技能匹配
- 建议：3-10个标签
- 示例：

```yaml
capabilities:
  - weather          # 天气查询
  - forecast         # 天气预报
  - temperature      # 温度查询
```

#### risk_level（必需）

| 等级 | 说明 | 用户确认 |
|-----|------|---------|
| low | 只读、无副作用 | 不需要 |
| medium | 可能修改数据 | 首次需要 |
| high | 重要操作 | 每次需要 |
| critical | 危险操作 | 强制确认 |

#### step_by_step（可选）

- 类型：boolean
- 默认：false
- 用途：复杂任务逐步执行，每步与用户确认

---

## 3. 可用接口与功能

### 3.1 参数接收

技能通过环境变量 `BAIZE_PARAMS` 接收参数。

#### 参数格式

```json
{
  "params": {
    // 技能参数（来自思考引擎）
    "param1": "value1",
    "param2": "value2"
  },
  "context": {
    // 执行上下文
    "userId": "user_001",
    "conversationId": "conv_001",
    "timestamp": "2025-02-23T10:00:00Z"
  }
}
```

#### JavaScript 获取参数

```javascript
function main() {
  let input = { params: {}, context: {} };
  
  // 方式1: 从环境变量获取
  if (process.env.BAIZE_PARAMS) {
    input = JSON.parse(process.env.BAIZE_PARAMS);
  }
  
  // 方式2: 从标准输入获取
  if (!process.env.BAIZE_PARAMS) {
    let stdinData = '';
    const buffer = [];
    let chunk;
    while ((chunk = process.stdin.read()) !== null) {
      buffer.push(chunk);
    }
    if (buffer.length > 0) {
      stdinData = buffer.join('');
      input = JSON.parse(stdinData);
    }
  }
  
  const { params, context } = input;
  // 使用参数...
}
```

#### Python 获取参数

```python
import os
import sys
import json

def main():
    input_data = {'params': {}, 'context': {}}
    
    # 方式1: 从环境变量获取
    if 'BAIZE_PARAMS' in os.environ:
        input_data = json.loads(os.environ['BAIZE_PARAMS'])
    
    # 方式2: 从标准输入获取
    else:
        stdin_data = sys.stdin.read()
        if stdin_data:
            input_data = json.loads(stdin_data)
    
    params = input_data.get('params', {})
    context = input_data.get('context', {})
    # 使用参数...
```

### 3.2 结果返回

技能必须输出JSON格式到 **stdout**。

#### 成功响应

```json
{
  "success": true,
  "data": {
    // 返回数据（任意结构）
    "result": "...",
    "items": [...]
  },
  "message": "操作成功"  // 可选，用户可见的消息
}
```

#### 失败响应

```json
{
  "success": false,
  "error": "错误描述",
  "code": "ERROR_CODE"  // 可选，错误码
}
```

#### JavaScript 返回结果

```javascript
// 成功
console.log(JSON.stringify({
  success: true,
  data: { result: 'done' },
  message: '操作成功'
}));

// 失败
console.log(JSON.stringify({
  success: false,
  error: '文件不存在'
}));
process.exit(1);  // 非零退出码表示失败
```

#### Python 返回结果

```python
# 成功
print(json.dumps({
    'success': True,
    'data': {'result': 'done'},
    'message': '操作成功'
}))

# 失败
print(json.dumps({
    'success': False,
    'error': '文件不存在'
}))
sys.exit(1)  # 非零退出码表示失败
```

### 3.3 可用功能

#### 3.3.1 文件系统操作

```javascript
// JavaScript
const fs = require('fs');
const path = require('path');

// 读取文件
const content = fs.readFileSync('/path/to/file', 'utf-8');

// 写入文件
fs.writeFileSync('/path/to/file', content);

// 检查文件存在
const exists = fs.existsSync('/path/to/file');

// 创建目录
fs.mkdirSync('/path/to/dir', { recursive: true });

// 列出目录
const files = fs.readdirSync('/path/to/dir');
```

```python
# Python
import os

# 读取文件
with open('/path/to/file', 'r', encoding='utf-8') as f:
    content = f.read()

# 写入文件
with open('/path/to/file', 'w', encoding='utf-8') as f:
    f.write(content)

# 检查文件存在
exists = os.path.exists('/path/to/file')

# 创建目录
os.makedirs('/path/to/dir', exist_ok=True)

# 列出目录
files = os.listdir('/path/to/dir')
```

#### 3.3.2 网络请求

```javascript
// JavaScript (Node.js 18+)
// 使用 fetch
const response = await fetch('https://api.example.com/data');
const data = await response.json();

// 使用 axios（需要安装）
const axios = require('axios');
const response = await axios.get('https://api.example.com/data');
```

```python
# Python
import urllib.request
import json

# 使用 urllib
with urllib.request.urlopen('https://api.example.com/data') as response:
    data = json.loads(response.read().decode('utf-8'))

# 使用 requests（需要安装）
import requests
response = requests.get('https://api.example.com/data')
data = response.json()
```

#### 3.3.3 环境变量

```javascript
// JavaScript
const apiKey = process.env.MY_API_KEY;
const homeDir = process.env.HOME;
const path = process.env.PATH;
```

```python
# Python
import os

api_key = os.environ.get('MY_API_KEY')
home_dir = os.environ.get('HOME')
path = os.environ.get('PATH')
```

#### 3.3.4 执行命令

```javascript
// JavaScript
const { execSync } = require('child_process');

const result = execSync('ls -la', { encoding: 'utf-8' });
console.log(result);
```

```python
# Python
import subprocess

result = subprocess.run(['ls', '-la'], capture_output=True, text=True)
print(result.stdout)
```

#### 3.3.5 时间日期

```javascript
// JavaScript
const now = new Date();
const formatted = now.toISOString();
const timestamp = Date.now();
```

```python
# Python
from datetime import datetime

now = datetime.now()
formatted = now.isoformat()
timestamp = int(now.timestamp())
```

### 3.4 可用的Node.js模块

| 模块 | 说明 | 可用性 |
|-----|------|--------|
| fs | 文件系统 | ✅ |
| path | 路径处理 | ✅ |
| os | 操作系统 | ✅ |
| crypto | 加密 | ✅ |
| http/https | HTTP客户端 | ✅ |
| child_process | 执行命令 | ✅ |
| util | 工具函数 | ✅ |
| axios | HTTP客户端 | 需安装 |
| lodash | 工具库 | 需安装 |

### 3.5 可用的Python库

| 库 | 说明 | 可用性 |
|---|------|--------|
| os | 操作系统 | ✅ 内置 |
| sys | 系统功能 | ✅ 内置 |
| json | JSON处理 | ✅ 内置 |
| datetime | 日期时间 | ✅ 内置 |
| urllib | HTTP客户端 | ✅ 内置 |
| subprocess | 执行命令 | ✅ 内置 |
| requests | HTTP客户端 | 需安装 |
| numpy | 数值计算 | 需安装 |

---

## 4. 技能开发模板

### 4.1 JavaScript 完整模板

```javascript
#!/usr/bin/env node
/**
 * 技能名称 - JavaScript实现
 * 
 * 功能描述
 */

// ==================== 配置 ====================

const CONFIG = {
  timeout: 30000,
  maxRetries: 3,
};

// ==================== 主函数 ====================

function main() {
  try {
    // 1. 获取参数
    const input = getInput();
    const { params, context } = input;
    
    // 2. 验证参数
    validateParams(params);
    
    // 3. 执行技能逻辑
    const result = execute(params, context);
    
    // 4. 返回成功结果
    outputSuccess(result);
    
  } catch (error) {
    // 5. 返回错误结果
    outputError(error);
    process.exit(1);
  }
}

// ==================== 辅助函数 ====================

/**
 * 获取输入参数
 */
function getInput() {
  let input = { params: {}, context: {} };
  
  // 从环境变量获取
  if (process.env.BAIZE_PARAMS) {
    try {
      input = JSON.parse(process.env.BAIZE_PARAMS);
    } catch (e) {
      throw new Error('参数解析失败');
    }
  }
  
  return input;
}

/**
 * 验证参数
 */
function validateParams(params) {
  // 检查必需参数
  if (!params.required_param) {
    throw new Error('缺少必需参数: required_param');
  }
  
  // 检查参数类型
  if (typeof params.required_param !== 'string') {
    throw new Error('参数类型错误: required_param 应为字符串');
  }
}

/**
 * 执行技能逻辑
 */
function execute(params, context) {
  const { required_param, optional_param } = params;
  
  // TODO: 实现技能逻辑
  
  return {
    result: 'done',
    // 其他返回数据...
  };
}

/**
 * 输出成功结果
 */
function outputSuccess(data, message = '执行成功') {
  console.log(JSON.stringify({
    success: true,
    data,
    message,
  }));
}

/**
 * 输出错误结果
 */
function outputError(error) {
  console.log(JSON.stringify({
    success: false,
    error: error.message || String(error),
  }));
}

// ==================== 执行 ====================

main();
```

### 4.2 Python 完整模板

```python
#!/usr/bin/env python3
"""
技能名称 - Python实现

功能描述
"""

import os
import sys
import json
from typing import Dict, Any, Optional

# ==================== 配置 ====================

CONFIG = {
    'timeout': 30000,
    'max_retries': 3,
}

# ==================== 主函数 ====================

def main():
    try:
        # 1. 获取参数
        input_data = get_input()
        params = input_data.get('params', {})
        context = input_data.get('context', {})
        
        # 2. 验证参数
        validate_params(params)
        
        # 3. 执行技能逻辑
        result = execute(params, context)
        
        # 4. 返回成功结果
        output_success(result)
        
    except Exception as e:
        # 5. 返回错误结果
        output_error(e)
        sys.exit(1)

# ==================== 辅助函数 ====================

def get_input() -> Dict[str, Any]:
    """获取输入参数"""
    input_data = {'params': {}, 'context': {}}
    
    # 从环境变量获取
    if 'BAIZE_PARAMS' in os.environ:
        try:
            input_data = json.loads(os.environ['BAIZE_PARAMS'])
        except json.JSONDecodeError:
            raise ValueError('参数解析失败')
    
    return input_data

def validate_params(params: Dict[str, Any]) -> None:
    """验证参数"""
    # 检查必需参数
    if 'required_param' not in params:
        raise ValueError('缺少必需参数: required_param')
    
    # 检查参数类型
    if not isinstance(params['required_param'], str):
        raise TypeError('参数类型错误: required_param 应为字符串')

def execute(params: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
    """执行技能逻辑"""
    required_param = params['required_param']
    optional_param = params.get('optional_param', 'default')
    
    # TODO: 实现技能逻辑
    
    return {
        'result': 'done',
        # 其他返回数据...
    }

def output_success(data: Dict[str, Any], message: str = '执行成功') -> None:
    """输出成功结果"""
    print(json.dumps({
        'success': True,
        'data': data,
        'message': message,
    }, ensure_ascii=False))

def output_error(error: Exception) -> None:
    """输出错误结果"""
    print(json.dumps({
        'success': False,
        'error': str(error),
    }, ensure_ascii=False))

# ==================== 执行 ====================

if __name__ == '__main__':
    main()
```

### 4.3 Shell 模板

```bash
#!/bin/bash
#
# 技能名称 - Shell实现
#
# 功能描述
#

set -e  # 遇错退出

# ==================== 配置 ====================

TIMEOUT=30
MAX_RETRIES=3

# ==================== 主函数 ====================

main() {
    # 1. 获取参数
    local input="${BAIZE_PARAMS:-}"
    local params=""
    
    if [[ -n "$input" ]]; then
        params=$(echo "$input" | jq -r '.params')
    fi
    
    # 2. 验证参数
    if [[ -z "$(echo "$params" | jq -r '.required_param // empty')" ]]; then
        output_error "缺少必需参数: required_param"
        exit 1
    fi
    
    # 3. 执行技能逻辑
    local result
    result=$(execute "$params")
    
    # 4. 返回成功结果
    output_success "$result"
}

# ==================== 辅助函数 ====================

execute() {
    local params="$1"
    local required_param=$(echo "$params" | jq -r '.required_param')
    
    # TODO: 实现技能逻辑
    
    echo '{"result": "done"}'
}

output_success() {
    local data="$1"
    echo "{\"success\": true, \"data\": $data, \"message\": \"执行成功\"}"
}

output_error() {
    local error="$1"
    echo "{\"success\": false, \"error\": \"$error\"}"
}

# ==================== 执行 ====================

main "$@"
```

---

## 5. 技能调试

### 5.1 直接测试

```bash
# JavaScript 技能
echo '{"params":{"param1":"value1"}}' | node skills/my_skill/main.js

# Python 技能
echo '{"params":{"param1":"value1"}}' | python3 skills/my_skill/main.py

# Shell 技能
BAIZE_PARAMS='{"params":{"param1":"value1"}}' bash skills/my_skill/run.sh
```

### 5.2 使用环境变量测试

```bash
# 设置环境变量
export BAIZE_PARAMS='{"params":{"param1":"value1"},"context":{"userId":"test"}}'

# 运行技能
node skills/my_skill/main.js

# 查看输出
```

### 5.3 在白泽系统中测试

```bash
# 启动白泽
npm start

# 输入触发技能的消息
你: 帮我查询天气
```

### 5.4 查看日志

```bash
# 查看技能执行日志
tail -f logs/baize.log | grep "my_skill"

# 查看错误日志
grep "ERROR" logs/baize.log | grep "my_skill"
```

### 5.5 调试技巧

```javascript
// 在技能中添加调试输出（输出到 stderr）
console.error('调试信息:', params);

// 使用 try-catch 捕获详细错误
try {
  // ...
} catch (error) {
  console.error('详细错误:', error.stack);
  throw error;
}
```

---

## 6. 技能发布

### 6.1 发布前检查清单

- [ ] SKILL.md 完整且格式正确
- [ ] 实现文件存在且可执行
- [ ] 参数验证完整
- [ ] 错误处理完善
- [ ] 测试通过
- [ ] 文档完整

### 6.2 本地测试

```bash
# 1. 检查文件结构
ls -la skills/my_skill/

# 2. 检查 SKILL.md 格式
cat skills/my_skill/SKILL.md

# 3. 测试技能执行
echo '{"params":{...}}' | node skills/my_skill/main.js

# 4. 在白泽中测试
npm start
```

### 6.3 发布到技能市场

#### 方式1: 提交到官方仓库

```bash
# 1. Fork 官方技能仓库
git clone https://github.com/baize-ai/skills.git
cd skills

# 2. 添加技能
cp -r /path/to/my_skill ./

# 3. 提交 PR
git add my_skill
git commit -m "feat: 添加 my_skill 技能"
git push origin main
# 然后在 GitHub 上创建 Pull Request
```

#### 方式2: 自建技能仓库

```yaml
# config/evolution.yaml
skillMarket:
  enabled: true
  repositories:
    - name: "官方市场"
      url: "https://market.baize.ai"
    - name: "私有市场"
      url: "https://your-market.example.com"
```

### 6.4 技能市场要求

| 要求 | 说明 |
|-----|------|
| 格式规范 | SKILL.md 格式正确 |
| 安全检查 | 无危险代码 |
| 功能完整 | 能正常执行 |
| 文档完整 | 有使用说明 |
| 测试覆盖 | 有基本测试 |

---

## 7. 最佳实践

### 7.1 参数设计

```yaml
# 好的参数设计
params:
  action: read        # 动作类型
  path: /path/to/file # 文件路径
  encoding: utf-8     # 可选参数有默认值

# 不好的参数设计
params:
  p1: xxx  # 参数名不清晰
  p2: xxx  # 没有默认值
```

### 7.2 错误处理

```javascript
// 好的错误处理
try {
  const result = doSomething();
  return result;
} catch (error) {
  if (error.code === 'ENOENT') {
    throw new Error('文件不存在，请检查路径');
  } else if (error.code === 'EACCES') {
    throw new Error('没有权限访问该文件');
  } else {
    throw new Error(`操作失败: ${error.message}`);
  }
}

// 不好的错误处理
try {
  // ...
} catch (error) {
  throw error;  // 直接抛出，用户看不懂
}
```

### 7.3 性能优化

```javascript
// 好的做法：设置超时
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 30000);

try {
  const response = await fetch(url, { signal: controller.signal });
  // ...
} finally {
  clearTimeout(timeout);
}

// 好的做法：批量处理
const results = [];
for (const item of items) {
  results.push(processItem(item));
}
return results;
```

### 7.4 安全考虑

```javascript
// 好的做法：验证路径
function safePath(basePath, userPath) {
  const resolved = path.resolve(basePath, userPath);
  if (!resolved.startsWith(basePath)) {
    throw new Error('非法路径');
  }
  return resolved;
}

// 好的做法：限制操作范围
const ALLOWED_DIRS = ['/tmp', '/home/user/data'];

function isAllowed(filePath) {
  return ALLOWED_DIRS.some(dir => filePath.startsWith(dir));
}
```

### 7.5 日志记录

```javascript
// 好的做法：记录关键信息
console.error(`[${new Date().toISOString()}] 开始执行: ${params.action}`);
console.error(`[${new Date().toISOString()}] 执行完成, 耗时: ${duration}ms`);
```

---

## 8. 示例技能

### 8.1 天气查询技能

**SKILL.md**:
```markdown
---
name: weather
version: 1.0.0
description: 天气查询技能，支持国内外城市天气
capabilities:
  - weather
  - forecast
  - temperature
risk_level: low
author: baize-team
---

# 天气查询技能

## 功能说明
查询指定城市的天气信息

## 参数说明
| 参数 | 类型 | 必填 | 说明 |
|-----|------|------|------|
| city | string | 是 | 城市名称 |
| days | number | 否 | 预报天数，默认1 |

## 使用示例
用户说: "北京天气怎么样"
系统调用: weather
```

**main.js**:
```javascript
#!/usr/bin/env node
/**
 * 天气查询技能
 */

const https = require('https');

function main() {
  try {
    const input = JSON.parse(process.env.BAIZE_PARAMS || '{}');
    const { city, days = 1 } = input.params || {};
    
    if (!city) {
      throw new Error('请指定城市名称');
    }
    
    // 模拟天气查询（实际应调用天气API）
    const weather = {
      city,
      temperature: '25°C',
      condition: '晴',
      humidity: '60%',
      forecast: [
        { date: '今天', temp: '25°C', condition: '晴' },
        { date: '明天', temp: '23°C', condition: '多云' },
      ]
    };
    
    console.log(JSON.stringify({
      success: true,
      data: weather,
      message: `${city}今天${weather.condition}，气温${weather.temperature}`
    }));
    
  } catch (error) {
    console.log(JSON.stringify({
      success: false,
      error: error.message
    }));
    process.exit(1);
  }
}

main();
```

### 8.2 计算器技能

**SKILL.md**:
```markdown
---
name: calculator
version: 1.0.0
description: 数学计算技能
capabilities:
  - calculate
  - math
  - compute
risk_level: low
---

# 计算器技能

## 参数说明
| 参数 | 类型 | 必填 | 说明 |
|-----|------|------|------|
| expression | string | 是 | 数学表达式 |
```

**main.js**:
```javascript
#!/usr/bin/env node

function main() {
  try {
    const input = JSON.parse(process.env.BAIZE_PARAMS || '{}');
    const { expression } = input.params || {};
    
    if (!expression) {
      throw new Error('请提供计算表达式');
    }
    
    // 安全计算（仅允许数字和基本运算符）
    if (!/^[\d\s+\-*/().]+$/.test(expression)) {
      throw new Error('表达式包含非法字符');
    }
    
    const result = eval(expression);
    
    console.log(JSON.stringify({
      success: true,
      data: { expression, result },
      message: `${expression} = ${result}`
    }));
    
  } catch (error) {
    console.log(JSON.stringify({
      success: false,
      error: `计算错误: ${error.message}`
    }));
    process.exit(1);
  }
}

main();
```

### 8.3 翻译技能

**SKILL.md**:
```markdown
---
name: translate
version: 1.0.0
description: 多语言翻译技能
capabilities:
  - translate
  - language
risk_level: low
---

# 翻译技能

## 参数说明
| 参数 | 类型 | 必填 | 说明 |
|-----|------|------|------|
| text | string | 是 | 要翻译的文本 |
| from | string | 否 | 源语言，默认自动检测 |
| to | string | 否 | 目标语言，默认中文 |
```

**main.py**:
```python
#!/usr/bin/env python3
"""翻译技能"""

import os
import sys
import json

def main():
    try:
        input_data = json.loads(os.environ.get('BAIZE_PARAMS', '{}'))
        params = input_data.get('params', {})
        
        text = params.get('text')
        from_lang = params.get('from', 'auto')
        to_lang = params.get('to', 'zh')
        
        if not text:
            raise ValueError('请提供要翻译的文本')
        
        # 模拟翻译（实际应调用翻译API）
        translated = f"[翻译结果] {text}"
        
        print(json.dumps({
            'success': True,
            'data': {
                'original': text,
                'translated': translated,
                'from': from_lang,
                'to': to_lang
            },
            'message': translated
        }, ensure_ascii=False))
        
    except Exception as e:
        print(json.dumps({
            'success': False,
            'error': str(e)
        }, ensure_ascii=False))
        sys.exit(1)

if __name__ == '__main__':
    main()
```

---

## 附录

### A. 技能开发检查清单

```
□ SKILL.md
  □ name 正确
  □ version 正确
  □ description 清晰
  □ capabilities 完整
  □ risk_level 正确
  □ 参数说明完整

□ 实现文件
  □ 参数获取正确
  □ 参数验证完整
  □ 错误处理完善
  □ 结果格式正确

□ 测试
  □ 正常情况测试
  □ 异常情况测试
  □ 边界情况测试

□ 文档
  □ 使用说明
  □ 参数说明
  □ 示例
```

### B. 常见错误

| 错误 | 原因 | 解决方案 |
|-----|------|---------|
| 技能未加载 | SKILL.md格式错误 | 检查YAML格式 |
| 参数为空 | 未正确获取参数 | 检查BAIZE_PARAMS |
| 输出无响应 | 未输出到stdout | 使用console.log |
| 编码错误 | 文件编码问题 | 使用UTF-8编码 |

### C. 相关链接

- [开发文档](./DEVELOPMENT.md)
- [API文档](./API.md)
- [架构设计](./architecture.md)
