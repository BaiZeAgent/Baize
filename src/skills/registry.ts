/**
 * 技能注册表
 */
import { SkillInfo } from '../types';
import { Skill } from './base';
import { getLogger } from '../observability/logger';

const logger = getLogger('skill:registry');

/**
 * 技能注册表
 */
export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();
  private capabilityIndex: Map<string, Set<string>> = new Map();

  /**
   * 注册技能
   */
  register(skill: Skill): void {
    if (this.skills.has(skill.name)) {
      logger.warn(`技能 ${skill.name} 已存在，将被覆盖`);
    }

    this.skills.set(skill.name, skill);

    // 建立能力索引
    for (const cap of skill.capabilities) {
      if (!this.capabilityIndex.has(cap)) {
        this.capabilityIndex.set(cap, new Set());
      }
      this.capabilityIndex.get(cap)!.add(skill.name);
    }

    logger.info(`已注册技能: ${skill.name}`, {
      capabilities: skill.capabilities,
      riskLevel: skill.riskLevel,
    });
  }

  /**
   * 注销技能
   */
  unregister(name: string): boolean {
    const skill = this.skills.get(name);
    if (!skill) {
      return false;
    }

    for (const cap of skill.capabilities) {
      this.capabilityIndex.get(cap)?.delete(name);
    }

    this.skills.delete(name);
    logger.info(`已注销技能: ${name}`);
    return true;
  }

  /**
   * 获取技能
   */
  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * 检查技能是否存在
   */
  has(name: string): boolean {
    return this.skills.has(name);
  }

  /**
   * 根据能力查找技能
   */
  findByCapability(capability: string): Skill[] {
    const names = this.capabilityIndex.get(capability);
    if (!names) {
      return [];
    }
    return Array.from(names)
      .map(name => this.skills.get(name))
      .filter((s): s is Skill => s !== undefined);
  }

  /**
   * 获取所有技能
   */
  getAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * 获取所有技能信息
   */
  getAllInfo(): SkillInfo[] {
    return Array.from(this.skills.values()).map(s => s.toInfo());
  }

  /**
   * 获取技能数量
   */
  get size(): number {
    return this.skills.size;
  }

  /**
   * 获取所有能力标签
   */
  getAllCapabilities(): string[] {
    return Array.from(this.capabilityIndex.keys());
  }
}

// 全局实例
let registryInstance: SkillRegistry | null = null;

/**
 * 获取技能注册表
 */
export function getSkillRegistry(): SkillRegistry {
  if (!registryInstance) {
    registryInstance = new SkillRegistry();
  }
  return registryInstance;
}
