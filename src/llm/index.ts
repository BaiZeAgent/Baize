/**
 * LLM管理器 - 管理多个LLM提供商
 * 
 * v3.1.0 更新：
 * - 新增 embed 方法支持文本嵌入
 */
import YAML from 'yaml';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { LLMMessage, LLMOptions, LLMResponse, LLMProviderConfig } from '../types';
import { BaseLLMProvider } from './base';
import { OpenAICompatibleProvider } from './providers/openai-compatible';
import { OllamaProvider } from './providers/ollama';
import { getLogger } from '../observability/logger';
import { getCostManager } from '../core/cost';

// 尝试从多个位置加载.env文件
const envPaths = [
  // 当前工作目录
  path.resolve(process.cwd(), '.env'),
  // 项目根目录（相对于dist/llm/index.js）
  path.resolve(__dirname, '..', '..', '.env'),
  // 用户主目录
  path.resolve(process.env.HOME || '', '.baize', '.env'),
];

let envLoaded = false;
for (const envPath of envPaths) {
  try {
    if (fs.existsSync(envPath)) {
      const result = dotenv.config({ path: envPath });
      if (!result.error) {
        envLoaded = true;
        // 只在调试时输出
        // console.log(`[dotenv] 已加载: ${envPath}`);
        break;
      }
    }
  } catch (e) {
    // 继续尝试下一个路径
  }
}

if (!envLoaded) {
  // 最后尝试默认的dotenv.config()
  dotenv.config();
}

const logger = getLogger('llm:manager');

interface LLMConfig {
  default: string;
  providers: Record<string, LLMProviderConfig>;
  strategy: {
    taskMapping: Record<string, string>;
    fallback: string;
  };
}

/**
 * LLM管理器
 */
export class LLMManager {
  private providers: Map<string, BaseLLMProvider> = new Map();
  private config: LLMConfig;
  private defaultProvider: string;

  private constructor(config: LLMConfig) {
    this.config = config;
    this.defaultProvider = config.default;
    this.initializeProviders();
  }

  /**
   * 从配置文件创建LLM管理器
   */
  static fromConfig(configPath: string = 'config/llm.yaml'): LLMManager {
    // 尝试多个可能的配置文件路径
    const possiblePaths = [
      configPath,
      // 当前工作目录
      configPath,
      // 包安装目录
      require('path').join(__dirname, '..', '..', configPath),
      // 用户主目录
      require('path').join(require('os').homedir(), '.baize', configPath),
    ];
    
    let content: string | null = null;
    let usedPath: string | null = null;
    
    for (const p of possiblePaths) {
      try {
        if (fs.existsSync(p)) {
          content = fs.readFileSync(p, 'utf-8');
          usedPath = p;
          break;
        }
      } catch (e) {
        // 继续尝试下一个路径
      }
    }
    
    if (!content) {
      // 如果找不到配置文件，使用默认配置
      logger.warn('未找到LLM配置文件，使用默认配置');
      const defaultConfig: LLMConfig = {
        default: 'aliyun',
        providers: {
          aliyun: {
            enabled: true,
            type: 'openai-compatible',
            baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            model: 'qwen-max',
            temperature: 0.7,
            maxTokens: 4096,
            timeout: 60000,
          },
        },
        strategy: {
          taskMapping: { thinking: 'aliyun', simple: 'aliyun' },
          fallback: 'aliyun',
        },
      };
      return new LLMManager(defaultConfig);
    }
    
    const config = YAML.parse(content) as LLMConfig;
    logger.info(`已加载LLM配置: ${usedPath}`);
    return new LLMManager(config);
  }

  /**
   * 初始化所有提供商
   */
  private initializeProviders(): void {
    for (const [name, config] of Object.entries(this.config.providers)) {
      if (!config.enabled) {
        logger.debug(`提供商 ${name} 已禁用`);
        continue;
      }

      try {
        const provider = this.createProvider(name, config);
        if (provider) {
          this.providers.set(name, provider);
          logger.info(`已加载提供商: ${name} (${config.type})`);
        }
      } catch (error) {
        logger.warn(`加载提供商 ${name} 失败: ${error}`);
      }
    }
  }

  /**
   * 创建提供商实例
   */
  private createProvider(name: string, config: LLMProviderConfig): BaseLLMProvider | null {
    switch (config.type) {
      case 'openai-compatible': {
        const envKey = `${name.toUpperCase()}_API_KEY`;
        const apiKey = process.env[envKey] || config.apiKey || '';
        
        if (!apiKey) {
          logger.warn(`提供商 ${name} 缺少API Key，请设置环境变量 ${envKey}`);
          return null;
        }
        
        return new OpenAICompatibleProvider(name, config, apiKey);
      }
      
      case 'ollama':
        return new OllamaProvider(name, config);
      
      default:
        logger.warn(`未知的提供商类型: ${config.type}`);
        return null;
    }
  }

  /**
   * 发送聊天请求
   */
  async chat(
    messages: LLMMessage[],
    options?: LLMOptions,
    providerName?: string
  ): Promise<LLMResponse> {
    const name = providerName || this.defaultProvider;
    const provider = this.providers.get(name);
    
    if (!provider) {
      throw new Error(`提供商 ${name} 不可用`);
    }

    // 成本控制检查
    const costManager = getCostManager();
    const providerConfig = this.config.providers[name];
    const model = providerConfig?.model || 'default';
    
    // 估算Token数量
    const estimatedTokens = messages.reduce((sum, m) => sum + (m.content?.length || 0) / 2, 0);
    
    if (!costManager.canProceed(estimatedTokens, model)) {
      throw new Error('预算超限，请稍后再试或增加预算');
    }

    // 调用LLM
    const response = await provider.chat(messages, options);

    // 记录成本
    if (response.usage) {
      costManager.recordUsage(
        name,
        model,
        response.usage.promptTokens || 0,
        response.usage.completionTokens || 0
      );
    }

    return response;
  }

  /**
   * 文本嵌入
   * 
   * 将文本转换为向量表示
   * 用于语义搜索、相似度计算等
   */
  async embed(text: string, providerName?: string): Promise<number[]> {
    const name = providerName || this.defaultProvider;
    const provider = this.providers.get(name);
    
    if (!provider) {
      throw new Error(`提供商 ${name} 不可用`);
    }

    // 检查提供商是否支持嵌入
    if (provider.embed) {
      try {
        const result = await provider.embed(text);
        logger.debug(`[llm-embed] text="${text.slice(0, 30)}..." dims=${result.length}`);
        return result;
      } catch (error) {
        logger.warn(`[llm-embed-error] ${error}`);
        throw error;
      }
    }

    throw new Error(`提供商 ${name} 不支持文本嵌入`);
  }

  /**
   * 获取默认提供商
   */
  getDefaultProvider(): BaseLLMProvider | undefined {
    return this.providers.get(this.defaultProvider);
  }

  /**
   * 获取提供商
   */
  getProvider(name: string): BaseLLMProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * 获取所有可用的提供商
   */
  getAvailableProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * 检查提供商是否可用
   */
  async checkAvailability(name: string): Promise<boolean> {
    const provider = this.providers.get(name);
    if (!provider) {
      return false;
    }
    return provider.isAvailable();
  }

  /**
   * 根据任务类型选择提供商
   */
  getProviderForTask(taskType: string): string {
    const mapped = this.config.strategy.taskMapping[taskType];
    if (mapped && this.providers.has(mapped)) {
      return mapped;
    }
    return this.defaultProvider;
  }
}

// 单例实例
let llmManager: LLMManager | null = null;

/**
 * 获取LLM管理器实例
 */
export function getLLMManager(): LLMManager {
  if (!llmManager) {
    llmManager = LLMManager.fromConfig();
  }
  return llmManager;
}

/**
 * 初始化LLM管理器
 */
export function initLLMManager(configPath?: string): LLMManager {
  llmManager = LLMManager.fromConfig(configPath);
  return llmManager;
}
