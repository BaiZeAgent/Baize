/**
 * 元认知层 - Metacognition Layer
 * 
 * 核心能力：
 * 1. 能力边界检测 - 知道自己能做什么、不能做什么
 * 2. 任务可行性评估 - 评估任务是否能完成
 * 3. 自我反思 - 分析自己的表现，持续改进
 * 4. 主动求助 - 知道何时需要用户帮助
 */

import { getSkillRegistry } from '../../skills/registry';
import { getToolRegistry } from '../../tools';
import { getLLMManager } from '../../llm';
import { getLogger } from '../../observability/logger';
import { getMemory } from '../../memory';
import { LLMMessage } from '../../types';

const logger = getLogger('core:metacognition');

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

/** 能力评估结果 */
export interface CapabilityAssessment {
  canComplete: boolean;
  confidence: number;
  missingCapabilities: string[];
  suggestedSkills: string[];
  riskFactors: string[];
  alternativeApproaches: string[];
  needUserHelp: boolean;
  helpQuestions: string[];
}

/** 任务复杂度分析 */
export interface ComplexityAnalysis {
  score: number;           // 1-10
  subtaskCount: number;    // 子任务数量
  dependencies: number;    // 依赖数量
  uncertainty: number;     // 不确定性程度
  timeEstimate: number;    // 预估时间(秒)
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  reasoning: string;
}

/** 自我反思结果 */
export interface SelfReflection {
  success: boolean;
  analysis: string;
  lessons: string[];
  improvements: string[];
  patterns: string[];
  confidence: number;
}

/** 能力边界 */
export interface CapabilityBoundary {
  knownCapabilities: string[];      // 已知能力
  uncertainCapabilities: string[];  // 不确定能力
  unknownCapabilities: string[];    // 未知能力
  confidence: number;
}

// ═══════════════════════════════════════════════════════════════
// 元认知引擎
// ═══════════════════════════════════════════════════════════════

export class MetacognitionEngine {
  private skillRegistry = getSkillRegistry();
  private toolRegistry = getToolRegistry();
  private llm = getLLMManager();
  private memory = getMemory();
  
  // 能力缓存
  private capabilityCache: Map<string, CapabilityBoundary> = new Map();
  private lastCacheUpdate: number = 0;
  private cacheTTL: number = 60000; // 1分钟缓存

  /**
   * 评估任务可行性
   * 核心方法：判断"我能否完成这个任务"
   */
  async assessCapability(
    userInput: string,
    context?: { history?: Array<{ role: string; content: string }> }
  ): Promise<CapabilityAssessment> {
    logger.info(`[能力评估] 开始评估: ${userInput.slice(0, 50)}...`);

    try {
      // 1. 获取当前能力边界
      const boundary = await this.getCapabilityBoundary();

      // 2. 分析任务需求
      const requirements = await this.analyzeRequirements(userInput, context);

      // 3. 匹配能力
      const matching = this.matchCapabilities(requirements, boundary);

      // 4. 评估风险
      const risks = await this.assessRisks(userInput, matching);

      // 5. 生成建议
      const suggestions = await this.generateSuggestions(requirements, matching);

      // 6. 判断是否需要用户帮助
      const needHelp = matching.missing.length > 0 || matching.confidence < 0.5;

      const result: CapabilityAssessment = {
        canComplete: matching.missing.length === 0 && matching.confidence >= 0.5,
        confidence: matching.confidence,
        missingCapabilities: matching.missing,
        suggestedSkills: suggestions.skills,
        riskFactors: risks,
        alternativeApproaches: suggestions.approaches,
        needUserHelp: needHelp,
        helpQuestions: needHelp ? await this.generateHelpQuestions(userInput, matching) : [],
      };

      logger.info(`[能力评估] 结果: canComplete=${result.canComplete}, confidence=${result.confidence.toFixed(2)}`);

      return result;
    } catch (error) {
      logger.error(`[能力评估] 错误: ${error}`);
      return {
        canComplete: true, // 默认认为可以尝试
        confidence: 0.5,
        missingCapabilities: [],
        suggestedSkills: [],
        riskFactors: [],
        alternativeApproaches: [],
        needUserHelp: false,
        helpQuestions: [],
      };
    }
  }

  /**
   * 分析任务复杂度
   */
  async analyzeComplexity(userInput: string): Promise<ComplexityAnalysis> {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个任务复杂度分析专家。分析给定任务的复杂度。

## 分析维度

1. **步骤数量**：需要多少个步骤才能完成
2. **依赖关系**：步骤之间是否有依赖
3. **不确定性**：是否有模糊或不明确的部分
4. **风险程度**：执行失败的可能后果
5. **时间估计**：预计需要多长时间

## 输出格式（JSON）

{
  "score": 1-10,
  "subtaskCount": 数字,
  "dependencies": 数字,
  "uncertainty": 1-10,
  "timeEstimate": 秒数,
  "riskLevel": "low|medium|high|critical",
  "reasoning": "分析理由"
}`
      },
      {
        role: 'user',
        content: `请分析以下任务的复杂度：\n\n${userInput}`
      }
    ];

    try {
      const response = await this.llm.chat(messages, { temperature: 0.2 });
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          score: parsed.score || 5,
          subtaskCount: parsed.subtaskCount || 1,
          dependencies: parsed.dependencies || 0,
          uncertainty: parsed.uncertainty || 5,
          timeEstimate: parsed.timeEstimate || 30,
          riskLevel: parsed.riskLevel || 'medium',
          reasoning: parsed.reasoning || '',
        };
      }
    } catch (error) {
      logger.error(`[复杂度分析] 错误: ${error}`);
    }

    // 默认值
    return {
      score: 5,
      subtaskCount: 1,
      dependencies: 0,
      uncertainty: 5,
      timeEstimate: 30,
      riskLevel: 'medium',
      reasoning: '无法分析，使用默认值',
    };
  }

  /**
   * 自我反思
   * 分析执行结果，提取经验教训
   */
  async reflect(
    userInput: string,
    executionResult: {
      success: boolean;
      steps: Array<{ action: string; result: string; success: boolean }>;
      errors: string[];
      duration: number;
    }
  ): Promise<SelfReflection> {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个自我反思专家。分析任务执行过程，提取经验教训。

## 分析维度

1. **成功因素**：哪些决策是正确的
2. **失败原因**：哪些地方出了问题
3. **改进建议**：下次如何做得更好
4. **模式识别**：是否有可复用的模式

## 输出格式（JSON）

{
  "success": true/false,
  "analysis": "整体分析",
  "lessons": ["教训1", "教训2"],
  "improvements": ["改进1", "改进2"],
  "patterns": ["模式1", "模式2"],
  "confidence": 0.0-1.0
}`
      },
      {
        role: 'user',
        content: `用户请求: ${userInput}

执行步骤:
${executionResult.steps.map((s, i) => `${i + 1}. ${s.action}: ${s.success ? '成功' : '失败'} - ${s.result.slice(0, 100)}`).join('\n')}

错误:
${executionResult.errors.join('\n') || '无'}

耗时: ${executionResult.duration}ms

请分析这次执行，提取经验教训。`
      }
    ];

    try {
      const response = await this.llm.chat(messages, { temperature: 0.3 });
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        // 存储经验到记忆系统
        for (const lesson of (parsed.lessons || [])) {
          this.memory.learnErrorRecovery(`lesson_${Date.now()}`, lesson);
        }
        for (const pattern of (parsed.patterns || [])) {
          this.memory.recordPattern(`pattern_${Date.now()}`, pattern);
        }

        return {
          success: parsed.success ?? executionResult.success,
          analysis: parsed.analysis || '',
          lessons: parsed.lessons || [],
          improvements: parsed.improvements || [],
          patterns: parsed.patterns || [],
          confidence: parsed.confidence || 0.5,
        };
      }
    } catch (error) {
      logger.error(`[自我反思] 错误: ${error}`);
    }

    return {
      success: executionResult.success,
      analysis: '反思失败',
      lessons: [],
      improvements: [],
      patterns: [],
      confidence: 0.5,
    };
  }

  /**
   * 获取能力边界（公开方法）
   */
  async getCapabilityBoundary(): Promise<CapabilityBoundary> {
    // 检查缓存
    if (Date.now() - this.lastCacheUpdate < this.cacheTTL && this.capabilityCache.has('main')) {
      return this.capabilityCache.get('main')!;
    }

    // 获取所有可用技能和工具
    const skills = this.skillRegistry.getAll();
    const tools = this.toolRegistry.getAll();

    const knownCapabilities: string[] = [];
    const uncertainCapabilities: string[] = [];

    // 分析技能能力
    for (const skill of skills) {
      if (skill.capabilities && skill.capabilities.length > 0) {
        knownCapabilities.push(...skill.capabilities);
      } else {
        uncertainCapabilities.push(skill.name);
      }
    }

    // 分析工具能力
    for (const tool of tools) {
      knownCapabilities.push(tool.name);
    }

    const boundary: CapabilityBoundary = {
      knownCapabilities: [...new Set(knownCapabilities)],
      uncertainCapabilities: [...new Set(uncertainCapabilities)],
      unknownCapabilities: [],
      confidence: knownCapabilities.length / (knownCapabilities.length + uncertainCapabilities.length + 1),
    };

    // 更新缓存
    this.capabilityCache.set('main', boundary);
    this.lastCacheUpdate = Date.now();

    return boundary;
  }

  /**
   * 分析任务需求
   */
  private async analyzeRequirements(
    userInput: string,
    context?: { history?: Array<{ role: string; content: string }> }
  ): Promise<string[]> {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个需求分析专家。分析用户请求需要哪些能力才能完成。

输出JSON数组格式：["能力1", "能力2", ...]

例如：
- "帮我查天气" → ["weather_query", "location_detection"]
- "写一个Python脚本" → ["code_generation", "file_write"]
- "分析这个数据" → ["data_analysis", "visualization"]
- "搜索信息并整理成表格" → ["web_search", "data_extraction", "table_formatting"]`
      },
      {
        role: 'user',
        content: userInput,
      }
    ];

    try {
      const response = await this.llm.chat(messages, { temperature: 0.2 });
      const jsonMatch = response.content.match(/\[[\s\S]*\]/);
      
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      logger.error(`[需求分析] 错误: ${error}`);
    }

    return ['unknown'];
  }

  /**
   * 匹配能力
   */
  private matchCapabilities(
    requirements: string[],
    boundary: CapabilityBoundary
  ): { matched: string[]; missing: string[]; confidence: number } {
    const matched: string[] = [];
    const missing: string[] = [];

    for (const req of requirements) {
      const isKnown = boundary.knownCapabilities.some(cap => 
        cap.toLowerCase().includes(req.toLowerCase()) ||
        req.toLowerCase().includes(cap.toLowerCase())
      );
      
      if (isKnown) {
        matched.push(req);
      } else {
        missing.push(req);
      }
    }

    const confidence = requirements.length > 0 
      ? matched.length / requirements.length 
      : 0.5;

    return { matched, missing, confidence };
  }

  /**
   * 评估风险
   */
  private async assessRisks(
    userInput: string,
    matching: { matched: string[]; missing: string[]; confidence: number }
  ): Promise<string[]> {
    const risks: string[] = [];

    if (matching.missing.length > 0) {
      risks.push(`缺少能力: ${matching.missing.join(', ')}`);
    }

    if (matching.confidence < 0.5) {
      risks.push('能力匹配置信度过低');
    }

    // 检查敏感操作
    const sensitiveKeywords = ['删除', '格式化', '清空', '修改系统', 'root', 'rm -rf'];
    for (const keyword of sensitiveKeywords) {
      if (userInput.includes(keyword)) {
        risks.push(`包含敏感操作: ${keyword}`);
      }
    }

    return risks;
  }

  /**
   * 生成建议
   */
  private async generateSuggestions(
    requirements: string[],
    matching: { matched: string[]; missing: string[]; confidence: number }
  ): Promise<{ skills: string[]; approaches: string[] }> {
    const suggestions = {
      skills: [] as string[],
      approaches: [] as string[],
    };

    // 查找可能满足缺失能力的技能
    const skills = this.skillRegistry.getAll();
    for (const missing of matching.missing) {
      const matchingSkills = skills.filter(s => 
        s.capabilities?.some(cap => 
          cap.toLowerCase().includes(missing.toLowerCase())
        )
      );
      
      if (matchingSkills.length > 0) {
        suggestions.skills.push(...matchingSkills.map(s => s.name));
      }
    }

    // 生成替代方案建议
    if (matching.missing.length > 0) {
      suggestions.approaches.push('尝试分解任务为更小的步骤');
      suggestions.approaches.push('询问用户是否可以接受替代方案');
    }

    return suggestions;
  }

  /**
   * 生成帮助问题
   */
  private async generateHelpQuestions(
    userInput: string,
    matching: { matched: string[]; missing: string[]; confidence: number }
  ): Promise<string[]> {
    const questions: string[] = [];

    if (matching.missing.length > 0) {
      questions.push(`我目前缺少以下能力: ${matching.missing.join(', ')}。您是否可以提供更多信息或换一种方式描述？`);
    }

    if (matching.confidence < 0.5) {
      questions.push('我不太确定能否完成这个任务。您能详细说明一下您的期望吗？');
    }

    return questions;
  }

  /**
   * 更新能力边界（从外部调用）
   */
  updateCapabilityBoundary(newCapability: string, confidence: number): void {
    const boundary = this.capabilityCache.get('main');
    if (boundary) {
      if (confidence >= 0.8) {
        boundary.knownCapabilities.push(newCapability);
      } else {
        boundary.uncertainCapabilities.push(newCapability);
      }
    }
    this.lastCacheUpdate = 0; // 强制刷新
  }
}

// ═══════════════════════════════════════════════════════════════
// 全局实例
// ═══════════════════════════════════════════════════════════════

let metacognitionInstance: MetacognitionEngine | null = null;

export function getMetacognition(): MetacognitionEngine {
  if (!metacognitionInstance) {
    metacognitionInstance = new MetacognitionEngine();
  }
  return metacognitionInstance;
}

export function resetMetacognition(): void {
  metacognitionInstance = null;
}
