#!/usr/bin/env node
/**
 * 白泽 V3 简化测试 - 直接测试 LLM 连接
 */

require('dotenv').config();
const https = require('https');
const http = require('http');

// ═══════════════════════════════════════════════════════════════
// 配置
// ═══════════════════════════════════════════════════════════════

const API_KEY = process.env.ALIYUN_API_KEY;
const API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

// ═══════════════════════════════════════════════════════════════
// 测试函数
// ═══════════════════════════════════════════════════════════════

async function testLLMConnection() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('           白泽 V3 - LLM 连接测试');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  // 检查 API Key
  if (!API_KEY) {
    console.log('❌ 错误: 未设置 ALIYUN_API_KEY 环境变量');
    return false;
  }
  console.log(`✓ API Key 已配置: ${API_KEY.substring(0, 10)}...${API_KEY.substring(API_KEY.length - 4)}`);
  
  // 测试请求
  console.log('\n正在测试 LLM 连接...\n');
  
  const requestBody = JSON.stringify({
    model: 'qwen-max',
    messages: [
      { role: 'system', content: '你是白泽，一个智能助手。请简洁回答。' },
      { role: 'user', content: '你好，请用一句话介绍你自己。' }
    ],
    temperature: 0.7,
    max_tokens: 100
  });
  
  return new Promise((resolve) => {
    const req = https.request(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      }
    }, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          
          if (response.choices && response.choices[0]) {
            console.log('✓ LLM 连接成功！\n');
            console.log('响应:');
            console.log(`  ${response.choices[0].message.content}`);
            console.log(`\n  模型: ${response.model}`);
            console.log(`  Token 使用: ${response.usage?.total_tokens || 'N/A'}`);
            resolve(true);
          } else if (response.error) {
            console.log('❌ API 错误:', response.error.message);
            resolve(false);
          } else {
            console.log('❌ 未知响应格式');
            console.log(data.substring(0, 500));
            resolve(false);
          }
        } catch (e) {
          console.log('❌ 解析响应失败:', e.message);
          console.log('原始响应:', data.substring(0, 500));
          resolve(false);
        }
      });
    });
    
    req.on('error', (e) => {
      console.log('❌ 请求失败:', e.message);
      resolve(false);
    });
    
    req.write(requestBody);
    req.end();
  });
}

// ═══════════════════════════════════════════════════════════════
// 多场景测试
// ═══════════════════════════════════════════════════════════════

const TEST_CASES = [
  {
    name: '基础对话',
    messages: [
      { role: 'user', content: '你好，请介绍一下你自己' }
    ]
  },
  {
    name: '天气查询',
    messages: [
      { role: 'user', content: '今天杭州天气怎么样？请告诉我天气信息。' }
    ]
  },
  {
    name: '浏览器自动化',
    messages: [
      { role: 'system', content: '你是白泽，一个智能助手。你有浏览器自动化能力，可以打开网页、截图、提取内容等。' },
      { role: 'user', content: '帮我打开百度首页' }
    ]
  },
  {
    name: '文员办公 - 摘要',
    messages: [
      { role: 'user', content: '帮我总结这段话：人工智能是计算机科学的一个分支，它企图了解智能的实质，并生产出一种新的能以人类智能相似的方式做出反应的智能机器，该领域的研究包括机器人、语言识别、图像识别、自然语言处理和专家系统等。' }
    ]
  },
  {
    name: '文员办公 - 表格',
    messages: [
      { role: 'user', content: '把这些数据做成表格：张三 90分，李四 85分，王五 92分，赵六 88分' }
    ]
  },
  {
    name: '文员办公 - 周报',
    messages: [
      { role: 'user', content: '帮我写一份简单的工作周报，内容包括：完成了项目文档编写、参加了两次会议、修复了3个bug' }
    ]
  }
];

async function runScenarioTests() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('           多场景测试');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  let passed = 0;
  let failed = 0;
  
  for (const testCase of TEST_CASES) {
    console.log(`\n━━━ ${testCase.name} ━━━`);
    console.log(`问题: ${testCase.messages[testCase.messages.length - 1].content}`);
    console.log('─'.repeat(50));
    
    const startTime = Date.now();
    
    try {
      const response = await callLLM(testCase.messages);
      const duration = Date.now() - startTime;
      
      if (response.success) {
        passed++;
        console.log(`✓ 成功 (${duration}ms)`);
        console.log(`回答: ${response.content.substring(0, 300)}${response.content.length > 300 ? '...' : ''}`);
      } else {
        failed++;
        console.log(`✗ 失败: ${response.error}`);
      }
    } catch (e) {
      failed++;
      console.log(`✗ 错误: ${e.message}`);
    }
    
    // 避免请求过快
    await new Promise(r => setTimeout(r, 1000));
  }
  
  // 测试报告
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                    测试报告');
  console.log('═══════════════════════════════════════════════════════════════\n');
  
  console.log(`总计: ${TEST_CASES.length} 个测试`);
  console.log(`✓ 通过: ${passed}`);
  console.log(`✗ 失败: ${failed}`);
  console.log(`成功率: ${(passed / TEST_CASES.length * 100).toFixed(1)}%\n`);
}

function callLLM(messages) {
  return new Promise((resolve) => {
    const requestBody = JSON.stringify({
      model: 'qwen-max',
      messages: messages,
      temperature: 0.7,
      max_tokens: 500
    });
    
    const req = https.request(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      }
    }, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          
          if (response.choices && response.choices[0]) {
            resolve({
              success: true,
              content: response.choices[0].message.content
            });
          } else if (response.error) {
            resolve({
              success: false,
              error: response.error.message
            });
          } else {
            resolve({
              success: false,
              error: '未知响应格式'
            });
          }
        } catch (e) {
          resolve({
            success: false,
            error: e.message
          });
        }
      });
    });
    
    req.on('error', (e) => {
      resolve({
        success: false,
        error: e.message
      });
    });
    
    req.write(requestBody);
    req.end();
  });
}

// ═══════════════════════════════════════════════════════════════
// 交互式聊天
// ═══════════════════════════════════════════════════════════════

const readline = require('readline');

async function startInteractiveChat() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('           交互式聊天模式');
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log('输入消息进行对话，输入 "exit" 退出\n');
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  const conversationHistory = [
    { role: 'system', content: '你是白泽，一个智能助手。你具有浏览器自动化、文员办公等能力。请用中文简洁回答。' }
  ];
  
  const askQuestion = () => {
    rl.question('你: ', async (input) => {
      const trimmed = input.trim();
      
      if (trimmed.toLowerCase() === 'exit') {
        console.log('\n再见！');
        rl.close();
        return;
      }
      
      if (!trimmed) {
        askQuestion();
        return;
      }
      
      conversationHistory.push({ role: 'user', content: trimmed });
      
      console.log();
      process.stdout.write('白泽: ');
      
      const response = await callLLM(conversationHistory);
      
      if (response.success) {
        console.log(response.content);
        conversationHistory.push({ role: 'assistant', content: response.content });
      } else {
        console.log(`抱歉，出错了: ${response.error}`);
      }
      
      console.log();
      askQuestion();
    });
  };
  
  askQuestion();
}

// ═══════════════════════════════════════════════════════════════
// 主函数
// ═══════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || 'test';
  
  if (mode === 'chat') {
    const connected = await testLLMConnection();
    if (connected) {
      await startInteractiveChat();
    }
  } else if (mode === 'scenario') {
    const connected = await testLLMConnection();
    if (connected) {
      await runScenarioTests();
    }
  } else {
    await testLLMConnection();
  }
}

main().catch(console.error);
