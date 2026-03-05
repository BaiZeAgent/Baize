/**
 * 失败诊断器 - L1 失败诊断层
 */

import { getLogger } from '../../observability/logger';
import { getLLMManager } from '../../llm';
import { getSkillRegistry } from '../../skills/registry';
import { getToolRegistry } from '../../tools';
import {
  FailureDiagnosis,
  FailureCauseType,
  CorrectedPlan,
  ExecutionOutput,
  ExecutionPlan,
  GoalDefinition,
  ValidationResult,
} from './types';

const logger = getLogger('executor:diagnoser');

export class FailureDiagnoser {
  private llm = getLLMManager();
  private skillRegistry = getSkillRegistry();
  private toolRegistry = getToolRegistry();
  
  async diagnose(
    plan: ExecutionPlan,
    output: ExecutionOutput,
    goal: GoalDefinition,
    validation: ValidationResult[],
    previousAttempts: number = 0
  ): Promise<FailureDiagnosis> {
    logger.info(`[失败诊断器] 开始诊断: ${plan.tool}`);
    
    const toolInfo = this.getToolInfo(plan.tool);
    const prompt = this.buildDiagnosisPrompt(plan, output, goal, validation, toolInfo, previousAttempts);
    
    try {
      const response = await this.llm.chat([
        { role: 'system', content: this.getSystemPrompt() },
        { role: 'user', content: prompt },
      ], { temperature: 0.2 });
      
      const diagnosis = this.parseDiagnosis(response.content);
      
      logger.info(`[失败诊断器] 诊断结果: ${diagnosis.causeType} - ${diagnosis.rootCause}`);
      
      return diagnosis;
    } catch (error) {
      logger.error(`[失败诊断器] 诊断失败: ${error}`);
      
      return {
        rootCause: output.error || '执行失败，原因未知',
        causeType: 'unknown',
        analysis: '无法进行详细诊断',
        suggestedFix: '尝试使用其他工具或方法',
        canFix: false,
        confidence: 0.3,
      };
    }
  }
  
  quickDiagnose(output: ExecutionOutput): FailureDiagnosis | null {
    const error = output.error || '';
    
    if (error.includes('参数') || error.includes('parameter') || error.includes('argument')) {
      return {
        rootCause: '参数错误',
        causeType: 'wrong_params',
        analysis: error,
        suggestedFix: '检查并修正参数',
        canFix: true,
        confidence: 0.8,
      };
    }
    
    if (error.includes('不存在') || error.includes('not found') || error.includes('unknown')) {
      return {
        rootCause: '工具不存在或不可用',
        causeType: 'wrong_tool',
        analysis: error,
        suggestedFix: '选择其他可用工具',
        canFix: true,
        confidence: 0.9,
      };
    }
    
    if (error.includes('权限') || error.includes('permission') || error.includes('denied')) {
      return {
        rootCause: '权限不足',
        causeType: 'environment_issue',
        analysis: error,
        suggestedFix: '检查权限设置或联系管理员',
        canFix: false,
        confidence: 0.9,
      };
    }
    
    if (error.includes('超时') || error.includes('timeout')) {
      return {
        rootCause: '执行超时',
        causeType: 'timeout',
        analysis: error,
        suggestedFix: '增加超时时间或简化任务',
        canFix: true,
        confidence: 0.8,
      };
    }
    
    if (error.includes('文件不存在') || error.includes('file not found')) {
      return {
        rootCause: '目标文件不存在',
        causeType: 'wrong_params',
        analysis: error,
        suggestedFix: '检查文件路径是否正确，或先创建文件',
        canFix: true,
        confidence: 0.9,
      };
    }
    
    return null;
  }
  
  async generateCorrection(
    diagnosis: FailureDiagnosis,
    originalPlan: ExecutionPlan,
    goal: GoalDefinition
  ): Promise<CorrectedPlan | null> {
    if (!diagnosis.canFix) {
      return null;
    }
    
    switch (diagnosis.causeType) {
      case 'wrong_params':
        return this.correctParams(originalPlan, diagnosis, goal);
      case 'wrong_tool':
        return this.selectAlternativeTool(originalPlan, diagnosis, goal);
      case 'tool_limitation':
        return this.findAlternativeApproach(originalPlan, diagnosis, goal);
      default:
        return null;
    }
  }
  
  private getSystemPrompt(): string {
    return `你是一个执行失败诊断专家。分析执行失败的原因，并提供修正建议。

失败类型分类：
1. wrong_tool - 工具选择错误
2. wrong_params - 参数错误
3. tool_limitation - 工具能力限制
4. intent_misunderstood - 意图理解错误
5. environment_issue - 环境问题
6. timeout - 超时
7. unknown - 未知原因

诊断原则：
1. 首先检查错误信息，找到直接原因
2. 然后分析根本原因，不要只看表面
3. 判断是否可以修正
4. 如果可以修正，提供具体的修正建议
5. 评估诊断的置信度`;
  }
  
  private buildDiagnosisPrompt(
    plan: ExecutionPlan,
    output: ExecutionOutput,
    goal: GoalDefinition,
    validation: ValidationResult[],
    toolInfo: string,
    previousAttempts: number
  ): string {
    const validationSummary = validation.map(v => 
      `- ${v.criterionDescription}: ${v.passed ? '通过' : '失败'} (${v.evidence})`
    ).join('\n');
    
    return `请诊断以下执行失败的原因。

用户目标: ${goal.userInput}
理解的意图: ${goal.intent}
深层目标: ${goal.deepGoal}

执行计划:
- 工具: ${plan.tool}
- 参数: ${JSON.stringify(plan.params)}
- 推理: ${plan.reasoning}

工具信息: ${toolInfo}

执行结果:
- 状态: ${output.success ? '成功' : '失败'}
- 输出: ${output.output || '(无)'}
- 错误: ${output.error || '(无)'}
- 耗时: ${output.duration}ms

验证结果:
${validationSummary || '(无验证)'}

之前的尝试次数: ${previousAttempts}

请输出JSON格式的诊断结果：
{
  "rootCause": "根本原因的描述",
  "causeType": "wrong_tool|wrong_params|tool_limitation|intent_misunderstood|environment_issue|timeout|unknown",
  "analysis": "详细的分析过程",
  "suggestedFix": "具体的修正建议",
  "canFix": true或false,
  "confidence": 0.0到1.0
}`;
  }
  
  private getToolInfo(toolName: string): string {
    const skill = this.skillRegistry.get(toolName);
    if (skill) {
      return `技能: ${skill.name}, 描述: ${skill.description}`;
    }
    
    const tool = this.toolRegistry.get(toolName);
    if (tool) {
      return `工具: ${tool.name}, 描述: ${tool.description}`;
    }
    
    return `工具 "${toolName}" 信息未知`;
  }
  
  private parseDiagnosis(content: string): FailureDiagnosis {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        return {
          rootCause: parsed.rootCause || '未知原因',
          causeType: this.validateCauseType(parsed.causeType),
          analysis: parsed.analysis || '',
          suggestedFix: parsed.suggestedFix || '',
          canFix: parsed.canFix ?? false,
          confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
        };
      }
    } catch (error) {
      logger.warn(`[失败诊断器] 解析诊断结果失败: ${error}`);
    }
    
    return {
      rootCause: '无法解析诊断结果',
      causeType: 'unknown',
      analysis: content,
      suggestedFix: '请手动检查问题',
      canFix: false,
      confidence: 0.3,
    };
  }
  
  private validateCauseType(type: string): FailureCauseType {
    const validTypes: FailureCauseType[] = [
      'wrong_tool', 'wrong_params', 'tool_limitation',
      'intent_misunderstood', 'environment_issue', 'timeout', 'unknown'
    ];
    
    if (validTypes.includes(type as FailureCauseType)) {
      return type as FailureCauseType;
    }
    
    return 'unknown';
  }
  
  private async correctParams(
    originalPlan: ExecutionPlan,
    diagnosis: FailureDiagnosis,
    goal: GoalDefinition
  ): Promise<CorrectedPlan | null> {
    const prompt = `根据诊断结果，修正执行参数。

原始参数: ${JSON.stringify(originalPlan.params)}
诊断: ${diagnosis.rootCause}
建议: ${diagnosis.suggestedFix}
目标: ${goal.userInput}

请输出修正后的参数（JSON格式）：
{
  "params": { ...修正后的参数... },
  "reason": "修正原因"
}`;

    try {
      const response = await this.llm.chat([
        { role: 'user', content: prompt }
      ], { temperature: 0.2 });
      
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          tool: originalPlan.tool,
          params: parsed.params,
          reason: parsed.reason,
        };
      }
    } catch (error) {
      logger.error(`[失败诊断器] 参数修正失败: ${error}`);
    }
    
    return null;
  }
  
  private async selectAlternativeTool(
    originalPlan: ExecutionPlan,
    diagnosis: FailureDiagnosis,
    goal: GoalDefinition
  ): Promise<CorrectedPlan | null> {
    const skills = this.skillRegistry.getAll();
    const tools = this.toolRegistry.getAll();
    
    const availableTools = [
      ...skills.map(s => ({ name: s.name, description: s.description })),
      ...tools.map(t => ({ name: t.name, description: t.description })),
    ];
    
    const prompt = `原工具不可用，请选择替代工具。

目标: ${goal.userInput}
原工具: ${originalPlan.tool}
诊断: ${diagnosis.rootCause}

可用工具:
${availableTools.map(t => `- ${t.name}: ${t.description}`).join('\n')}

请输出替代方案（JSON格式）：
{
  "tool": "工具名称",
  "params": { ...参数... },
  "reason": "选择原因"
}`;

    try {
      const response = await this.llm.chat([
        { role: 'user', content: prompt }
      ], { temperature: 0.2 });
      
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        const exists = availableTools.some(t => t.name === parsed.tool);
        if (exists) {
          return {
            tool: parsed.tool,
            params: parsed.params || {},
            reason: parsed.reason,
          };
        }
      }
    } catch (error) {
      logger.error(`[失败诊断器] 工具选择失败: ${error}`);
    }
    
    return null;
  }
  
  private async findAlternativeApproach(
    originalPlan: ExecutionPlan,
    diagnosis: FailureDiagnosis,
    goal: GoalDefinition
  ): Promise<CorrectedPlan | null> {
    const skills = this.skillRegistry.getAll();
    const tools = this.toolRegistry.getAll();
    
    const availableTools = [
      ...skills.map(s => ({ name: s.name, description: s.description })),
      ...tools.map(t => ({ name: t.name, description: t.description })),
    ];
    
    const prompt = `当前工具能力有限，请找到替代方法。

目标: ${goal.userInput}
原工具: ${originalPlan.tool}
限制: ${diagnosis.rootCause}

可用工具:
${availableTools.map(t => `- ${t.name}: ${t.description}`).join('\n')}

请输出替代方案（JSON格式）：
{
  "tool": "工具名称",
  "params": { ...参数... },
  "reason": "为什么这个替代方案可行"
}`;

    try {
      const response = await this.llm.chat([
        { role: 'user', content: prompt }
      ], { temperature: 0.3 });
      
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          tool: parsed.tool,
          params: parsed.params || {},
          reason: parsed.reason,
        };
      }
    } catch (error) {
      logger.error(`[失败诊断器] 替代方案生成失败: ${error}`);
    }
    
    return null;
  }
}

let failureDiagnoserInstance: FailureDiagnoser | null = null;

export function getFailureDiagnoser(): FailureDiagnoser {
  if (!failureDiagnoserInstance) {
    failureDiagnoserInstance = new FailureDiagnoser();
  }
  return failureDiagnoserInstance;
}

export function resetFailureDiagnoser(): void {
  failureDiagnoserInstance = null;
}
