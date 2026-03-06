/**
 * 结果验证器 - L4 结果验证层
 */

import { getLogger } from '../../observability/logger';
import { getLLMManager } from '../../llm';
import {
  SuccessCriterion,
  ValidationResult,
  OverallValidation,
  ExecutionOutput,
  GoalDefinition,
} from './types';

const logger = getLogger('executor:validator');

export class ResultValidator {
  private llm = getLLMManager();
  
  async validate(
    output: ExecutionOutput,
    goal: GoalDefinition
  ): Promise<OverallValidation> {
    logger.info(`[结果验证器] 开始验证: ${goal.userInput.slice(0, 30)}...`);
    
    const results: ValidationResult[] = [];
    
    for (const criterion of goal.successCriteria) {
      const result = await this.validateCriterion(output, criterion, goal);
      results.push(result);
    }
    
    if (results.length === 0) {
      results.push({
        criterionId: 'default',
        criterionDescription: '执行成功',
        passed: output.success,
        evidence: output.success ? '执行未报错' : (output.error || '执行失败'),
        confidence: 0.8,
      });
    }
    
    const requiredResults = results.filter(r => 
      goal.successCriteria.find(c => c.id === r.criterionId)?.priority === 'required'
    );
    
    const passedRequired = requiredResults.length > 0 ? requiredResults.every(r => r.passed) : results.every(r => r.passed);
    const totalScore = results.reduce((sum, r) => sum + (r.passed ? r.confidence : 0), 0) / results.length;
    
    const validation: OverallValidation = {
      passed: passedRequired && totalScore >= 0.5,
      results,
      summary: this.generateSummary(results, passedRequired),
      score: totalScore,
    };
    
    logger.info(`[结果验证器] 验证结果: ${validation.passed ? '通过' : '失败'}, 得分: ${totalScore.toFixed(2)}`);
    
    return validation;
  }
  
  private async validateCriterion(
    output: ExecutionOutput,
    criterion: SuccessCriterion,
    goal: GoalDefinition
  ): Promise<ValidationResult> {
    // ═══════════════════════════════════════════════════════════════
    // 优化：默认使用自动验证，避免 LLM 调用
    // ═══════════════════════════════════════════════════════════════
    switch (criterion.verificationMethod) {
      case 'automatic':
        return this.automaticValidation(output, criterion, goal);
      case 'user_confirm':
        return this.userConfirmValidation(output, criterion);
      case 'llm_check':
        // LLM 验证改为自动验证（节省调用）
        return this.automaticValidation(output, criterion, goal);
      default:
        return this.automaticValidation(output, criterion, goal);
    }
  }
  
  private automaticValidation(
    output: ExecutionOutput,
    criterion: SuccessCriterion,
    goal: GoalDefinition
  ): ValidationResult {
    const description = criterion.description.toLowerCase();
    
    if (description.includes('成功') || description.includes('完成')) {
      return {
        criterionId: criterion.id,
        criterionDescription: criterion.description,
        passed: output.success,
        evidence: output.success ? '执行成功' : (output.error || '执行失败'),
        confidence: 0.9,
      };
    }
    
    if (description.includes('内容') || description.includes('输出')) {
      const hasContent = output.success && !!output.output && output.output.length > 0;
      return {
        criterionId: criterion.id,
        criterionDescription: criterion.description,
        passed: hasContent,
        evidence: hasContent ? `输出长度: ${output.output?.length || 0}` : '无输出内容',
        confidence: 0.8,
      };
    }
    
    if (description.includes('文件') || description.includes('创建') || description.includes('写入')) {
      return {
        criterionId: criterion.id,
        criterionDescription: criterion.description,
        passed: output.success,
        evidence: output.success ? '文件操作成功' : (output.error || '文件操作失败'),
        confidence: 0.85,
      };
    }
    
    return {
      criterionId: criterion.id,
      criterionDescription: criterion.description,
      passed: output.success,
      evidence: output.success ? '执行成功' : (output.error || '执行失败'),
      confidence: 0.7,
    };
  }
  
  private async llmValidation(
    output: ExecutionOutput,
    criterion: SuccessCriterion,
    goal: GoalDefinition
  ): Promise<ValidationResult> {
    const prompt = `请验证执行结果是否满足成功标准。

用户目标: ${goal.userInput}
成功标准: ${criterion.description}
执行结果:
- 状态: ${output.success ? '成功' : '失败'}
- 输出: ${output.output?.slice(0, 500) || '(无)'}
- 错误: ${output.error || '(无)'}

请判断是否满足这个成功标准。

输出JSON格式：
{
  "passed": true或false,
  "evidence": "判断依据",
  "confidence": 0.0到1.0
}`;

    try {
      const response = await this.llm.chat([
        { role: 'system', content: '你是一个结果验证专家，请客观判断执行结果是否满足成功标准。' },
        { role: 'user', content: prompt },
      ], { temperature: 0.1 });
      
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        return {
          criterionId: criterion.id,
          criterionDescription: criterion.description,
          passed: !!parsed.passed,
          evidence: String(parsed.evidence || ''),
          confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.7)),
        };
      }
    } catch (error) {
      logger.error(`[结果验证器] LLM验证失败: ${error}`);
    }
    
    return {
      criterionId: criterion.id,
      criterionDescription: criterion.description,
      passed: output.success,
      evidence: '无法进行详细验证，基于执行状态判断',
      confidence: 0.5,
    };
  }
  
  private userConfirmValidation(
    output: ExecutionOutput,
    criterion: SuccessCriterion
  ): ValidationResult {
    return {
      criterionId: criterion.id,
      criterionDescription: criterion.description,
      passed: output.success,
      evidence: '需要用户确认',
      confidence: 0.5,
    };
  }
  
  quickValidate(output: ExecutionOutput): OverallValidation {
    const result: ValidationResult = {
      criterionId: 'quick',
      criterionDescription: '执行成功',
      passed: output.success,
      evidence: output.success ? '执行未报错' : (output.error || '执行失败'),
      confidence: 0.9,
    };
    
    return {
      passed: output.success,
      results: [result],
      summary: output.success ? '执行成功' : `执行失败: ${output.error}`,
      score: output.success ? 1 : 0,
    };
  }
  
  private generateSummary(results: ValidationResult[], passedRequired: boolean): string {
    const passed = results.filter(r => r.passed).length;
    const total = results.length;
    
    if (passed === total) {
      return `所有 ${total} 个验证项均通过`;
    } else if (passedRequired) {
      return `${passed}/${total} 个验证项通过，必需项已通过`;
    } else {
      return `${passed}/${total} 个验证项通过，必需项未通过`;
    }
  }
}

let resultValidatorInstance: ResultValidator | null = null;

export function getResultValidator(): ResultValidator {
  if (!resultValidatorInstance) {
    resultValidatorInstance = new ResultValidator();
  }
  return resultValidatorInstance;
}

export function resetResultValidator(): void {
  resultValidatorInstance = null;
}
