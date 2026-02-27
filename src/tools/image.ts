/**
 * 图像工具
 * 
 * 功能：
 * - 图像生成 (通过 LLM API)
 * - 图像描述
 * - 图像处理
 */

import { BaseTool, ToolResult, readStringParam, readNumberParam, jsonResult, errorResult } from './base';
import { getLLMManager } from '../llm';
import { getLogger } from '../observability/logger';

const logger = getLogger('tools:image');

// 图像生成结果
interface ImageGenerateResult {
  prompt: string;
  imageUrls: string[];
  provider: string;
  tookMs: number;
}

// 图像描述结果
interface ImageDescribeResult {
  description: string;
  tags: string[];
  tookMs: number;
}

/**
 * 图像生成工具
 */
export class ImageGenerateTool extends BaseTool<Record<string, unknown>, ImageGenerateResult> {
  name = 'image_generate';
  label = 'Image Generate';
  description = '根据文本描述生成图像。支持多种图像生成模型。';
  parameters = {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: '图像描述提示词',
      },
      size: {
        type: 'string',
        enum: ['256x256', '512x512', '1024x1024'],
        description: '图像尺寸，默认 512x512',
      },
      count: {
        type: 'number',
        description: '生成图像数量 (1-4)',
        minimum: 1,
        maximum: 4,
      },
    },
    required: ['prompt'],
  };

  async execute(params: Record<string, unknown>): Promise<ToolResult<ImageGenerateResult>> {
    const prompt = readStringParam(params, 'prompt', { required: true, label: '提示词' });
    if (!prompt) {
      return errorResult('提示词不能为空');
    }

    const size = readStringParam(params, 'size') ?? '512x512';
    const count = readNumberParam(params, 'count', { min: 1, max: 4 }) ?? 1;

    logger.info(`生成图像: "${prompt.slice(0, 50)}..." (size=${size}, count=${count})`);

    const start = Date.now();

    try {
      // 检查是否有图像生成 API
      const apiKey = process.env.OPENAI_API_KEY || process.env.ALIYUN_API_KEY;
      
      if (!apiKey) {
        // 如果没有图像生成 API，返回提示
        return jsonResult({
          prompt,
          imageUrls: [],
          provider: 'none',
          tookMs: Date.now() - start,
        });
      }

      // 使用 OpenAI DALL-E API
      if (process.env.OPENAI_API_KEY) {
        const response = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'dall-e-3',
            prompt,
            n: count,
            size: size as '256x256' | '512x512' | '1024x1024',
          }),
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`OpenAI API 错误: ${error}`);
        }

        const data = await response.json() as any;
        const imageUrls = data.data?.map((img: any) => img.url) || [];

        return jsonResult({
          prompt,
          imageUrls,
          provider: 'openai',
          tookMs: Date.now() - start,
        });
      }

      // 阿里云通义万相
      if (process.env.ALIYUN_API_KEY) {
        const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.ALIYUN_API_KEY}`,
            'X-DashScope-Async': 'enable',
          },
          body: JSON.stringify({
            model: 'wanx-v1',
            input: {
              prompt,
            },
            parameters: {
              size,
              n: count,
            },
          }),
        });

        if (!response.ok) {
          const error = await response.text();
          throw new Error(`阿里云 API 错误: ${error}`);
        }

        // 异步任务，返回任务 ID
        const data = await response.json() as any;
        
        return jsonResult({
          prompt,
          imageUrls: data.output?.results?.map((img: any) => img.url) || [],
          provider: 'aliyun',
          tookMs: Date.now() - start,
        });
      }

      return jsonResult({
        prompt,
        imageUrls: [],
        provider: 'none',
        tookMs: Date.now() - start,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`图像生成失败: ${errorMsg}`);
      return errorResult(errorMsg);
    }
  }
}

/**
 * 图像描述工具
 */
export class ImageDescribeTool extends BaseTool<Record<string, unknown>, ImageDescribeResult> {
  name = 'image_describe';
  label = 'Image Describe';
  description = '描述图像内容。使用视觉语言模型分析图像并生成文字描述。';
  parameters = {
    type: 'object',
    properties: {
      imageUrl: {
        type: 'string',
        description: '图像 URL',
      },
      detail: {
        type: 'string',
        enum: ['low', 'high', 'auto'],
        description: '描述详细程度',
      },
    },
    required: ['imageUrl'],
  };

  async execute(params: Record<string, unknown>): Promise<ToolResult<ImageDescribeResult>> {
    const imageUrl = readStringParam(params, 'imageUrl', { required: true, label: '图像 URL' });
    if (!imageUrl) {
      return errorResult('图像 URL 不能为空');
    }

    const detail = readStringParam(params, 'detail') ?? 'auto';

    logger.info(`描述图像: ${imageUrl.slice(0, 50)}...`);

    const start = Date.now();

    try {
      const llm = getLLMManager();
      
      // 使用 LLM 的视觉能力
      const response = await llm.chat([
        {
          role: 'user',
          content: [
            { type: 'text', text: '请详细描述这张图片的内容，包括主体、背景、颜色、氛围等。' },
            { type: 'image_url', image_url: { url: imageUrl, detail } },
          ] as any,
        },
      ]);

      const description = response.content;
      
      // 提取标签
      const tagsPrompt = `根据以下描述，提取 5 个关键词标签（只返回标签，用逗号分隔）：\n\n${description}`;
      const tagsResponse = await llm.chat([
        { role: 'user', content: tagsPrompt },
      ]);
      const tags = tagsResponse.content.split(/[,，、\s]+/).filter(t => t.length > 0).slice(0, 5);

      return jsonResult({
        description,
        tags,
        tookMs: Date.now() - start,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`图像描述失败: ${errorMsg}`);
      return errorResult(errorMsg);
    }
  }
}
