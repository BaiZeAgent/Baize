/**
 * 内置技能注册
 * 
 * 注册 Baize 内置的高级技能：
 * - ProcessTool: 进程管理
 * - BrowserSkill: 浏览器自动化
 */

import { getSkillRegistry } from './registry';
import { ProcessTool } from '../executor/process-tool';
import { BrowserSkill } from './browser-skill';
import { getLogger } from '../observability/logger';

const logger = getLogger('skill:builtins');

/**
 * 注册内置技能
 */
export function registerBuiltinSkills(): void {
  const registry = getSkillRegistry();
  
  // 注册 ProcessTool
  try {
    const processTool = new ProcessTool();
    registry.register(processTool);
    logger.info('已注册内置技能: process');
  } catch (error) {
    logger.error('注册 ProcessTool 失败', { error });
  }
  
  // 注册 BrowserSkill
  try {
    const browserSkill = new BrowserSkill();
    registry.register(browserSkill);
    logger.info('已注册内置技能: browser');
  } catch (error) {
    logger.error('注册 BrowserSkill 失败', { error });
  }
  
  logger.info(`内置技能注册完成，共 ${registry.size} 个技能`);
}

/**
 * 重置内置技能（测试用）
 */
export function resetBuiltinSkills(): void {
  const { resetProcessTool } = require('../executor/process-tool');
  resetProcessTool();
  
  const { resetBrowserSkill } = require('./browser-skill');
  resetBrowserSkill();
}
