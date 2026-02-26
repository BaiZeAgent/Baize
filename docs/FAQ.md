# 白泽3.0 常见问题 (FAQ)

**版本**: 3.0.2  
**最后更新**: 2025年2月

---

## 目录

1. [安装与配置](#1-安装与配置)
2. [使用问题](#2-使用问题)
3. [技能开发](#3-技能开发)
4. [API对接](#4-api对接)
5. [性能优化](#5-性能优化)
6. [故障排查](#6-故障排查)

---

## 1. 安装与配置

### Q1.1: 系统要求是什么？

**A**: 白泽3.0的系统要求：

| 组件 | 最低要求 | 推荐配置 |
|-----|---------|---------|
| Node.js | 18.0+ | 20.0+ |
| 内存 | 512MB | 1GB+ |
| 磁盘 | 100MB | 1GB+ |
| 操作系统 | Windows/Linux/macOS | Linux |

### Q1.2: 如何安装白泽？

**A**: 
```bash
# 克隆仓库
git clone https://github.com/your-repo/baize-nodejs.git
cd baize-nodejs

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 文件

# 编译并运行
npm run build
npm start
```

### Q1.3: 如何配置LLM提供商？

**A**: 编辑 `config/llm.yaml`：

```yaml
default: "aliyun"

providers:
  aliyun:
    enabled: true
    type: "openai-compatible"
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
    model: "qwen-max"
    apiKey: "${ALIYUN_API_KEY}"  # 从环境变量读取
```

然后在 `.env` 中设置：
```bash
ALIYUN_API_KEY=your_api_key_here
```

### Q1.4: 支持哪些LLM提供商？

**A**: 目前支持：

| 提供商 | 类型 | 说明 |
|-------|------|------|
| 阿里云百炼 | openai-compatible | 推荐 |
| 智谱AI | openai-compatible | |
| Ollama | ollama | 本地部署 |
| OpenAI | openai-compatible | |

### Q1.5: 如何使用本地LLM？

**A**: 
1. 安装Ollama: https://ollama.ai
2. 拉取模型: `ollama pull llama2`
3. 配置 `config/llm.yaml`:
```yaml
providers:
  ollama:
    enabled: true
    type: "ollama"
    baseURL: "http://localhost:11434"
    model: "llama2"
```

---

## 2. 使用问题

### Q2.1: 白泽能做什么？

**A**: 白泽3.0可以：
- 💬 进行自然语言对话
- 📁 操作文件系统（创建、读取、写入文件）
- ⏰ 查询时间
- 🔧 执行自定义技能
- 🧠 记住用户偏好
- 🛒 自主获取新能力

### Q2.2: 如何添加新技能？

**A**: 
```bash
# 方法1: 从市场安装
baize skill install weather

# 方法2: 手动创建
mkdir -p skills/my_skill
# 创建 SKILL.md 和 main.js
```

详见 [开发文档](./DEVELOPMENT.md#41-开发新技能)

### Q2.3: 为什么白泽回复很慢？

**A**: 可能原因：
1. **LLM响应慢** - 检查网络连接和API响应时间
2. **思考过程复杂** - 复杂任务需要更多思考时间
3. **Token过多** - 检查上下文是否过长

优化方法：
```yaml
# config/llm.yaml
providers:
  aliyun:
    model: "qwen-turbo"  # 使用更快的模型
```

### Q2.4: 如何查看对话历史？

**A**: 
```bash
# CLI方式
baize memory search "关键词"

# API方式
curl http://localhost:3000/api/chat/history/conv_001
```

### Q2.5: 如何设置每日预算？

**A**: 编辑 `config/llm.yaml`:
```yaml
costControl:
  dailyBudget: 10      # 每日预算（美元）
  perTaskBudget: 0.5   # 单任务预算
  alertThreshold: 80   # 告警阈值（%）
  hardLimit: true      # 超限拒绝
```

---

## 3. 技能开发

### Q3.1: 如何开发一个新技能？

**A**: 
1. 创建技能目录
```bash
mkdir -p skills/my_skill
```

2. 创建 SKILL.md
```markdown
---
name: my_skill
description: 我的技能
capabilities:
  - my_capability
risk_level: low
---
# 技能说明
```

3. 创建实现文件 (main.js 或 main.py)

4. 重启白泽，技能自动加载

### Q3.2: 技能支持哪些语言？

**A**: 
- **JavaScript** (推荐) - main.js
- **Python** - main.py
- **Shell** - run.sh

执行优先级: Python > JavaScript > Shell

### Q3.3: 如何调试技能？

**A**: 
```bash
# 直接测试技能
echo '{"params":{"key":"value"}}' | node skills/my_skill/main.js

# 查看日志
tail -f logs/baize.log | grep "my_skill"
```

### Q3.4: 技能参数如何传递？

**A**: 技能通过环境变量 `BAIZE_PARAMS` 接收参数：

```javascript
// JavaScript
const input = JSON.parse(process.env.BAIZE_PARAMS || '{}');
const { params } = input;
```

```python
# Python
import os, json
input_data = json.loads(os.environ.get('BAIZE_PARAMS', '{}'))
params = input_data.get('params', {})
```

### Q3.5: 如何返回技能执行结果？

**A**: 输出JSON到stdout：

```javascript
// 成功
console.log(JSON.stringify({
  success: true,
  data: { result: '...' },
  message: '执行成功'
}));

// 失败
console.log(JSON.stringify({
  success: false,
  error: '错误信息'
}));
```

---

## 4. API对接

### Q4.1: 如何通过API调用白泽？

**A**: 
```bash
# 发送消息
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "你好"}'

# 响应
{
  "success": true,
  "data": {
    "response": "你好！我是白泽...",
    "conversationId": "conv_001"
  }
}
```

### Q4.2: 如何开发GUI客户端？

**A**: 推荐使用WebSocket实现实时交互：

```javascript
const ws = new WebSocket('ws://localhost:3000/ws');

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'chat',
    data: { message: '你好' }
  }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  // 处理响应
};
```

详见 [API文档](./API.md#3-websocket-api)

### Q4.3: API需要认证吗？

**A**: 默认不需要。生产环境可配置API Key：

```yaml
# config/system.yaml
api:
  auth:
    enabled: true
    header: "X-API-Key"
```

### Q4.4: 如何获取思考过程？

**A**: 使用WebSocket，会推送思考进度：

```json
{
  "type": "thinking_progress",
  "data": {
    "phase": "understanding",
    "message": "正在理解...",
    "progress": 20
  }
}
```

### Q4.5: 有SDK吗？

**A**: 
```javascript
// JavaScript/TypeScript
import { BaizeClient } from 'baize-sdk';

const client = new BaizeClient();
const response = await client.chat('你好');
```

详见 [API文档](./API.md#6-sdk-使用)

---

## 5. 性能优化

### Q5.1: 如何减少Token消耗？

**A**: 
1. 使用更便宜的模型
```yaml
providers:
  aliyun:
    model: "qwen-turbo"  # 比 qwen-max 便宜
```

2. 启用语义缓存
```yaml
# config/system.yaml
cache:
  enabled: true
```

3. 设置预算限制
```yaml
costControl:
  dailyBudget: 5
  hardLimit: true
```

### Q5.2: 如何提升响应速度？

**A**: 
1. 使用更快的模型
2. 减少上下文长度
3. 启用缓存
4. 使用本地LLM (Ollama)

### Q5.3: 内存占用过高怎么办？

**A**: 
```bash
# 查看内存使用
pm2 monit

# 设置内存限制
pm2 start dist/interaction/api.js --max-memory-restart 500M

# 清理数据库
sqlite3 data/baize.db "DELETE FROM episodic_memory WHERE id NOT IN (SELECT id FROM episodic_memory ORDER BY timestamp DESC LIMIT 1000);"
```

### Q5.4: 如何优化数据库？

**A**: 
```bash
# 定期清理
sqlite3 data/baize.db "DELETE FROM episodic_memory WHERE timestamp < datetime('now', '-30 days');"

# 优化数据库
sqlite3 data/baize.db "VACUUM;"

# 重建索引
sqlite3 data/baize.db "REINDEX;"
```

---

## 6. 故障排查

### Q6.1: 服务无法启动？

**A**: 
```bash
# 检查端口占用
lsof -i :3000

# 检查Node版本
node --version  # 需要 >= 18

# 检查依赖
npm install

# 查看错误日志
pm2 logs baize --err
```

### Q6.2: LLM调用失败？

**A**: 
```bash
# 检查API Key
echo $ALIYUN_API_KEY

# 测试API连接
curl -X POST https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions \
  -H "Authorization: Bearer $ALIYUN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen-max","messages":[{"role":"user","content":"hi"}]}'

# 检查网络
ping dashscope.aliyuncs.com
```

### Q6.3: 技能执行失败？

**A**: 
```bash
# 检查技能文件
ls -la skills/my_skill/

# 检查文件权限
chmod +x skills/my_skill/main.js

# 检查Python环境
python3 --version

# 手动测试技能
echo '{"params":{}}' | python3 skills/my_skill/main.py
```

### Q6.4: 数据库损坏？

**A**: 
```bash
# 检查完整性
sqlite3 data/baize.db "PRAGMA integrity_check;"

# 恢复数据库
sqlite3 data/baize.db ".recover" > recover.sql
sqlite3 data/baize_new.db < recover.sql
mv data/baize_new.db data/baize.db
```

### Q6.5: 中文乱码？

**A**: 
```bash
# Windows设置编码
chcp 65001

# 检查终端编码
echo $LANG  # Linux/macOS

# 确保文件UTF-8编码
file -i skills/my_skill/main.js
```

---

## 更多帮助

- [开发文档](./DEVELOPMENT.md)
- [API文档](./API.md)
- [部署文档](./DEPLOYMENT.md)
- [架构设计](./architecture.md)

如果问题未解决，请提交 [Issue](https://github.com/your-repo/baize-nodejs/issues)。
