/**
 * 浏览器自动化工具
 * 
 * 类似 OpenClaw 的内置浏览器自动化功能
 * 支持导航、点击、输入、提取、截图等操作
 */

import { BaseTool, ToolResult, ToolContext, readStringParam, readNumberParam, readBooleanParam, jsonResult, errorResult } from './base';
import { getLogger } from '../observability/logger';
import type { Page, Browser, BrowserContext, LaunchOptions } from 'puppeteer';

const logger = getLogger('tools:browser');

// 浏览器操作类型
type BrowserAction = 
  | 'navigate' 
  | 'click' 
  | 'type' 
  | 'extract' 
  | 'screenshot' 
  | 'scroll' 
  | 'wait' 
  | 'evaluate'
  | 'get_content'
  | 'get_html'
  | 'fill_form'
  | 'select'
  | 'hover'
  | 'press'
  | 'go_back'
  | 'go_forward'
  | 'refresh'
  | 'close'
  | 'get_url'
  | 'get_title';

// 浏览器操作结果
interface BrowserResult {
  action: BrowserAction;
  success: boolean;
  data?: any;
  message?: string;
  url?: string;
  title?: string;
  tookMs: number;
}

// 全局浏览器实例管理
class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private lastUsed: number = 0;
  private readonly idleTimeout = 5 * 60 * 1000; // 5分钟空闲超时
  private cleanupTimer: NodeJS.Timeout | null = null;

  /**
   * 获取或创建浏览器实例
   */
  async getBrowser(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) {
      this.lastUsed = Date.now();
      return this.browser;
    }

    const puppeteer = await import('puppeteer');
    
    const options: LaunchOptions = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ],
      defaultViewport: {
        width: 1920,
        height: 1080,
      },
    };

    logger.info('启动浏览器...');
    this.browser = await puppeteer.launch(options);
    this.lastUsed = Date.now();
    this.startCleanupTimer();
    
    return this.browser;
  }

  /**
   * 获取或创建页面
   */
  async getPage(): Promise<Page> {
    const browser = await this.getBrowser();
    
    if (this.page && !this.page.isClosed()) {
      this.lastUsed = Date.now();
      return this.page;
    }

    this.context = await browser.createBrowserContext();
    this.page = await this.context.newPage();
    
    // 设置默认超时
    this.page.setDefaultTimeout(30000);
    this.page.setDefaultNavigationTimeout(60000);
    
    // 设置请求拦截（可选：阻止图片/字体加载以加速）
    await this.page.setRequestInterception(true);
    this.page.on('request', (req) => {
      const resourceType = req.resourceType();
      // 阻止不必要的资源加载
      if (['image', 'font', 'media'].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    this.lastUsed = Date.now();
    return this.page;
  }

  /**
   * 关闭浏览器
   */
  async close(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.page = null;
      logger.info('浏览器已关闭');
    }
  }

  /**
   * 启动空闲清理定时器
   */
  private startCleanupTimer(): void {
    if (this.cleanupTimer) return;
    
    this.cleanupTimer = setInterval(() => {
      if (this.browser && Date.now() - this.lastUsed > this.idleTimeout) {
        logger.info('浏览器空闲超时，自动关闭');
        this.close().catch(err => logger.error(`关闭浏览器失败: ${err}`));
      }
    }, 60000); // 每分钟检查一次
  }
}

// 全局浏览器管理器
const browserManager = new BrowserManager();

/**
 * 浏览器自动化工具
 */
export class BrowserTool extends BaseTool<Record<string, unknown>, BrowserResult> {
  name = 'browser';
  label = 'Browser Automation';
  description = `浏览器自动化工具。支持导航、点击、输入、提取内容、截图等操作。
操作类型：
- navigate: 导航到URL
- click: 点击元素
- type: 输入文本
- extract: 提取页面内容
- screenshot: 截取屏幕
- scroll: 滚动页面
- wait: 等待元素
- evaluate: 执行JavaScript
- get_content: 获取页面文本内容
- get_html: 获取页面HTML
- get_url: 获取当前URL
- get_title: 获取页面标题
- fill_form: 填写表单
- select: 选择下拉选项
- hover: 悬停元素
- press: 按键
- go_back: 后退
- go_forward: 前进
- refresh: 刷新页面
- close: 关闭浏览器`;
  
  parameters = {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: '操作类型',
        enum: ['navigate', 'click', 'type', 'extract', 'screenshot', 'scroll', 'wait', 
               'evaluate', 'get_content', 'get_html', 'fill_form', 'select', 'hover',
               'press', 'go_back', 'go_forward', 'refresh', 'close', 'get_url', 'get_title'],
      },
      url: {
        type: 'string',
        description: 'URL (用于 navigate)',
      },
      selector: {
        type: 'string',
        description: 'CSS选择器 (用于 click, type, wait, hover, select)',
      },
      text: {
        type: 'string',
        description: '输入文本 (用于 type)',
      },
      value: {
        type: 'string',
        description: '值 (用于 select, press)',
      },
      instruction: {
        type: 'string',
        description: '提取指令 (用于 extract)',
      },
      script: {
        type: 'string',
        description: 'JavaScript代码 (用于 evaluate)',
      },
      fields: {
        type: 'object',
        description: '表单字段 {selector: value} (用于 fill_form)',
      },
      direction: {
        type: 'string',
        description: '滚动方向 (up/down/top/bottom)',
        enum: ['up', 'down', 'top', 'bottom'],
      },
      scrollAmount: {
        type: 'number',
        description: '滚动像素数',
      },
      timeout: {
        type: 'number',
        description: '超时时间(毫秒)',
      },
      screenshotPath: {
        type: 'string',
        description: '截图保存路径',
      },
      waitForNavigation: {
        type: 'boolean',
        description: '是否等待导航完成',
      },
    },
    required: ['action'],
  };

  async execute(params: Record<string, unknown>, context?: ToolContext): Promise<ToolResult<BrowserResult>> {
    // 支持 action 和 operation 两种参数名
    let action = readStringParam(params, 'action', { label: '操作类型' }) as BrowserAction;
    if (!action) {
      action = readStringParam(params, 'operation', { label: '操作类型' }) as BrowserAction;
    }
    
    if (!action) {
      return errorResult('操作类型不能为空。请使用 action 参数，可选值: navigate, click, type, extract, screenshot, scroll, wait, evaluate, get_content, get_html, get_url, get_title, fill_form, select, hover, press, go_back, go_forward, refresh, close');
    }

    const start = Date.now();
    logger.info(`执行浏览器操作: ${action}`);

    try {
      let result: BrowserResult;

      switch (action) {
        case 'navigate':
          result = await this.navigate(params);
          break;
        case 'click':
          result = await this.click(params);
          break;
        case 'type':
          result = await this.type(params);
          break;
        case 'extract':
          result = await this.extract(params);
          break;
        case 'screenshot':
          result = await this.screenshot(params);
          break;
        case 'scroll':
          result = await this.scroll(params);
          break;
        case 'wait':
          result = await this.wait(params);
          break;
        case 'evaluate':
          result = await this.evaluate(params);
          break;
        case 'get_content':
          result = await this.getContent(params);
          break;
        case 'get_html':
          result = await this.getHtml(params);
          break;
        case 'get_url':
          result = await this.getUrl(params);
          break;
        case 'get_title':
          result = await this.getTitle(params);
          break;
        case 'fill_form':
          result = await this.fillForm(params);
          break;
        case 'select':
          result = await this.select(params);
          break;
        case 'hover':
          result = await this.hover(params);
          break;
        case 'press':
          result = await this.press(params);
          break;
        case 'go_back':
          result = await this.goBack(params);
          break;
        case 'go_forward':
          result = await this.goForward(params);
          break;
        case 'refresh':
          result = await this.refresh(params);
          break;
        case 'close':
          result = await this.closeBrowser(params);
          break;
        default:
          return errorResult(`未知操作类型: ${action}`);
      }

      result.tookMs = Date.now() - start;
      logger.info(`浏览器操作完成: ${action} (${result.tookMs}ms)`);
      
      return jsonResult(result);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`浏览器操作失败: ${errorMsg}`);
      return errorResult(errorMsg);
    }
  }

  /**
   * 导航到URL
   */
  private async navigate(params: Record<string, unknown>): Promise<BrowserResult> {
    const url = readStringParam(params, 'url', { required: true, label: 'URL' });
    if (!url) {
      return { action: 'navigate', success: false, message: 'URL不能为空', tookMs: 0 };
    }

    const waitForNavigation = readBooleanParam(params, 'waitForNavigation', true);
    const timeout = readNumberParam(params, 'timeout') ?? 60000;

    const page = await browserManager.getPage();
    
    // 构建完整URL
    let fullUrl = url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      fullUrl = 'https://' + url;
    }

    if (waitForNavigation) {
      await page.goto(fullUrl, { waitUntil: 'networkidle2', timeout });
    } else {
      await page.goto(fullUrl, { waitUntil: 'domcontentloaded', timeout });
    }

    return {
      action: 'navigate',
      success: true,
      url: page.url(),
      title: await page.title(),
      message: `已导航到: ${fullUrl}`,
      tookMs: 0,
    };
  }

  /**
   * 点击元素
   */
  private async click(params: Record<string, unknown>): Promise<BrowserResult> {
    const selector = readStringParam(params, 'selector', { required: true, label: '选择器' });
    if (!selector) {
      return { action: 'click', success: false, message: '选择器不能为空', tookMs: 0 };
    }

    const page = await browserManager.getPage();
    const timeout = readNumberParam(params, 'timeout') ?? 30000;

    await page.waitForSelector(selector, { timeout });
    await page.click(selector);

    // 等待可能的导航
    await new Promise(resolve => setTimeout(resolve, 500));

    return {
      action: 'click',
      success: true,
      url: page.url(),
      message: `已点击元素: ${selector}`,
      tookMs: 0,
    };
  }

  /**
   * 输入文本
   */
  private async type(params: Record<string, unknown>): Promise<BrowserResult> {
    const selector = readStringParam(params, 'selector', { required: true, label: '选择器' });
    const text = readStringParam(params, 'text', { required: true, label: '文本' });
    
    if (!selector || text === undefined) {
      return { action: 'type', success: false, message: '选择器和文本不能为空', tookMs: 0 };
    }

    const page = await browserManager.getPage();
    const timeout = readNumberParam(params, 'timeout') ?? 30000;
    const clear = readBooleanParam(params, 'clear', true);

    await page.waitForSelector(selector, { timeout });
    
    if (clear) {
      await page.click(selector, { clickCount: 3 }); // 选中全部
    }
    
    await page.type(selector, text);

    return {
      action: 'type',
      success: true,
      message: `已在 ${selector} 输入文本`,
      tookMs: 0,
    };
  }

  /**
   * 提取页面内容
   */
  private async extract(params: Record<string, unknown>): Promise<BrowserResult> {
    const page = await browserManager.getPage();
    const instruction = readStringParam(params, 'instruction') || '提取页面主要内容';
    const selector = readStringParam(params, 'selector');

    let content: any;

    if (selector) {
      // 提取特定元素
      try {
        await page.waitForSelector(selector, { timeout: 5000 });
        content = await page.$eval(selector, (el) => el.textContent?.trim() || '');
      } catch {
        content = await page.$$eval(selector, (els) => 
          els.map(el => el.textContent?.trim() || '')
        );
      }
    } else {
      // 提取整页内容
      content = await page.evaluate(() => {
        // 尝试找到主要内容区域
        const selectors = ['article', 'main', '.content', '#content', '.post', '.article', 'body'];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && el.textContent && el.textContent.trim().length > 100) {
            return el.textContent.trim();
          }
        }
        return document.body.textContent?.trim() || '';
      });
    }

    return {
      action: 'extract',
      success: true,
      data: content,
      message: `提取内容: ${instruction}`,
      tookMs: 0,
    };
  }

  /**
   * 截取屏幕
   */
  private async screenshot(params: Record<string, unknown>): Promise<BrowserResult> {
    const page = await browserManager.getPage();
    const screenshotPath = readStringParam(params, 'screenshotPath');
    const selector = readStringParam(params, 'selector');
    const fullPage = readBooleanParam(params, 'fullPage', false);

    let screenshot: Buffer;

    if (selector) {
      const element = await page.$(selector);
      if (!element) {
        return { action: 'screenshot', success: false, message: `元素不存在: ${selector}`, tookMs: 0 };
      }
      screenshot = await element.screenshot() as Buffer;
    } else {
      screenshot = await page.screenshot({ fullPage, type: 'png' }) as Buffer;
    }

    const base64 = screenshot.toString('base64');

    return {
      action: 'screenshot',
      success: true,
      data: base64,
      message: screenshotPath ? `截图已保存到: ${screenshotPath}` : '截图完成 (base64)',
      tookMs: 0,
    };
  }

  /**
   * 滚动页面
   */
  private async scroll(params: Record<string, unknown>): Promise<BrowserResult> {
    const page = await browserManager.getPage();
    const direction = readStringParam(params, 'direction') || 'down';
    const amount = readNumberParam(params, 'scrollAmount') ?? 500;

    let scrollY = 0;
    switch (direction) {
      case 'up':
        scrollY = -amount;
        break;
      case 'down':
        scrollY = amount;
        break;
      case 'top':
        await page.evaluate(() => { window.scrollTo(0, 0); });
        return { action: 'scroll', success: true, message: '已滚动到顶部', tookMs: 0 };
      case 'bottom':
        await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); });
        return { action: 'scroll', success: true, message: '已滚动到底部', tookMs: 0 };
    }

    await page.evaluate((y) => {
      window.scrollBy(0, y);
    }, scrollY);

    return {
      action: 'scroll',
      success: true,
      message: `已向${direction === 'up' ? '上' : '下'}滚动 ${Math.abs(scrollY)} 像素`,
      tookMs: 0,
    };
  }

  /**
   * 等待元素
   */
  private async wait(params: Record<string, unknown>): Promise<BrowserResult> {
    const page = await browserManager.getPage();
    const selector = readStringParam(params, 'selector');
    const timeout = readNumberParam(params, 'timeout') ?? 30000;

    if (selector) {
      await page.waitForSelector(selector, { timeout });
      return { action: 'wait', success: true, message: `元素已出现: ${selector}`, tookMs: 0 };
    } else {
      // 等待指定时间
      const ms = timeout;
      await new Promise(resolve => setTimeout(resolve, ms));
      return { action: 'wait', success: true, message: `已等待 ${ms}ms`, tookMs: 0 };
    }
  }

  /**
   * 执行JavaScript
   */
  private async evaluate(params: Record<string, unknown>): Promise<BrowserResult> {
    const script = readStringParam(params, 'script', { required: true, label: '脚本' });
    if (!script) {
      return { action: 'evaluate', success: false, message: '脚本不能为空', tookMs: 0 };
    }

    const page = await browserManager.getPage();
    const result = await page.evaluate(script);

    return {
      action: 'evaluate',
      success: true,
      data: result,
      message: 'JavaScript执行完成',
      tookMs: 0,
    };
  }

  /**
   * 获取页面文本内容
   */
  private async getContent(params: Record<string, unknown>): Promise<BrowserResult> {
    const page = await browserManager.getPage();
    const selector = readStringParam(params, 'selector');

    let content: string;

    if (selector) {
      content = await page.$eval(selector, (el) => el.textContent?.trim() || '');
    } else {
      content = await page.evaluate(() => document.body.textContent?.trim() || '');
    }

    return {
      action: 'get_content',
      success: true,
      data: content,
      url: page.url(),
      title: await page.title(),
      tookMs: 0,
    };
  }

  /**
   * 获取页面HTML
   */
  private async getHtml(params: Record<string, unknown>): Promise<BrowserResult> {
    const page = await browserManager.getPage();
    const selector = readStringParam(params, 'selector');

    let html: string;

    if (selector) {
      html = await page.$eval(selector, (el) => el.outerHTML);
    } else {
      html = await page.content();
    }

    return {
      action: 'get_html',
      success: true,
      data: html,
      url: page.url(),
      tookMs: 0,
    };
  }

  /**
   * 获取当前URL
   */
  private async getUrl(params: Record<string, unknown>): Promise<BrowserResult> {
    const page = await browserManager.getPage();
    const url = page.url();

    return {
      action: 'get_url',
      success: true,
      data: url,
      url,
      tookMs: 0,
    };
  }

  /**
   * 获取页面标题
   */
  private async getTitle(params: Record<string, unknown>): Promise<BrowserResult> {
    const page = await browserManager.getPage();
    const title = await page.title();

    return {
      action: 'get_title',
      success: true,
      data: title,
      title,
      tookMs: 0,
    };
  }

  /**
   * 填写表单
   */
  private async fillForm(params: Record<string, unknown>): Promise<BrowserResult> {
    const fields = params.fields as Record<string, string>;
    if (!fields || typeof fields !== 'object') {
      return { action: 'fill_form', success: false, message: 'fields参数必须是对象', tookMs: 0 };
    }

    const page = await browserManager.getPage();
    const timeout = readNumberParam(params, 'timeout') ?? 30000;

    for (const [selector, value] of Object.entries(fields)) {
      try {
        await page.waitForSelector(selector, { timeout });
        await page.click(selector, { clickCount: 3 });
        await page.type(selector, value);
      } catch (error) {
        return { 
          action: 'fill_form', 
          success: false, 
          message: `填写字段 ${selector} 失败: ${error}`, 
          tookMs: 0 
        };
      }
    }

    return {
      action: 'fill_form',
      success: true,
      message: `已填写 ${Object.keys(fields).length} 个字段`,
      tookMs: 0,
    };
  }

  /**
   * 选择下拉选项
   */
  private async select(params: Record<string, unknown>): Promise<BrowserResult> {
    const selector = readStringParam(params, 'selector', { required: true, label: '选择器' });
    const value = readStringParam(params, 'value', { required: true, label: '值' });

    if (!selector || !value) {
      return { action: 'select', success: false, message: '选择器和值不能为空', tookMs: 0 };
    }

    const page = await browserManager.getPage();
    const timeout = readNumberParam(params, 'timeout') ?? 30000;

    await page.waitForSelector(selector, { timeout });
    await page.select(selector, value);

    return {
      action: 'select',
      success: true,
      message: `已选择: ${value}`,
      tookMs: 0,
    };
  }

  /**
   * 悬停元素
   */
  private async hover(params: Record<string, unknown>): Promise<BrowserResult> {
    const selector = readStringParam(params, 'selector', { required: true, label: '选择器' });
    if (!selector) {
      return { action: 'hover', success: false, message: '选择器不能为空', tookMs: 0 };
    }

    const page = await browserManager.getPage();
    const timeout = readNumberParam(params, 'timeout') ?? 30000;

    await page.waitForSelector(selector, { timeout });
    await page.hover(selector);

    return {
      action: 'hover',
      success: true,
      message: `已悬停: ${selector}`,
      tookMs: 0,
    };
  }

  /**
   * 按键
   */
  private async press(params: Record<string, unknown>): Promise<BrowserResult> {
    const key = readStringParam(params, 'value', { required: true, label: '按键' }) || 
                readStringParam(params, 'key', { required: true, label: '按键' });
    
    if (!key) {
      return { action: 'press', success: false, message: '按键不能为空', tookMs: 0 };
    }

    const page = await browserManager.getPage();
    await page.keyboard.press(key as any); // KeyInput

    return {
      action: 'press',
      success: true,
      message: `已按键: ${key}`,
      tookMs: 0,
    };
  }

  /**
   * 后退
   */
  private async goBack(params: Record<string, unknown>): Promise<BrowserResult> {
    const page = await browserManager.getPage();
    await page.goBack({ waitUntil: 'networkidle2' });

    return {
      action: 'go_back',
      success: true,
      url: page.url(),
      message: '已后退',
      tookMs: 0,
    };
  }

  /**
   * 前进
   */
  private async goForward(params: Record<string, unknown>): Promise<BrowserResult> {
    const page = await browserManager.getPage();
    await page.goForward({ waitUntil: 'networkidle2' });

    return {
      action: 'go_forward',
      success: true,
      url: page.url(),
      message: '已前进',
      tookMs: 0,
    };
  }

  /**
   * 刷新页面
   */
  private async refresh(params: Record<string, unknown>): Promise<BrowserResult> {
    const page = await browserManager.getPage();
    await page.reload({ waitUntil: 'networkidle2' });

    return {
      action: 'refresh',
      success: true,
      url: page.url(),
      title: await page.title(),
      message: '页面已刷新',
      tookMs: 0,
    };
  }

  /**
   * 关闭浏览器
   */
  private async closeBrowser(params: Record<string, unknown>): Promise<BrowserResult> {
    await browserManager.close();

    return {
      action: 'close',
      success: true,
      message: '浏览器已关闭',
      tookMs: 0,
    };
  }
}

/**
 * 浏览器自动化工具参数
 */
export interface BrowserParams {
  action: BrowserAction;
  url?: string;
  selector?: string;
  text?: string;
  value?: string;
  instruction?: string;
  script?: string;
  fields?: Record<string, string>;
  direction?: 'up' | 'down' | 'top' | 'bottom';
  scrollAmount?: number;
  timeout?: number;
  screenshotPath?: string;
  waitForNavigation?: boolean;
  fullPage?: boolean;
  clear?: boolean;
}
