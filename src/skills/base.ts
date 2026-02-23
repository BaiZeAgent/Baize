/**
 * 技能基类
 */
import { SkillResult, SkillInfo, RiskLevel, ValidationResult, SkillContext } from '../types';
import { getLogger } from '../observability/logger';

const logger = getLogger('skill:base');

/**
 * 技能基类
 */
export abstract class Skill {
  abstract get name(): string;
  abstract get description(): string;

  get capabilities(): string[] {
    return [];
  }

  get riskLevel(): RiskLevel {
    return RiskLevel.LOW;
  }

  get inputSchema(): Record<string, unknown> {
    return {};
  }

  get outputSchema(): Record<string, unknown> {
    return {};
  }

  abstract run(
    params: Record<string, unknown>,
    context: SkillContext
  ): Promise<SkillResult>;

  async validateParams(params: Record<string, unknown>): Promise<ValidationResult> {
    const schema = this.inputSchema as {
      required?: string[];
      properties?: Record<string, unknown>;
    };

    if (!schema || !schema.required) {
      return { valid: true };
    }

    for (const field of schema.required) {
      if (!(field in params)) {
        return { valid: false, error: `缺少必填参数: ${field}` };
      }
    }

    return { valid: true };
  }

  async beforeRun(
    params: Record<string, unknown>,
    context: SkillContext
  ): Promise<boolean> {
    logger.info(`技能 ${this.name} 开始执行`, { params });
    return true;
  }

  async afterRun(result: SkillResult, context: SkillContext): Promise<SkillResult> {
    if (result.success) {
      logger.info(`技能 ${this.name} 执行成功`);
    } else {
      logger.warn(`技能 ${this.name} 执行失败: ${result.error}`);
    }
    return result;
  }

  toInfo(): SkillInfo {
    return {
      name: this.name,
      description: this.description,
      capabilities: this.capabilities,
      riskLevel: this.riskLevel,
      inputSchema: this.inputSchema,
      outputSchema: this.outputSchema,
    };
  }
}

// 导出SkillContext类型
export type { SkillContext };
