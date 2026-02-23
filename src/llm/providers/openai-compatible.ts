/**
 * OpenAI兼容的LLM提供商
 */
import { LLMMessage, LLMOptions, LLMResponse, LLMProviderConfig } from '../../types';
import { BaseLLMProvider } from '../base';
import { getLogger } from '../../observability/logger';

const logger = getLogger('llm:openai-compatible');

export class OpenAICompatibleProvider extends BaseLLMProvider {
  private apiKey: string;

  constructor(name: string, config: LLMProviderConfig, apiKey: string) {
    super(name, config);
    this.apiKey = apiKey;
  }

  async chat(
    messages: LLMMessage[],
    options?: LLMOptions
  ): Promise<LLMResponse> {
    const mergedOptions = this.mergeOptions(options);
    
    logger.debug(`发送请求到 ${this.name}`, {
      model: this.config.model,
      messageCount: messages.length,
    });

    try {
      const response = await fetch(`${this.config.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: messages.map(m => ({
            role: m.role,
            content: m.content,
          })),
          temperature: mergedOptions.temperature,
          max_tokens: mergedOptions.maxTokens,
        }),
        signal: AbortSignal.timeout(mergedOptions.timeout),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API请求失败: ${response.status} ${errorText}`);
      }

      const data = await response.json() as {
        choices: Array<{
          message: {
            content: string;
          };
        }>;
        usage?: {
          prompt_tokens: number;
          completion_tokens: number;
          total_tokens: number;
        };
        model: string;
      };

      const content = data.choices[0]?.message?.content || '';
      
      logger.debug(`收到响应`, {
        model: data.model,
        contentLength: content.length,
      });

      return {
        content,
        usage: data.usage ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        } : undefined,
        model: data.model,
        provider: this.name,
      };
    } catch (error) {
      logger.error(`请求失败: ${error}`);
      throw error;
    }
  }

  async isAvailable(): Promise<boolean> {
    if (!this.apiKey) {
      return false;
    }

    try {
      const response = await fetch(`${this.config.baseURL}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
