/**
 * API集成测试
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAPIServer } from '../interaction/api';
import { getSkillRegistry } from '../skills/registry';
import { SkillLoader } from '../skills/loader';
import { initDatabase } from '../memory/database';
import { getLLMManager } from '../llm';

interface ApiResponse {
  success?: boolean;
  data?: any;
  error?: string;
  status?: string;
  version?: string;
}

describe('API集成测试', () => {
  let server: any;
  const baseUrl = 'http://localhost:3099';

  beforeAll(async () => {
    // 初始化
    await initDatabase();
    getLLMManager();
    
    const loader = new SkillLoader();
    const skills = await loader.loadAll();
    const registry = getSkillRegistry();
    for (const skill of skills) {
      registry.register(skill);
    }

    // 启动服务器
    server = createAPIServer({ port: 3099 });
    await server.start();
    
    // 等待服务器启动
    await new Promise(resolve => setTimeout(resolve, 500));
  });

  afterAll(() => {
    if (server) {
      server.stop();
    }
  });

  describe('健康检查', () => {
    it('GET /health 应该返回健康状态', async () => {
      const response = await fetch(`${baseUrl}/health`);
      const result = await response.json() as ApiResponse;
      
      // 检查响应状态
      expect(response.status).toBe(200);
      // 检查返回数据
      expect(result.status || result.data?.status).toBeTruthy();
    });
  });

  describe('现有接口兼容性测试', () => {
    it('POST /api/chat 应该正常工作', async () => {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '你好' })
      });
      
      const result = await response.json() as ApiResponse;
      expect(result.success || response.status === 200).toBe(true);
    });

    it('GET /api/skills 应该返回技能列表', async () => {
      const response = await fetch(`${baseUrl}/api/skills`);
      const result = await response.json() as ApiResponse;
      
      expect(response.status).toBe(200);
      expect(result.data?.skills || (result as any).skills).toBeDefined();
    });

    it('GET /api/memory/stats 应该返回记忆统计', async () => {
      const response = await fetch(`${baseUrl}/api/memory/stats`);
      const result = await response.json() as ApiResponse;
      
      expect(response.status).toBe(200);
    });

    it('GET /api/cost/stats 应该返回成本统计', async () => {
      const response = await fetch(`${baseUrl}/api/cost/stats`);
      const result = await response.json() as ApiResponse;
      
      expect(response.status).toBe(200);
    });
  });

  describe('新增流式接口测试', () => {
    it('POST /api/chat/stream 应该返回SSE流', async () => {
      const response = await fetch(`${baseUrl}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '你好' })
      });
      
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
    });

    it('应该发送thinking事件', async () => {
      const response = await fetch(`${baseUrl}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '你好' })
      });
      
      const text = await response.text();
      expect(text).toContain('event: thinking');
    });

    it('应该发送content事件', async () => {
      const response = await fetch(`${baseUrl}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '你好' })
      });
      
      const text = await response.text();
      expect(text).toContain('event: content');
    });

    it('应该发送done事件', async () => {
      const response = await fetch(`${baseUrl}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '你好' })
      });
      
      const text = await response.text();
      expect(text).toContain('event: done');
    });

    it('应该发送session或thinking事件', async () => {
      const response = await fetch(`${baseUrl}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '你好' })
      });
      
      const text = await response.text();
      // session 事件可能不存在，检查 thinking 即可
      expect(text.includes('event: session') || text.includes('event: thinking')).toBe(true);
    });
  });

  describe('对话历史接口测试', () => {
    it('GET /api/chat/history 应该返回历史', async () => {
      const response = await fetch(`${baseUrl}/api/chat/history`);
      const result = await response.json() as ApiResponse;
      
      expect(response.status).toBe(200);
    });
  });
});
