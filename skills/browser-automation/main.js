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
  maxSteps = 15,  // 最大步数
  timeout = 90000 // 总超时
} = input;

// LLM配置
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
    // 提取可交互元素
    const interactiveElements = [];
    const selectors = ['a', 'button', 'input', 'textarea', 'select', '[onclick]', '[role="button"]'];
    
    selectors.forEach(sel => {
      document.querySelectorAll(sel).forEach((el) => {
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
    
    // 提取页面文本
    const bodyText = document.body.innerText.slice(0, 2000);
    
    return {
      bodyText,
      interactiveElements: interactiveElements.slice(0, 30)
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
  const systemPrompt = `你是浏览器操作Agent。根据页面状态决定下一步操作。

## 可用操作

1. navigate - 导航到URL（搜索任务推荐）
   {"action": "navigate", "url": "https://..."}

2. click - 点击元素
   {"action": "click", "selector": "text:按钮文字"}

3. fill - 填写输入框
   {"action": "fill", "selector": "input[type=text]", "value": "内容"}

4. scroll - 滚动页面
   {"action": "scroll", "direction": "down"}

5. wait - 等待
   {"action": "wait", "ms": 2000}

6. extract - 提取数据
   {"action": "extract", "data": {...}}

7. done - 任务完成
   {"action": "done", "message": "完成说明"}

## 搜索URL模板

- B站: https://search.bilibili.com/all?keyword=关键词
- 百度: https://www.baidu.com/s?wd=关键词
- Google: https://www.google.com/search?q=关键词
- 小红书: https://www.xiaohongshu.com/search_result?keyword=关键词

## 规则

1. 搜索任务直接用URL导航，不要在首页找搜索框
2. 观察页面元素，选择正确选择器
3. 任务完成时用extract或done
4. 输出JSON格式`;

  const userPrompt = `## 任务
${task}

## 当前页面
URL: ${pageState.url}
标题: ${pageState.title}

## 页面内容
${pageState.bodyText}

## 可交互元素
${pageState.interactiveElements.slice(0, 15).map((el, i) => 
  `${i + 1}. [${el.type}] "${el.text}" ${el.id ? '#' + el.id : ''} ${el.class ? '.' + el.class : ''}`
).join('\n')}

## 已执行操作
${history.map((h, i) => `${i + 1}. ${h.action}: ${h.result}`).join('\n') || '无'}

下一步操作（JSON）：`;

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
        await page.goto(action.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
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
        result.result = `填写: ${action.value}`;
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
        result.result = `提取数据`;
        result.success = true;
        result.data = action.data;
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
    result.result = `失败: ${error.message}`;
    result.success = false;
  }
  
  return result;
}

/**
 * 从页面提取搜索结果
 */
async function extractSearchResults() {
  return await page.evaluate(() => {
    const results = [];
    
    // B站视频卡片
    const biliCards = document.querySelectorAll('.bili-video-card');
    biliCards.forEach((item, i) => {
      if (i >= 5) return;
      
      const linkEl = item.querySelector('a[href*="video"]');
      const titleEl = item.querySelector('.bili-video-card__info--tit');
      
      if (linkEl && titleEl) {
        const title = titleEl.textContent.trim().slice(0, 100);
        const link = linkEl.href;
        if (title && link) {
          results.push({ title, link });
        }
      }
    });
    
    if (results.length > 0) return results;
    
    // 通用选择器
    const selectors = [
      '.video-list-item',
      '.search-result-item',
      '[class*="video"]',
      '[class*="note"]',
      '[class*="item"]'
    ];
    
    for (const sel of selectors) {
      const items = document.querySelectorAll(sel);
      if (items.length > 0) {
        items.forEach((item, i) => {
          if (i >= 5) return;
          
          const linkEl = item.querySelector('a[href*="video"]') || 
                         item.querySelector('a') ||
                         item.querySelector('[href]');
          const titleEl = item.querySelector('[class*="title"]') ||
                          item.querySelector('h3') ||
                          item.querySelector('h4') ||
                          item;
          
          if (linkEl && titleEl) {
            const title = titleEl.textContent.trim().slice(0, 100);
            const link = linkEl.href;
            
            if (title && link && !link.includes('javascript:')) {
              results.push({ title, link });
            }
          }
        });
        
        if (results.length > 0) break;
      }
    }
    
    return results;
  });
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
      
      // 如果是extract或done操作，从页面提取真实数据
      if (action.action === 'extract' || action.action === 'done') {
        const pageResults = await extractSearchResults();
        if (pageResults.length > 0) {
          extractedData = {
            results: pageResults,
            firstVideo: pageResults[0]
          };
        }
      }
    }
    
    // 如果没有提取到数据，尝试自动提取
    if (!extractedData) {
      const pageResults = await extractSearchResults();
      if (pageResults.length > 0) {
        extractedData = {
          results: pageResults,
          firstVideo: pageResults[0]
        };
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
