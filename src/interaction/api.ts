/**
 * API 服务 - OpenClaw 风格
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import { getBrain } from '../core/brain';
import { getSkillRegistry } from '../skills/registry';
import { getMemory } from '../memory';
import { initDatabase } from '../memory/database';
import { getCostManager } from '../core/cost';
import { getLLMManager } from '../llm';
import { getLogger } from '../observability/logger';
import { SkillLoader } from '../skills/loader';
import { registerBuiltinSkills } from '../skills/builtins';

const logger = getLogger('api');

let initialized = false;

/**
 * 初始化 API 服务
 */
async function initializeAPI(): Promise<void> {
  if (initialized) return;

  try {
    // 初始化数据库
    await initDatabase();

    // 初始化 LLM
    getLLMManager();

    // 注册内置技能
    registerBuiltinSkills();

    // 加载外部技能
    const loader = new SkillLoader();
    const skills = await loader.loadAll();
    const registry = getSkillRegistry();
    for (const skill of skills) {
      registry.register(skill);
    }

    initialized = true;
    logger.info('API 服务初始化完成');
  } catch (error) {
    logger.error('API 服务初始化失败', { error });
    throw error;
  }
}

/**
 * 创建 API 服务器
 */
export function createAPIServer(options: { port: number } = { port: 3000 }) {
  const app = express();
  
  app.use(cors());
  app.use(express.json());

  // ==================== 健康检查 ====================
  
  app.get('/health', (req: Request, res: Response) => {
    res.json({ 
      status: 'ok', 
      timestamp: Date.now(),
      version: '3.2.0'
    });
  });

  // ==================== 对话接口 ====================

  // 对话接口（非流式）
  app.post('/api/chat', async (req: Request, res: Response) => {
    try {
      const { message, conversationId = 'default' } = req.body;
      
      if (!message) {
        return res.status(400).json({ error: 'message is required' });
      }

      logger.info('对话请求', { message: message.slice(0, 50), conversationId });

      // 确保初始化
      await initializeAPI();

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
  app.post('/api/chat/stream', async (req: Request, res: Response) => {
    try {
      const { message, conversationId = 'default' } = req.body;
      
      if (!message) {
        return res.status(400).json({ error: 'message is required' });
      }

      // 确保初始化
      await initializeAPI();

      // 设置 SSE 头
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');

      const brain = getBrain();
      
      for await (const event of brain.processStream(message, conversationId)) {
        res.write(`event: ${event.type}\n`);
        res.write(`data: ${JSON.stringify(event.data)}\n\n`);
      }

      res.end();
    } catch (error) {
      logger.error('流式对话处理失败', { error });
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : '未知错误',
        });
      }
    }
  });

  // 获取对话历史
  app.get('/api/chat/history', async (req: Request, res: Response) => {
    try {
      await initializeAPI();
      const brain = getBrain();
      const history = brain.getHistory();
      res.json({
        success: true,
        data: {
          history: history.map(h => ({
            role: h.role,
            content: h.content
          })),
          conversationId: 'default'
        }
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // 清空对话历史
  app.delete('/api/chat/history', async (req: Request, res: Response) => {
    try {
      await initializeAPI();
      const brain = getBrain();
      brain.clearHistory();
      res.json({
        success: true,
        message: '对话历史已清空'
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ==================== 技能接口 ====================

  // 获取技能列表
  app.get('/api/skills', async (req: Request, res: Response) => {
    try {
      await initializeAPI();
      const registry = getSkillRegistry();
      const skills = registry.getAll().map(s => s.toInfo());
      res.json({
        success: true,
        data: { skills }
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // 获取技能详情
  app.get('/api/skills/:name', async (req: Request, res: Response) => {
    try {
      await initializeAPI();
      const registry = getSkillRegistry();
      const skillName = Array.isArray(req.params.name) ? req.params.name[0] : req.params.name;
      const skill = registry.get(skillName);
      if (!skill) {
        return res.status(404).json({ error: '技能不存在' });
      }
      res.json({
        success: true,
        data: skill.toInfo()
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ==================== 记忆接口 ====================

  // 获取记忆统计
  app.get('/api/memory/stats', async (req: Request, res: Response) => {
    try {
      await initializeAPI();
      const memory = getMemory();
      res.json({
        success: true,
        data: {
          episodicCount: memory.getEpisodes().length,
          preferences: Object.keys(memory.getAllPreferences()).length,
        }
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // 搜索记忆
  app.get('/api/memory/search', async (req: Request, res: Response) => {
    try {
      await initializeAPI();
      const query = req.query.q;
      if (!query || typeof query !== 'string') {
        return res.status(400).json({ error: 'q is required' });
      }
      const memory = getMemory();
      const episodes = memory.getEpisodes(undefined, 100);
      const results = episodes.filter(e => 
        e.content.toLowerCase().includes(query.toLowerCase())
      );
      res.json({
        success: true,
        data: { results }
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ==================== 成本接口 ====================

  // 获取成本统计
  app.get('/api/cost/stats', async (req: Request, res: Response) => {
    try {
      await initializeAPI();
      const costManager = getCostManager();
      const stats = costManager.getStats();
      res.json({
        success: true,
        data: stats
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // 获取成本配置
  app.get('/api/cost/config', async (req: Request, res: Response) => {
    try {
      await initializeAPI();
      const costManager = getCostManager();
      res.json({
        success: true,
        data: costManager.getConfig()
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // 更新成本配置
  app.put('/api/cost/config', async (req: Request, res: Response) => {
    try {
      await initializeAPI();
      const costManager = getCostManager();
      costManager.updateConfig(req.body);
      res.json({
        success: true,
        message: '配置已更新'
      });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // ==================== 配置接口 ====================

  // 获取 LLM 配置
  app.get('/api/config/llm', (req: Request, res: Response) => {
    res.json({
      success: true,
      data: {
        default: 'aliyun',
        providers: ['aliyun', 'zhipu', 'ollama']
      }
    });
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
