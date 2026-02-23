/**
 * LLM提供商基类
 */
import { LLMMessage, LLMOptions, LLMResponse, LLMProviderConfig } from '../types';

export abstract class BaseLLMProvider {
  protected config: LLMProviderConfig;
  protected name: string;

  constructor(name: string, config: LLMProviderConfig) {
    this.name = name;
    this.config = config;
  }

  /**
   * 发送聊天请求
   */
  abstract chat(
    messages: LLMMessage[],
    options?: LLMOptions
  ): Promise<LLMResponse>;

  /**
   * 检查提供商是否可用
   */
  abstract isAvailable(): Promise<boolean>;

  /**
   * 获取提供商名称
   */
  getName(): string {
    return this.name;
  }

  /**
   * 获取模型名称
   */
  getModel(): string {
    return this.config.model;
  }

  /**
   * 合并选项
   */
  protected mergeOptions(options?: LLMOptions): Required<LLMOptions> {
    return {
      temperature: options?.temperature ?? this.config.temperature,
      maxTokens: options?.maxTokens ?? this.config.maxTokens,
      timeout: options?.timeout ?? this.config.timeout,
    };
  }
}
