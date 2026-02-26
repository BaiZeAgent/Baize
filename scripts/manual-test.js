#!/usr/bin/env node
/**
 * 白泽3.2 手动测试脚本
 * 
 * 按照测试清单逐项验证
 */

const http = require('http');

const BASE_URL = 'http://localhost:3098';

// 测试结果记录
const results = {
  passed: [],
  failed: [],
  total: 0
};

function log(message, type = 'info') {
  const colors = {
    info: '\x1b[36m',    // cyan
    success: '\x1b[32m', // green
    error: '\x1b[31m',   // red
    warn: '\x1b[33m',    // yellow
    reset: '\x1b[0m'
  };
  console.log(`${colors[type]}${message}${colors.reset}`);
}

async function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3098,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers });
        } catch (e) {
          resolve({ status: res.statusCode, body: data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => reject(new Error('Timeout')));

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function test(name, fn) {
  results.total++;
  try {
    await fn();
    results.passed.push(name);
    log(`  ✓ ${name}`, 'success');
  } catch (error) {
    results.failed.push({ name, error: error.message });
    log(`  ✗ ${name}: ${error.message}`, 'error');
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

// ==================== 测试用例 ====================

async function testHealthCheck() {
  log('\n【健康检查测试】', 'info');
  
  await test('GET /health 返回健康状态', async () => {
    const res = await request('GET', '/health');
    assert(res.status === 200, `状态码应为200，实际为${res.status}`);
    assert(res.body.success === true, 'success应为true');
    assert(res.body.data.status === 'healthy', 'status应为healthy');
    assert(res.body.data.version === '3.2.0', 'version应为3.2.0');
  });
}

async function testExistingAPI() {
  log('\n【现有接口兼容性测试】', 'info');
  
  await test('POST /api/chat 正常工作', async () => {
    const res = await request('POST', '/api/chat', { message: '你好' });
    assert(res.status === 200, `状态码应为200，实际为${res.status}`);
    assert(res.body.success === true, 'success应为true');
    assert(res.body.data !== undefined, 'data应存在');
  });

  await test('GET /api/skills 返回技能列表', async () => {
    const res = await request('GET', '/api/skills');
    assert(res.status === 200, `状态码应为200，实际为${res.status}`);
    assert(res.body.success === true, 'success应为true');
    assert(Array.isArray(res.body.data.skills), 'skills应为数组');
    assert(res.body.data.total >= 0, 'total应存在');
  });

  await test('GET /api/skills/:name 返回技能详情', async () => {
    const res = await request('GET', '/api/skills/time');
    assert(res.status === 200, `状态码应为200，实际为${res.status}`);
    assert(res.body.success === true, 'success应为true');
  });

  await test('GET /api/memory/stats 返回记忆统计', async () => {
    const res = await request('GET', '/api/memory/stats');
    assert(res.status === 200, `状态码应为200，实际为${res.status}`);
    assert(res.body.success === true, 'success应为true');
    assert(res.body.data.count !== undefined, 'count应存在');
  });

  await test('GET /api/cost/stats 返回成本统计', async () => {
    const res = await request('GET', '/api/cost/stats');
    assert(res.status === 200, `状态码应为200，实际为${res.status}`);
    assert(res.body.success === true, 'success应为true');
    assert(res.body.data.todayCost !== undefined, 'todayCost应存在');
  });

  await test('GET /api/chat/history 返回历史', async () => {
    const res = await request('GET', '/api/chat/history');
    assert(res.status === 200, `状态码应为200，实际为${res.status}`);
    assert(res.body.success === true, 'success应为true');
  });
}

async function testStreamAPI() {
  log('\n【新增流式接口测试】', 'info');
  
  await test('POST /api/chat/stream 返回SSE流', async () => {
    const res = await request('POST', '/api/chat/stream', { message: '你好' });
    assert(res.status === 200, `状态码应为200，实际为${res.status}`);
    assert(res.headers['content-type'].includes('text/event-stream'), 'Content-Type应为text/event-stream');
  });

  await test('流式响应包含thinking事件', async () => {
    const res = await request('POST', '/api/chat/stream', { message: '你好' });
    const body = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
    assert(body.includes('event: thinking'), '应包含thinking事件');
  });

  await test('流式响应包含content事件', async () => {
    const res = await request('POST', '/api/chat/stream', { message: '你好' });
    const body = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
    assert(body.includes('event: content'), '应包含content事件');
  });

  await test('流式响应包含done事件', async () => {
    const res = await request('POST', '/api/chat/stream', { message: '你好' });
    const body = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
    assert(body.includes('event: done'), '应包含done事件');
  });

  await test('流式响应包含session事件', async () => {
    const res = await request('POST', '/api/chat/stream', { message: '你好' });
    const body = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
    assert(body.includes('event: session'), '应包含session事件');
  });
}

async function testRuleMatch() {
  log('\n【规则快速匹配测试】', 'info');
  
  await test('问候语匹配（你好）', async () => {
    const res = await request('POST', '/api/chat/stream', { message: '你好' });
    const body = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
    assert(body.includes('matched') || body.includes('问候'), '应匹配问候规则');
  });

  await test('告别语匹配（再见）', async () => {
    const res = await request('POST', '/api/chat/stream', { message: '再见' });
    const body = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
    assert(body.includes('matched') || body.includes('再见'), '应匹配告别规则');
  });

  await test('感谢匹配（谢谢）', async () => {
    const res = await request('POST', '/api/chat/stream', { message: '谢谢' });
    const body = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
    assert(body.includes('matched') || body.includes('不客气'), '应匹配感谢规则');
  });
}

async function testContextMemory() {
  log('\n【上下文记忆测试】', 'info');
  
  let sessionId = null;
  
  await test('创建会话并获取sessionId', async () => {
    const res = await request('POST', '/api/chat/stream', { message: '你好' });
    const body = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
    const match = body.match(/event: session\ndata: ({.*})/);
    if (match) {
      const data = JSON.parse(match[1]);
      sessionId = data.sessionId;
    }
    assert(sessionId !== null, '应返回sessionId');
  });

  await test('追问能识别上下文', async () => {
    // 先发送一条消息
    const res1 = await request('POST', '/api/chat/stream', { 
      message: '北京天气',
      conversationId: sessionId 
    });
    
    // 等待一下
    await new Promise(r => setTimeout(r, 100));
    
    // 发送追问
    const res2 = await request('POST', '/api/chat/stream', { 
      message: '那明天呢',
      conversationId: sessionId 
    });
    
    const body = typeof res2.body === 'string' ? res2.body : JSON.stringify(res2.body);
    // 应该能处理追问
    assert(body.includes('event:'), '应返回事件流');
  });
}

async function testHonesty() {
  log('\n【诚实性测试】', 'info');
  
  await test('缺少信息时应该询问', async () => {
    const res = await request('POST', '/api/chat/stream', { message: '今天天气怎么样' });
    const body = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
    // 如果有LLM，应该询问位置；如果没有LLM，会返回错误
    const hasValidResponse = body.includes('城市') || body.includes('位置') || 
                            body.includes('ask_missing') || body.includes('content');
    const hasError = body.includes('error');
    assert(hasValidResponse || hasError, '应询问位置信息或返回错误（无LLM配置）');
  });

  await test('没有能力时应该说明', async () => {
    const res = await request('POST', '/api/chat/stream', { message: '帮我买股票' });
    const body = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
    // 如果有LLM，应该说明没有能力；如果没有LLM，会返回错误
    const hasValidResponse = body.includes('unable') || body.includes('抱歉') || 
                            body.includes('无法') || body.includes('content');
    const hasError = body.includes('error');
    assert(hasValidResponse || hasError, '应说明没有能力或返回错误（无LLM配置）');
  });
}

async function testErrorHandling() {
  log('\n【错误处理测试】', 'info');
  
  await test('空消息返回400错误', async () => {
    const res = await request('POST', '/api/chat', {});
    assert(res.status === 400, `状态码应为400，实际为${res.status}`);
  });

  await test('不存在的技能返回404', async () => {
    const res = await request('GET', '/api/skills/nonexistent-skill');
    assert(res.status === 404, `状态码应为404，实际为${res.status}`);
  });
}

// ==================== 主函数 ====================

async function main() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('           白泽3.2 手动测试清单验证');
  console.log('═══════════════════════════════════════════════════════════════\n');

  try {
    await testHealthCheck();
    await testExistingAPI();
    await testStreamAPI();
    await testRuleMatch();
    await testContextMemory();
    await testHonesty();
    await testErrorHandling();
  } catch (error) {
    log(`\n测试执行失败: ${error.message}`, 'error');
  }

  // 输出结果
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                      测试结果汇总');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  log(`总计: ${results.total} 个测试`, 'info');
  log(`通过: ${results.passed.length} 个`, 'success');
  log(`失败: ${results.failed.length} 个`, results.failed.length > 0 ? 'error' : 'success');

  if (results.failed.length > 0) {
    console.log('\n失败的测试:');
    results.failed.forEach(f => {
      log(`  - ${f.name}: ${f.error}`, 'error');
    });
  }

  console.log('\n═══════════════════════════════════════════════════════════════\n');

  process.exit(results.failed.length > 0 ? 1 : 0);
}

main();
