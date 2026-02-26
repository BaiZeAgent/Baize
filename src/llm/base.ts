/**
 * LLM提供商基类
 * 
 * v3.1.0 更新：
 * - 新增 embed 方法（可选实现）
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
   * 文本嵌入（可选实现）
   * 
   * 将文本转换为向量表示
   * 子类可以覆盖此方法以支持嵌入功能
   */
  async embed?(text: string): Promise<number[]>;

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
