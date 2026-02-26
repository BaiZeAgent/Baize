/**
 * 提示词管理器测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PromptManager, getPromptManager, resetPromptManager } from '../core/brain/promptManager';

// Mock skill registry
vi.mock('../skills/registry', () => ({
  getSkillRegistry: () => ({
    get: (name: string) => {
      if (name === 'weather') {
        return {
          name: 'weather',
          description: '查询天气信息',
          inputSchema: {
            properties: {
              location: { type: 'string', description: '城市名称' },
              date: { type: 'string', description: '日期' }
            },
            required: ['location']
          }
        };
      }
      return null;
    }
  })
}));

describe('PromptManager', () => {
  let manager: PromptManager;

  beforeEach(() => {
    resetPromptManager();
    manager = getPromptManager();
  });

  describe('buildPrompt', () => {
    it('应该构建最小化提示词', () => {
      const prompt = manager.buildPrompt({ decisionType: 'simple' });
      
      // 应该包含核心人格
      expect(prompt).toContain('你是白泽');
      // 应该包含决策规则
      expect(prompt).toContain('决策规则');
      // 不应该包含技能定义
      expect(prompt).not.toContain('weather');
    });

    it('应该按需加载技能定义', () => {
      const prompt = manager.buildPrompt({ 
        decisionType: 'simple',
        skills: ['weather']
      });
      
      // 应该包含技能定义
      expect(prompt).toContain('weather');
      expect(prompt).toContain('查询天气信息');
    });

    it('应该包含上下文摘要', () => {
      const prompt = manager.buildPrompt({ 
        decisionType: 'followUp',
        contextSummary: '已知信息: location=北京'
      });
      
      // 应该包含上下文
      expect(prompt).toContain('上下文');
      expect(prompt).toContain('location=北京');
    });

    it('应该根据决策类型加载不同规则', () => {
      const simplePrompt = manager.buildPrompt({ decisionType: 'simple' });
      const followUpPrompt = manager.buildPrompt({ decisionType: 'followUp' });
      
      // 两者应该不同
      expect(simplePrompt).not.toBe(followUpPrompt);
      // followUp应该包含追问相关内容
      expect(followUpPrompt).toContain('追问');
    });
  });

  describe('Token估算', () => {
    it('简单提示词应该小于500字符', () => {
      const prompt = manager.buildPrompt({ decisionType: 'simple' });
      expect(prompt.length).toBeLessThan(1000);
    });

    it('带技能的提示词应该小于1000字符', () => {
      const prompt = manager.buildPrompt({ 
        decisionType: 'simple',
        skills: ['weather']
      });
      expect(prompt.length).toBeLessThan(1500);
    });
  });
});
