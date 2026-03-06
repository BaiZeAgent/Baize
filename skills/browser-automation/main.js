#!/usr/bin/env node
/**
 * 浏览器自动化Agent - LLM驱动的通用浏览器操作
 * 
 * 核心理念：
 * - 不硬编码任何网站操作
 * - LLM看页面、决定操作、循环执行
 * - 支持任何网站的任何操作
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// 读取输入参数
let input = {};
try {
  const inputStr = process.env.BAIZE_PARAMS || process.argv[2] || '{}';
  const parsed = JSON.parse(inputStr);
  input = parsed.params || parsed;
} catch (e) {
  console.log(JSON.stringify({ success: false, error: '参数解析失败: ' + e.message }));
  process.exit(0);
}

const { 
  task,           // 任务描述
  url,            // 起始URL（可选）
  maxSteps = 20,  // 最大步数
  timeout = 60000 // 总超时
} = input;

// LLM配置
const LLM_API = process.env.ALIYUN_API_KEY ? 'aliyun' : 'openai';
const LLM_KEY = process.env.ALIYUN_API_KEY || process.env.OPENAI_API_KEY;
const LLM_URL = process.env.ALIYUN_API_KEY 
  ? 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
  : 'https://api.openai.com/v1/chat/completions';
const LLM_MODEL = process.env.ALIYUN_API_KEY ? 'qwen-max' : 'gpt-4o';

// 全局浏览器实例
let browser = null;
let page = null;

/**
 * 初始化浏览器
 */
async function initBrowser() {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    page = await browser.newPage();
    page.setDefaultTimeout(30000);
  }
  return { browser, page };
}

/**
 * 关闭浏览器
 */
async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
    page = null;
  }
}

/**
 * 调用LLM
 */
async function callLLM(messages) {
  const response = await fetch(LLM_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LLM_KEY}`
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: messages,
      temperature: 0.3,
      max_tokens: 1000
    })
  });

  const data = await response.json();
  return data.choices[0].message.content;
}

/**
 * 获取页面状态
 */
async function getPageState() {
  const url = page.url();
  const title = await page.title();
  
  // 获取页面关键信息
  const pageInfo = await page.evaluate(() => {
    // 提取可见文本
    const getVisibleText = (el, depth = 0) => {
      if (depth > 3) return '';
      if (el.style?.display === 'none' || el.style?.visibility === 'hidden') return '';
      
      let text = '';
      for (const child of el.childNodes) {
        if (child.nodeType === 3) { // 文本节点
          text += child.textContent + ' ';
        } else if (child.nodeType === 1) { // 元素节点
          text += getVisibleText(child, depth + 1) + ' ';
        }
      }
      return text;
    };
    
    // 提取可交互元素
    const interactiveElements = [];
    const selectors = ['a', 'button', 'input', 'textarea', 'select', '[onclick]', '[role="button"]'];
    
    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach((el, i) => {
        const text = (el.textContent || el.value || el.placeholder || '').trim().slice(0, 50);
        const type = el.tagName.toLowerCase();
        const id = el.id;
        const className = el.className && typeof el.className === 'string' ? el.className.split(' ')[0] : '';
        const name = el.name || el.getAttribute('aria-label') || '';
        
        if (text || id || name) {
          interactiveElements.push({
            type,
            text: text.slice(0, 30),
            id: id || '',
            class: className,
            name: name.slice(0, 30)
          });
        }
      });
    });
    
    return {
      visibleText: getVisibleText(document.body).slice(0, 3000),
      interactiveElements: interactiveElements.slice(0, 50)
    };
  });
  
  return {
    url,
    title,
    ...pageInfo
  };
}

/**
 * LLM决策下一步操作
 */
async function decideNextAction(task, pageState, history) {
  const systemPrompt = `你是一个浏览器操作Agent。根据当前页面状态和任务目标，决定下一步操作。

## 可用操作

1. **navigate**: 导航到URL
   {"action": "navigate", "url": "https://..."}

2. **click**: 点击元素
   {"action": "click", "selector": "button.submit" 或 "text:登录"}

3. **fill**: 填写输入框
   {"action": "fill", "selector": "input.search", "value": "搜索内容"}

4. **scroll**: 滚动页面
   {"action": "scroll", "direction": "down"}

5. **wait**: 等待
   {"action": "wait", "ms": 2000}

6. **extract**: 提取信息（任务完成时）
   {"action": "extract", "data": {...}, "message": "提取到的信息"}

7. **done**: 任务完成
   {"action": "done", "message": "任务完成说明"}

## 选择器格式

- CSS选择器: "button.submit", "input[name='q']"
- 文本选择器: "text:登录", "text:搜索"
- 组合选择器: "button >> text:提交"

## 规则

1. 仔细观察页面上的可交互元素
2. 选择最合适的操作完成目标
3. 如果遇到问题，尝试其他方式
4. 任务完成后使用 extract 或 done
5. 必须输出有效的JSON`;

  const userPrompt = `## 任务目标
${task}

## 当前页面状态
URL: ${pageState.url}
标题: ${pageState.title}

## 页面可见内容
${pageState.visibleText}

## 可交互元素（前20个）
${pageState.interactiveElements.slice(0, 20).map((el, i) => 
  `${i + 1}. [${el.type}] "${el.text}" ${el.id ? '#' + el.id : ''} ${el.class ? '.' + el.class : ''}`
).join('\n')}

## 已执行操作
${history.map((h, i) => `${i + 1}. ${h.action}: ${h.result}`).join('\n') || '无'}

## 下一步操作
请输出JSON格式的操作：`;

  const response = await callLLM([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt }
  ]);

  // 解析JSON
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch (e) {
      return { action: 'wait', ms: 1000 };
    }
  }
  
  return { action: 'wait', ms: 1000 };
}

/**
 * 执行操作
 */
async function executeAction(action) {
  const result = { action: action.action, result: '', success: false };
  
  try {
    switch (action.action) {
      case 'navigate':
        await page.goto(action.url, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        result.result = `导航到: ${action.url}`;
        result.success = true;
        break;
        
      case 'click':
        await page.click(action.selector);
        await page.waitForTimeout(1000);
        result.result = `点击: ${action.selector}`;
        result.success = true;
        break;
        
      case 'fill':
        await page.fill(action.selector, action.value);
        result.result = `填写: ${action.selector} = "${action.value}"`;
        result.success = true;
        break;
        
      case 'scroll':
        if (action.direction === 'down') {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        } else {
          await page.evaluate(() => window.scrollTo(0, 0));
        }
        await page.waitForTimeout(500);
        result.result = `滚动: ${action.direction}`;
        result.success = true;
        break;
        
      case 'wait':
        await page.waitForTimeout(action.ms || 2000);
        result.result = `等待: ${action.ms || 2000}ms`;
        result.success = true;
        break;
        
      case 'extract':
        result.result = `提取数据: ${JSON.stringify(action.data)}`;
        result.success = true;
        result.data = action.data;
        result.message = action.message;
        break;
        
      case 'done':
        result.result = action.message || '任务完成';
        result.success = true;
        result.done = true;
        break;
        
      default:
        result.result = `未知操作: ${action.action}`;
        result.success = false;
    }
  } catch (error) {
    result.result = `执行失败: ${error.message}`;
    result.success = false;
  }
  
  return result;
}

/**
 * 主执行循环
 */
async function execute() {
  const startTime = Date.now();
  const history = [];
  let extractedData = null;
  let done = false;
  
  try {
    await initBrowser();
    
    // 如果有起始URL，先导航
    if (url) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);
    }
    
    // Agent循环
    for (let step = 0; step < maxSteps && !done; step++) {
      // 检查超时
      if (Date.now() - startTime > timeout) {
        console.log(JSON.stringify({
          success: false,
          error: '执行超时',
          steps: step,
          history: history
        }));
        return;
      }
      
      // 获取页面状态
      const pageState = await getPageState();
      
      // LLM决策
      const action = await decideNextAction(task, pageState, history);
      
      // 执行操作
      const result = await executeAction(action);
      history.push(result);
      
      // 检查是否完成
      if (result.done || action.action === 'done') {
        done = true;
      }
      
      if (result.data) {
        extractedData = result.data;
      }
      
      // 如果是extract操作，继续让LLM判断是否完成
      if (action.action === 'extract' && !action.done) {
        // 继续循环
      }
    }
    
    // 返回结果
    console.log(JSON.stringify({
      success: true,
      message: extractedData ? '数据提取成功' : '任务执行完成',
      data: extractedData || { history: history.map(h => h.result) },
      steps: history.length,
      history: history
    }));
    
  } catch (error) {
    console.log(JSON.stringify({
      success: false,
      error: error.message,
      history: history
    }));
  } finally {
    await closeBrowser();
  }
}

execute().catch(e => {
  console.log(JSON.stringify({ success: false, error: e.message }));
});
