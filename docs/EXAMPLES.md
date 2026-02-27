# 白泽使用示例

## 1. 钩子系统

### 注册钩子

```typescript
import { registerHook, runHook } from './core';

// 注册工具调用前的钩子
registerHook('before_tool_call', async (ctx) => {
  console.log(`工具调用: ${ctx.toolName}`);
  console.log(`参数: ${JSON.stringify(ctx.toolParams)}`);
  
  // 阻止敏感操作
  if (ctx.toolName === 'exec' && ctx.toolParams?.command?.includes('rm -rf')) {
    return {
      proceed: false,
      error: '禁止执行危险命令'
    };
  }
  
  return { proceed: true };
}, { priority: 'high', handlerName: 'my_hook' });
```

### 运行钩子

```typescript
import { runHook } from './core';

const result = await runHook('before_tool_call', {
  sessionId: 'session-1',
  workspaceDir: '/tmp',
  toolName: 'exec',
  toolParams: { command: 'ls -la' }
});

if (!result.proceed) {
  console.log('操作被阻止:', result.error);
}
```

## 2. 策略系统

### 检查工具策略

```typescript
import { checkToolPolicy } from './core';

// 检查工具是否允许
const result = await checkToolPolicy('web_search', { query: 'test' });

if (!result.allowed) {
  console.log('工具被阻止:', result.reason);
}

if (result.requiresApproval) {
  console.log('需要审批:', result.approvalRequest);
}
```

## 3. 审批系统

### 检测敏感操作

```typescript
import { detectSensitiveOperation, getOperationRisk } from './core';

// 检测敏感操作
const result = detectSensitiveOperation('rm -rf /');
if (result) {
  console.log('敏感操作:', result.operation);
  console.log('风险级别:', result.risk);
}

// 获取风险级别
const risk = getOperationRisk('sudo apt update', 'exec');
console.log('风险级别:', risk); // 'medium'
```

### 处理审批

```typescript
import { getApprovalManager } from './core';

const manager = getApprovalManager();

// 批准
await manager.approve('approval-xxx', 'user', '同意执行');

// 拒绝
await manager.deny('approval-xxx', '风险太高');
```

## 4. 嵌入系统

### 获取文本嵌入

```typescript
import { getEmbeddingManager, similarity } from './core';

const manager = getEmbeddingManager();

// 获取嵌入
const result = await manager.embed('Hello world');
console.log('向量维度:', result.vector.length);

// 计算相似度
const sim = await similarity('Hello', 'Hi');
console.log('相似度:', sim);
```

## 5. 向量存储

### 存储和搜索

```typescript
import { getVectorStore, createPersistentVectorStore } from './core';

// 创建持久化存储
const store = createPersistentVectorStore('./data/vectors.db', 384);

// 添加文档
await store.add({
  id: 'doc-1',
  content: '这是一段文本',
  vector: embedding,
  metadata: { source: 'test' }
});

// 搜索
const results = await store.search(queryVector, { topK: 10 });
```

## 6. 混合检索

### 索引和搜索

```typescript
import { getSearchEngine, search } from './core';

const engine = getSearchEngine();

// 索引文档
await engine.index({
  id: 'doc-1',
  content: '这是一段文本',
  metadata: { type: 'article' }
});

// 混合搜索
const results = await search('查询词', {
  strategy: 'hybrid',
  topK: 10,
  vectorWeight: 0.7,
  ftsWeight: 0.3
});
```

## 7. 环境管理

### 检查和安装依赖

```typescript
import { isInstalled, ensureInstalled, getEnvironmentManager } from './core';

// 检查依赖
const installed = await isInstalled('ripgrep');

// 确保安装
await ensureInstalled('jq');

// 初始化环境
const manager = getEnvironmentManager();
const status = await manager.initialize();
console.log('环境健康:', status.healthy);
```

## 8. 自动技能安装

### 检测能力缺口

```typescript
import { detectCapabilityGap, handleCapabilityGap } from './core';

// 检测缺口
const gap = await detectCapabilityGap('帮我分析这个 PDF');
if (gap) {
  console.log('缺失能力:', gap.missingCapabilities);
}

// 自动处理
const result = await handleCapabilityGap('帮我分析这个 PDF');
if (result.installed) {
  console.log('已安装技能:', result.message);
}
```

## 9. 错误恢复

### 错误分类和重试

```typescript
import { classifyError, withRetry } from './core';

// 分类错误
const classified = classifyError(new Error('401 Unauthorized'));
console.log('错误类型:', classified.category); // 'auth'

// 带重试执行
const result = await withRetry(
  async () => await someOperation(),
  { maxAttempts: 3, initialDelay: 1000 }
);
```

## 10. 上下文管理

### Token 计数

```typescript
import { countTokens, countMessagesTokens, getContextManager } from './core';

// 计数 Token
const tokens = countTokens('Hello world 你好世界');

// 计数消息 Token
const messages = [
  { role: 'user', content: 'Hello' },
  { role: 'assistant', content: 'Hi there' }
];
const msgTokens = countMessagesTokens(messages);

// 管理上下文
const manager = getContextManager();
manager.addMessage('user', 'Hello');
manager.addMessage('assistant', 'Hi');
```
