/**
 * 白泽 API 服务 - 标准化 REST API
 */

import express, { Request, Response, NextFunction } from 'express';
import * as http from 'http';
import cors from 'cors';
import { Server as SocketServer, Socket } from 'socket.io';
import { getBrain } from '../core/brain';
import { getSkillRegistry } from '../skills/registry';
import { getMarketClient } from '../skills/market';
import { getMemory } from '../memory';
import { getLLMManager } from '../llm';
import { getCostManager } from '../core/cost';
import { getLogger } from '../observability/logger';
import { initDatabase } from '../memory/database';
import { SkillLoader } from '../skills/loader';
import { getExecutor } from '../executor';

const logger = getLogger('api');

export class APIServer {
  private app: express.Application;
  private server: http.Server | null = null;
  private io: SocketServer | null = null;
  private port: number;
  private host: string;

  constructor(options: { port?: number; host?: string } = {}) {
    this.port = options.port || 3000;
    this.host = options.host || '0.0.0.0';
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    // CORS - 允许所有来源
    this.app.use(cors({
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      credentials: true,
    }));

    this.app.use(express.json());
    
    // 添加 CORS 头到所有响应
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
      
      // 处理预检请求
      if (req.method === 'OPTIONS') {
        return res.status(204).end();
      }
      
      logger.debug(`${req.method} ${req.path}`);
      next();
    });
  }

  private setupRoutes(): void {
    // ==================== 健康检查 ====================
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({
        success: true,
        data: {
          status: 'healthy',
          version: '3.0.2',
          uptime: process.uptime(),
        },
      });
    });

    // ==================== 对话接口 ====================
    this.app.post('/api/chat', async (req: Request, res: Response) => {
      try {
        const { message, autoExecute = true } = req.body;
        
        if (!message) {
          return res.status(400).json({
            success: false,
            error: '消息不能为空',
          });
        }

        const brain = getBrain();
        const startTime = Date.now();
        const decision = await brain.process(message);
        const duration = (Date.now() - startTime) / 1000;

        // 直接回复
        if (decision.action === 'reply') {
          return res.json({
            success: true,
            data: {
              type: 'reply',
              response: decision.response,
              intent: decision.intent,
              duration,
            },
          });
        }

        // 执行任务
        if (decision.action === 'execute' && decision.thoughtProcess) {
          const tasks = decision.thoughtProcess.decomposition.tasks;
          const scheduling = decision.thoughtProcess.scheduling;

          // 如果有任务且需要执行
          if (autoExecute && tasks.length > 0 && scheduling) {
            logger.info('执行任务', { taskCount: tasks.length });
            
            const executor = getExecutor();
            const result = await executor.execute(tasks, scheduling.parallelGroups);
            
            // 记录结果到大脑
            brain.recordTaskResult(result.finalMessage);

            return res.json({
              success: true,
              data: {
                type: 'result',
                response: result.finalMessage,
                tasks: tasks.map(t => ({
                  description: t.description,
                  skill: t.skillName,
                  status: 'completed',
                })),
                duration,
              },
            });
          }

          // 不自动执行，返回任务信息
          return res.json({
            success: true,
            data: {
              type: 'task',
              thoughtProcess: {
                understanding: decision.thoughtProcess.understanding,
                tasks: tasks,
              },
              needConfirm: false,
              duration,
            },
          });
        }

        return res.json({
          success: true,
          data: {
            type: 'unknown',
            message: '无法理解您的请求',
            duration,
          },
        });

      } catch (error) {
        logger.error('对话处理失败', { error });
        return res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : '未知错误',
        });
      }
    });

    this.app.get('/api/chat/history', (req: Request, res: Response) => {
      try {
        const brain = getBrain();
        const history = brain.getHistory();
        res.json({ success: true, data: { history } });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : '未知错误',
        });
      }
    });

    this.app.delete('/api/chat/history', (req: Request, res: Response) => {
      try {
        const brain = getBrain();
        brain.clearHistory();
        res.json({ success: true, message: '对话历史已清空' });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : '未知错误',
        });
      }
    });

    // ==================== 技能接口 ====================
    this.app.get('/api/skills', (req: Request, res: Response) => {
      try {
        const registry = getSkillRegistry();
        const skills = registry.getAll();
        res.json({
          success: true,
          data: {
            skills: skills.map(s => ({
              name: s.name,
              description: s.description,
              capabilities: s.capabilities,
              riskLevel: s.riskLevel,
            })),
            total: skills.length,
          },
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : '未知错误',
        });
      }
    });

    this.app.get('/api/skills/:name', (req: Request, res: Response) => {
      try {
        const registry = getSkillRegistry();
        const skill = registry.get(String(req.params.name));
        if (!skill) {
          return res.status(404).json({ success: false, error: '技能不存在' });
        }
        res.json({ success: true, data: skill });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : '未知错误',
        });
      }
    });

    this.app.post('/api/skills/execute', async (req: Request, res: Response) => {
      try {
        const { skillName, params } = req.body;
        if (!skillName) {
          return res.status(400).json({ success: false, error: '技能名称不能为空' });
        }

        const registry = getSkillRegistry();
        const skill = registry.get(skillName);
        if (!skill) {
          return res.status(404).json({ success: false, error: '技能不存在' });
        }

        const result = await skill.run(params || {}, {});
        res.json({
          success: result.success,
          data: result.data,
          message: result.message,
          error: result.error,
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : '未知错误',
        });
      }
    });

    this.app.get('/api/skills/market/search', async (req: Request, res: Response) => {
      try {
        const { q, limit } = req.query;
        if (!q) {
          return res.status(400).json({ success: false, error: '搜索关键词不能为空' });
        }
        const market = getMarketClient();
        const results = await market.search(q as string, {
          limit: limit ? parseInt(String(limit)) : 10
        });
        res.json({ success: true, data: { results } });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : '未知错误',
        });
      }
    });

    this.app.post('/api/skills/market/install', async (req: Request, res: Response) => {
      try {
        const { skillId } = req.body;
        if (!skillId) {
          return res.status(400).json({ success: false, error: '技能ID不能为空' });
        }
        const market = getMarketClient();
        const result = await market.install(skillId);
        res.json({ success: result.success, data: result, error: result.error });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : '未知错误',
        });
      }
    });

    // ==================== 记忆接口 ====================
    this.app.get('/api/memory/stats', (req: Request, res: Response) => {
      try {
        res.json({ success: true, data: { message: '记忆系统正常' } });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : '未知错误',
        });
      }
    });

    // ==================== 成本接口 ====================
    this.app.get('/api/cost/stats', (req: Request, res: Response) => {
      try {
        const costManager = getCostManager();
        const stats = costManager.getStats();
        res.json({ success: true, data: stats });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : '未知错误',
        });
      }
    });

    this.app.get('/api/cost/config', (req: Request, res: Response) => {
      try {
        const costManager = getCostManager();
        const config = costManager.getConfig();
        res.json({ success: true, data: config });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : '未知错误',
        });
      }
    });

    this.app.put('/api/cost/config', (req: Request, res: Response) => {
      try {
        const costManager = getCostManager();
        costManager.updateConfig(req.body);
        res.json({ success: true, message: '配置已更新' });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : '未知错误',
        });
      }
    });

    // ==================== 配置接口 ====================
    this.app.get('/api/config/llm', (req: Request, res: Response) => {
      try {
        const llm = getLLMManager();
        const providers = llm.getAvailableProviders();
        res.json({ success: true, data: { providers, default: 'aliyun' } });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : '未知错误',
        });
      }
    });

    // ==================== 错误处理 ====================
    this.app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
      logger.error('API错误', { error: err.message, path: req.path });
      res.status(500).json({ success: false, error: err.message });
    });
  }

  async start(): Promise<void> {
    await initDatabase();
    getLLMManager();

    const loader = new SkillLoader();
    const skills = await loader.loadAll();
    const registry = getSkillRegistry();
    for (const skill of skills) {
      registry.register(skill);
    }

    return new Promise((resolve) => {
      this.server = http.createServer(this.app);
      this.io = new SocketServer(this.server, { cors: { origin: '*' } });
      this.setupWebSocket();
      this.server.listen(this.port, this.host, () => {
        logger.info(`API服务已启动: http://${this.host}:${this.port}`);
        resolve();
      });
    });
  }

  private setupWebSocket(): void {
    if (!this.io) return;
    this.io.on('connection', (socket: Socket) => {
      logger.debug('WebSocket连接', { id: socket.id });
      socket.on('chat', async (data: { message: string }) => {
        try {
          const brain = getBrain();
          const decision = await brain.process(data.message);
          socket.emit('chat_response', { success: true, decision });
        } catch (error) {
          socket.emit('chat_response', {
            success: false,
            error: error instanceof Error ? error.message : '未知错误',
          });
        }
      });
      socket.on('disconnect', () => {
        logger.debug('WebSocket断开', { id: socket.id });
      });
    });
  }

  stop(): void {
    if (this.io) this.io.close();
    if (this.server) this.server.close();
    logger.info('API服务已停止');
  }
}

if (require.main === module) {
  const server = new APIServer();
  server.start().catch(console.error);
}

export function createAPIServer(options?: { port?: number; host?: string }): APIServer {
  return new APIServer(options);
}
