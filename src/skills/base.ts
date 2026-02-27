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

  get whenToUse(): string | undefined {
    return undefined;
  }

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
      properties?: Record<string, {
        type?: string;
        enum?: string[];
        description?: string;
      }>;
    };

    if (!schema) {
      return { valid: true };
    }

    // 检查必填参数
    if (schema.required) {
      for (const field of schema.required) {
        if (!(field in params) || params[field] === undefined) {
          return { valid: false, error: `缺少必填参数: ${field}` };
        }
      }
    }

    // 检查枚举值
    if (schema.properties) {
      const invalidParams: string[] = [];
      const validOptions: string[] = [];

      for (const [field, prop] of Object.entries(schema.properties)) {
        if (prop.enum && params[field] !== undefined) {
          const value = String(params[field]);
          if (!prop.enum.includes(value)) {
            invalidParams.push(field);
            validOptions.push(`${field} 可选值: ${prop.enum.join(', ')}`);
          }
        }
      }

      if (invalidParams.length > 0) {
        const errorMsg = `参数值错误: ${invalidParams.join(', ')}。${validOptions.join('; ')}`;
        return { valid: false, error: errorMsg };
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
      whenToUse: this.whenToUse,
      capabilities: this.capabilities,
      riskLevel: this.riskLevel,
      inputSchema: this.inputSchema,
      outputSchema: this.outputSchema,
    };
  }
}

// 导出SkillContext类型
export type { SkillContext };
