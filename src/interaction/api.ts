/**
 * API 服务 - OpenClaw 风格
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import { getBrain } from '../core/brain';
import { getLogger } from '../observability/logger';

const logger = getLogger('api');

/**
 * 创建 API 服务器
 */
export function createAPIServer(options: { port: number } = { port: 3000 }) {
  const app = express();
  
  app.use(cors());
  app.use(express.json());

  // 健康检查
  app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  // 对话接口
  app.post('/chat', async (req: Request, res: Response) => {
    try {
      const { message, conversationId = 'default' } = req.body;
      
      if (!message) {
        return res.status(400).json({ error: 'message is required' });
      }

      logger.info('对话请求', { message: message.slice(0, 50), conversationId });

      const brain = getBrain();
      const decision = await brain.process(message);

      res.json({
        success: true,
        data: {
          type: decision.action,
          response: decision.response,
          skill: decision.skillName,
          intent: decision.intent,
          conversationId,
        },
      });
    } catch (error) {
      logger.error('对话处理失败', { error });
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  // 流式对话接口
  app.post('/chat/stream', async (req: Request, res: Response) => {
    try {
      const { message, conversationId = 'default' } = req.body;
      
      if (!message) {
        return res.status(400).json({ error: 'message is required' });
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const brain = getBrain();
      
      for await (const event of brain.processStream(message, conversationId)) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }

      res.end();
    } catch (error) {
      logger.error('流式对话处理失败', { error });
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : '未知错误',
      });
    }
  });

  return {
    app,
    start: () => {
      app.listen(options.port, '0.0.0.0', () => {
        logger.info(`API服务已启动: http://0.0.0.0:${options.port}`);
      });
    },
    stop: () => {
      logger.info('API服务已停止');
    },
  };
}

export type APIServer = ReturnType<typeof createAPIServer>;
