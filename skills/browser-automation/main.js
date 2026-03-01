#!/usr/bin/env node
/**
 * 浏览器自动化技能实现
 * 使用 Playwright 进行浏览器操作
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// 读取输入参数
let input = {};
try {
  const inputStr = process.env.BAIZE_PARAMS || process.argv[2] || '{}';
  input = JSON.parse(inputStr);
} catch (e) {
  console.log(JSON.stringify({ success: false, error: '参数解析失败' }));
  process.exit(0);
}

const { action, url, selector, value, waitTime = 1000, screenshot_path = './screenshot.png' } = input;

// 全局浏览器实例
let browser = null;
let page = null;

/**
 * 初始化浏览器
 */
async function initBrowser() {
  if (!browser) {
    browser = await chromium.launch({
      headless: true, // 无头模式
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
 * 执行操作
 */
async function execute() {
  try {
    await initBrowser();
    
    let result = { success: true, data: {}, message: '' };
    
    switch (action) {
      case 'open':
        if (!url) {
          throw new Error('缺少 url 参数');
        }
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        const title = await page.title();
        result.message = `已打开: ${title}`;
        result.data = { url, title };
        break;
        
      case 'screenshot':
        const fullPath = path.resolve(screenshot_path);
        await page.screenshot({ path: fullPath, fullPage: false });
        result.message = `截图已保存: ${fullPath}`;
        result.data = { path: fullPath };
        break;
        
      case 'extract':
        if (!selector) {
          // 默认提取页面标题和主要内容
          const title = await page.title();
          const content = await page.evaluate(() => {
            // 尝试提取主要内容
            const article = document.querySelector('article') || document.querySelector('main') || document.body;
            return article ? article.innerText.substring(0, 2000) : '';
          });
          result.message = `页面标题: ${title}`;
          result.data = { title, content };
        } else {
          const element = await page.$(selector);
          if (element) {
            const text = await element.innerText();
            result.message = `提取成功`;
            result.data = { text };
          } else {
            throw new Error(`未找到元素: ${selector}`);
          }
        }
        break;
        
      case 'fill':
        if (!selector || !value) {
          throw new Error('缺少 selector 或 value 参数');
        }
        await page.fill(selector, value);
        result.message = `已填入: ${value}`;
        break;
        
      case 'click':
        if (!selector) {
          throw new Error('缺少 selector 参数');
        }
        await page.click(selector);
        result.message = `已点击元素`;
        break;
        
      case 'scroll':
        const scrollValue = value || 'bottom';
        if (scrollValue === 'top') {
          await page.evaluate(() => window.scrollTo(0, 0));
        } else if (scrollValue === 'bottom') {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        } else {
          await page.evaluate((v) => window.scrollTo(0, parseInt(v)), scrollValue);
        }
        result.message = `已滚动页面`;
        break;
        
      case 'wait':
        await page.waitForTimeout(waitTime);
        result.message = `已等待 ${waitTime}ms`;
        break;
        
      case 'search':
        if (!value) {
          throw new Error('缺少搜索关键词');
        }
        // 检查当前是否在搜索引擎
        const currentUrl = page.url();
        if (currentUrl.includes('baidu.com')) {
          await page.fill('#kw', value);
          await page.click('#su');
          await page.waitForLoadState('networkidle');
        } else if (currentUrl.includes('google.com')) {
          await page.fill('input[name="q"]', value);
          await page.press('input[name="q"]', 'Enter');
          await page.waitForLoadState('networkidle');
        } else {
          // 先打开百度
          await page.goto('https://www.baidu.com');
          await page.fill('#kw', value);
          await page.click('#su');
          await page.waitForLoadState('networkidle');
        }
        result.message = `已搜索: ${value}`;
        break;
        
      default:
        throw new Error(`未知操作: ${action}`);
    }
    
    console.log(JSON.stringify(result));
    
  } catch (error) {
    console.log(JSON.stringify({
      success: false,
      error: error.message,
      message: `操作失败: ${error.message}`
    }));
  } finally {
    // 不立即关闭，保持会话
    // await closeBrowser();
  }
}

// 执行
execute().catch(e => {
  console.log(JSON.stringify({ success: false, error: e.message }));
});
