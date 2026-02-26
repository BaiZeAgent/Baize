/**
 * Ollama本地LLM提供商
 */
import { LLMMessage, LLMOptions, LLMResponse, LLMProviderConfig } from '../../types';
import { BaseLLMProvider } from '../base';
import { getLogger } from '../../observability/logger';

const logger = getLogger('llm:ollama');

export class OllamaProvider extends BaseLLMProvider {
  constructor(name: string, config: LLMProviderConfig) {
    super(name, config);
  }

  async chat(
    messages: LLMMessage[],
    options?: LLMOptions
  ): Promise<LLMResponse> {
    const mergedOptions = this.mergeOptions(options);
    
    logger.debug(`发送请求到 Ollama`, {
      model: this.config.model,
      messageCount: messages.length,
    });

    try {
      const response = await fetch(`${this.config.baseURL}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: messages.map(m => ({
            role: m.role,
            content: m.content,
          })),
          options: {
            temperature: mergedOptions.temperature,
            num_predict: mergedOptions.maxTokens,
          },
          stream: false,
        }),
        signal: AbortSignal.timeout(mergedOptions.timeout),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama请求失败: ${response.status} ${errorText}`);
      }

      const data = await response.json() as {
        message: {
          content: string;
        };
        model: string;
        eval_count?: number;
        prompt_eval_count?: number;
      };

      const content = data.message?.content || '';
      
      logger.debug(`收到响应`, {
        model: data.model,
        contentLength: content.length,
      });

      return {
        content,
        usage: {
          promptTokens: data.prompt_eval_count || 0,
          completionTokens: data.eval_count || 0,
          totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
        },
        model: data.model,
        provider: this.name,
      };
    } catch (error) {
      logger.error(`Ollama请求失败: ${error}`);
      throw error;
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseURL}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.config.baseURL}/api/tags`);
      if (!response.ok) {
        return [];
      }
      const data = await response.json() as { models: Array<{ name: string }> };
      return data.models?.map(m => m.name) || [];
    } catch {
      return [];
    }
  }
}
