/**
 * 白泽 API 服务 - 标准化 REST API
 * 
 * v3.2.0 更新：
 * - 新增流式对话接口 /api/chat/stream
 * - 支持思考过程暴露
 * - 保持现有接口兼容
 */

import express, { Request, Response, NextFunction } from 'express';
import * as http from 'http';
import cors from 'cors';
import { Server as SocketServer, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
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
import { StreamEvent } from '../types/stream';

const logger = getLogger('api');

// 会话存储
interface SessionMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface Session {
  id: string;
  messages: SessionMessage[];
  createdAt: Date;
  updatedAt: Date;
}

const sessions: Map<string, Session> = new Map();

// 会话管理函数
function getOrCreateSession(conversationId?: string): Session {
  if (conversationId && sessions.has(conversationId)) {
    const session = sessions.get(conversationId)!;
    session.updatedAt = new Date();
    return session;
  }
  
  const newSession: Session = {
    id: uuidv4(),
    messages: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  sessions.set(newSession.id, newSession);
  return newSession;
}

function addMessageToSession(sessionId: string, role: 'user' | 'assistant', content: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.messages.push({ role, content, timestamp: new Date() });
    session.updatedAt = new Date();
    if (session.messages.length > 50) {
      session.messages = session.messages.slice(-50);
    }
  }
}

function getSessionHistory(sessionId: string): SessionMessage[] {
  const session = sessions.get(sessionId);
  return session ? session.messages : [];
}

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
    this.app.use(cors({
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      credentials: true,
    }));

    this.app.use(express.json());
    
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
      
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
          version: '3.2.0',
          uptime: process.uptime(),
        },
      });
    });

    // ==================== 流式对话接口（新增） ====================
    this.app.post('/api/chat/stream', async (req: Request, res: Response) => {
      try {
        const { message, conversationId } = req.body;
        
        if (!message) {
          return res.status(400).json({ success: false, error: '消息不能为空' });
        }

        // 设置SSE头
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');

        const sessionId = conversationId || uuidv4();
        const brain = getBrain();
        const memory = getMemory();

        // 记录用户输入
        memory.recordEpisode('conversation', `用户: ${message}`);

        try {
          // 流式处理
          for await (const event of brain.processStream(message, sessionId)) {
            // 发送SSE事件
            this.sendSSEEvent(res, event);
            
            // 客户端断开
            if (req.aborted) break;
          }

          // 发送会话ID
          this.sendSSEEvent(res, {
            type: 'session',
            timestamp: Date.now(),
            data: { sessionId }
          });

        } catch (streamError) {
          logger.error('流式处理错误', { error: streamError });
          this.sendSSEEvent(res, {
            type: 'error',
            timestamp: Date.now(),
            data: { code: 'STREAM_ERROR', message: streamError instanceof Error ? streamError.message : '流式处理失败' }
          });
        }

        res.end();
      } catch (error) {
        logger.error('流式对话失败', { error });
        if (!res.headersSent) {
          res.status(500).json({ success: false, error: error instanceof Error ? error.message : '未知错误' });
        }
      }
    });

    // ==================== 对话接口（保持兼容） ====================
    this.app.post('/api/chat', async (req: Request, res: Response) => {
      try {
        const { message, conversationId, autoExecute = true } = req.body;
        
        if (!message) {
          return res.status(400).json({
            success: false,
            error: '消息不能为空',
          });
        }

        const session = getOrCreateSession(conversationId);
        const memory = getMemory();
        
        addMessageToSession(session.id, 'user', message);
        memory.recordEpisode('conversation', `用户: ${message}`);
        
        const brain = getBrain();
        const startTime = Date.now();
        
        const history = getSessionHistory(session.id);
        const historyContext = history.slice(-10).map(m => `${m.role}: ${m.content}`).join('\n');
        
        const decision = await brain.process(message, historyContext);
        const duration = (Date.now() - startTime) / 1000;

        if (decision.action === 'reply') {
          addMessageToSession(session.id, 'assistant', decision.response || '');
          memory.recordEpisode('conversation', `白泽: ${decision.response || ''}`);
          
          return res.json({
            success: true,
            data: {
              type: 'reply',
              response: decision.response,
              intent: decision.intent,
              conversationId: session.id,
              duration,
            },
          });
        }

        if (decision.action === 'execute' && decision.thoughtProcess) {
          const tasks = decision.thoughtProcess.decomposition.tasks;
          const scheduling = decision.thoughtProcess.scheduling;

          if (autoExecute && tasks.length > 0 && scheduling) {
            logger.info('执行任务', { taskCount: tasks.length, conversationId: session.id });
            
            const executor = getExecutor();
            const result = await executor.execute(
              tasks, 
              scheduling.parallelGroups,
              {},
              undefined,
              message
            );
            
            brain.recordTaskResult(result.finalMessage);
            
            addMessageToSession(session.id, 'assistant', result.finalMessage);
            memory.recordEpisode('conversation', `白泽: ${result.finalMessage}`);

            return res.json({
              success: true,
              data: {
                type: 'result',
                response: result.finalMessage,
                rawResult: result.rawResult,
                tasks: tasks.map(t => ({
                  description: t.description,
                  skill: t.skillName,
                  status: 'completed',
                })),
                conversationId: session.id,
                duration,
              },
            });
          }

          return res.json({
            success: true,
            data: {
              type: 'task',
              thoughtProcess: {
                understanding: decision.thoughtProcess.understanding,
                tasks: tasks,
              },
              needConfirm: false,
              conversationId: session.id,
              duration,
            },
          });
        }

        return res.json({
          success: true,
          data: {
            type: 'unknown',
            message: '无法理解您的请求',
            conversationId: session.id,
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
        const { conversationId } = req.query;
        
        if (conversationId && typeof conversationId === 'string') {
          const history = getSessionHistory(conversationId);
          res.json({ success: true, data: { history, conversationId } });
        } else {
          const brain = getBrain();
          const history = brain.getHistory();
          res.json({ success: true, data: { history } });
        }
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : '未知错误',
        });
      }
    });

    this.app.delete('/api/chat/history', (req: Request, res: Response) => {
      try {
        const { conversationId } = req.query;
        
        if (conversationId && typeof conversationId === 'string') {
          const session = sessions.get(conversationId);
          if (session) {
            session.messages = [];
            session.updatedAt = new Date();
          }
          res.json({ success: true, message: '会话历史已清空', conversationId });
        } else {
          const brain = getBrain();
          brain.clearHistory();
          res.json({ success: true, message: '对话历史已清空' });
        }
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
        const memory = getMemory();
        const episodes = memory.getRecentConversation(100);
        
        res.json({ 
          success: true, 
          data: { 
            count: episodes.length,
            episodes: episodes.slice(0, 20).map(ep => ({
              content: ep.content,
              timestamp: ep.timestamp,
            })),
          } 
        });
      } catch (error) {
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : '未知错误',
        });
      }
    });

    this.app.get('/api/memory/search', (req: Request, res: Response) => {
      try {
        const { q } = req.query;
        if (!q || typeof q !== 'string') {
          return res.status(400).json({ success: false, error: '搜索关键词不能为空' });
        }
        
        const memory = getMemory();
        const episodes = memory.getRecentConversation(100);
        
        const results = episodes.filter(ep => 
          ep.content.toLowerCase().includes(q.toLowerCase())
        ).slice(0, 20);
        
        res.json({ 
          success: true, 
          data: { 
            query: q,
            results: results.map(r => ({
              content: r.content,
              timestamp: r.timestamp,
            })),
            total: results.length,
          } 
        });
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
        const config = costManager.getConfig();
        
        res.json({ 
          success: true, 
          data: {
            todayCost: stats.today,
            todayRequests: stats.recordCount,
            monthCost: stats.thisMonth,
            budgetRemaining: config.dailyBudget - stats.today,
            yesterday: stats.yesterday,
            thisWeek: stats.thisWeek,
            total: stats.total,
          } 
        });
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

  /**
   * 发送SSE事件
   */
  private sendSSEEvent(res: Response, event: StreamEvent): void {
    res.write(`event: ${event.type}\n`);
    res.write(`data: ${JSON.stringify(event.data)}\n\n`);
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
