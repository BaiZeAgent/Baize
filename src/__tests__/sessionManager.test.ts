/**
 * 会话管理器测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SessionManager, getSessionManager, resetSessionManager } from '../core/brain/sessionManager';

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    resetSessionManager();
    manager = getSessionManager();
  });

  describe('getOrCreateSession', () => {
    it('应该创建新会话', () => {
      const session = manager.getOrCreateSession('test-1');
      
      expect(session.id).toBe('test-1');
      expect(session.history).toEqual([]);
      expect(session.entities.size).toBe(0);
    });

    it('应该返回已存在的会话', () => {
      const session1 = manager.getOrCreateSession('test-2');
      session1.entities.set('location', '北京');
      
      const session2 = manager.getOrCreateSession('test-2');
      
      expect(session2.entities.get('location')).toBe('北京');
    });
  });

  describe('addMessage', () => {
    it('应该添加消息到历史', () => {
      manager.getOrCreateSession('test-3');
      manager.addMessage('test-3', 'user', '你好');
      manager.addMessage('test-3', 'assistant', '你好！');
      
      const history = manager.getHistory('test-3');
      expect(history.length).toBe(2);
      expect(history[0].content).toBe('你好');
    });

    it('应该限制历史长度', () => {
      manager.getOrCreateSession('test-4');
      
      // 添加30条消息
      for (let i = 0; i < 30; i++) {
        manager.addMessage('test-4', 'user', `消息${i}`);
      }
      
      const history = manager.getHistory('test-4');
      expect(history.length).toBeLessThanOrEqual(20);
    });
  });

  describe('实体提取', () => {
    it('应该提取城市', () => {
      manager.getOrCreateSession('test-5');
      manager.addMessage('test-5', 'user', '北京今天天气怎么样');
      
      expect(manager.getEntity('test-5', 'location')).toBe('北京');
    });

    it('应该提取时间', () => {
      manager.getOrCreateSession('test-6');
      manager.addMessage('test-6', 'user', '明天天气怎么样');
      
      expect(manager.getEntity('test-6', 'date')).toBe('明天');
    });

    it('应该提取多个实体', () => {
      manager.getOrCreateSession('test-7');
      manager.addMessage('test-7', 'user', '上海后天天气');
      
      expect(manager.getEntity('test-7', 'location')).toBe('上海');
      expect(manager.getEntity('test-7', 'date')).toBe('后天');
    });
  });

  describe('buildContextSummary', () => {
    it('应该构建上下文摘要', () => {
      manager.getOrCreateSession('test-8');
      manager.recordEntity('test-8', 'location', '北京');
      manager.recordSkill('test-8', 'weather');
      
      const summary = manager.buildContextSummary('test-8');
      
      expect(summary).toContain('location=北京');
      expect(summary).toContain('weather');
    });

    it('空会话应该返回空字符串', () => {
      manager.getOrCreateSession('test-9');
      
      const summary = manager.buildContextSummary('test-9');
      
      expect(summary).toBe('');
    });
  });

  describe('isFollowUp', () => {
    it('应该识别追问', () => {
      manager.getOrCreateSession('test-10');
      manager.addMessage('test-10', 'user', '北京天气');
      
      expect(manager.isFollowUp('test-10', '那明天呢')).toBe(true);
      expect(manager.isFollowUp('test-10', '会下雨吗')).toBe(true);
    });

    it('新问题不应该识别为追问', () => {
      manager.getOrCreateSession('test-11');
      manager.addMessage('test-11', 'user', '北京天气');
      
      expect(manager.isFollowUp('test-11', '上海天气')).toBe(false);
    });
  });

  describe('clearSession', () => {
    it('应该清除会话', () => {
      manager.getOrCreateSession('test-12');
      manager.addMessage('test-12', 'user', '测试');
      
      manager.clearSession('test-12');
      
      expect(manager.getHistory('test-12').length).toBe(0);
    });
  });
});
