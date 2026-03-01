/**
 * 元认知引擎 - 自我反思和学习
 * 
 * 核心能力：
 * 1. 自我评估：评估自己的能力和限制
 * 2. 反思机制：分析成功和失败的原因
 * 3. 学习优化：从经验中学习和改进
 * 4. 不确定性处理：知道自己不知道什么
 * 5. 能力边界：识别超出能力范围的请求
 */

import { LLMMessage } from '../../types';
import { getLLMManager } from '../../llm';
import { getLogger } from '../../observability/logger';
import { getEnhancedMemory } from '../../memory/v3';
import { getSkillRegistry } from '../../skills/registry';
import { getToolRegistry } from '../../tools';

const logger = getLogger('core:metacognition');

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

/** 能力评估 */
export interface CapabilityAssessment {
  /** 能力名称 */
  capability: string;
  /** 能力等级 0-10 */
  level: number;
  /** 置信度 */
  confidence: number;
  /** 限制条件 */
  limitations: string[];
  /** 改进建议 */
  improvements: string[];
}

/** 自我评估结果 */
export interface SelfAssessment {
  /** 整体能力评估 */
  capabilities: CapabilityAssessment[];
  /** 当前状态 */
  state: {
    /** 精力水平 0-1 */
    energy: number;
    /** 负载水平 0-1 */
    load: number;
    /** 信心水平 0-1 */
    confidence: number;
  };
  /** 已知限制 */
  knownLimitations: string[];
  /** 不确定领域 */
  uncertainAreas: string[];
  /** 建议行为 */
  recommendations: string[];
}

/** 反思结果 */
export interface ReflectionResult {
  /** 场景描述 */
  scenario: string;
  /** 执行过程 */
  process: string[];
  /** 成功因素 */
  successFactors: string[];
  /** 失败原因 */
  failureReasons: string[];
  /** 学到的教训 */
  lessons: string[];
  /** 改进行动 */
  improvements: string[];
  /** 置信度变化 */
  confidenceDelta: number;
}

/** 决策置信度 */
export interface DecisionConfidence {
  /** 置信度 0-1 */
  confidence: number;
  /** 理由 */
  reasoning: string;
  /** 不确定因素 */
  uncertainties: string[];
  /** 需要的信息 */
  missingInfo: string[];
  /** 替代方案 */
  alternatives: string[];
}

/** 能力边界检查结果 */
export interface BoundaryCheck {
  /** 是否在能力范围内 */
  withinCapability: boolean;
  /** 缺失的能力 */
  missingCapabilities: string[];
  /** 建议的替代方案 */
  suggestedAlternatives: string[];
  /** 需要的额外资源 */
  requiredResources: string[];
  /** 风险评估 */
  risks: string[];
}

// ═══════════════════════════════════════════════════════════════
// 元认知引擎
// ═══════════════════════════════════════════════════════════════

export class MetacognitionEngine {
  private llm = getLLMManager();
  private memory = getEnhancedMemory();
  private skillRegistry = getSkillRegistry();
  private toolRegistry = getToolRegistry();
  
  /** 能力缓存 */
  private capabilityCache: Map<string, CapabilityAssessment> = new Map();
  
  /** 反思历史 */
  private reflectionHistory: ReflectionResult[] = [];
  
  /** 最大历史记录 */
  private readonly MAX_HISTORY = 50;
  
  /**
   * 自我评估
   */
  async assessSelf(): Promise<SelfAssessment> {
    logger.info('[元认知] 开始自我评估');
    
    // 获取可用能力
    const skills = this.skillRegistry.getAll();
    const tools = this.toolRegistry.getAll();
    
    // 评估各项能力
    const capabilities = await this.assessCapabilities(skills, tools);
    
    // 获取记忆统计
    const memoryStats = this.memory.getStats();
    
    // 获取学习记录
    const recentLearning = this.memory.getRelevantLearning('');
    
    // 分析状态
    const state = this.analyzeState(memoryStats, recentLearning);
    
    // 识别限制和不确定领域
    const { knownLimitations, uncertainAreas } = await this.identifyLimitations(capabilities);
    
    // 生成建议
    const recommendations = this.generateRecommendations(capabilities, state, knownLimitations);
    
    return {
      capabilities,
      state,
      knownLimitations,
      uncertainAreas,
      recommendations,
    };
  }
  
  /**
   * 反思执行过程
   */
  async reflect(
    scenario: string,
    process: string[],
    outcome: 'success' | 'failure' | 'partial',
    context?: string
  ): Promise<ReflectionResult> {
    logger.info(`[元认知] 反思: ${scenario}`);
    
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个自我反思系统。分析执行过程，提取经验教训。

## 场景
${scenario}

## 执行过程
${process.map((p, i) => `${i + 1}. ${p}`).join('\n')}

## 结果
${outcome === 'success' ? '成功' : outcome === 'failure' ? '失败' : '部分成功'}

## 上下文
${context || '(无)'}

## 输出格式（JSON）

{
  "successFactors": ["成功因素1", "成功因素2"],
  "failureReasons": ["失败原因1", "失败原因2"],
  "lessons": ["教训1", "教训2"],
  "improvements": ["改进1", "改进2"],
  "confidenceDelta": -0.1 到 0.1
}

## 分析原则

1. 客观分析，不推卸责任
2. 找到根本原因，不只是表面问题
3. 提出可操作的改进
4. 记录有价值的经验`
      },
    ];
    
    try {
      const response = await this.llm.chat(messages, { temperature: 0.3 });
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        const result: ReflectionResult = {
          scenario,
          process,
          successFactors: parsed.successFactors || [],
          failureReasons: parsed.failureReasons || [],
          lessons: parsed.lessons || [],
          improvements: parsed.improvements || [],
          confidenceDelta: parsed.confidenceDelta || 0,
        };
        
        // 记录反思
        this.reflectionHistory.push(result);
        if (this.reflectionHistory.length > this.MAX_HISTORY) {
          this.reflectionHistory = this.reflectionHistory.slice(-this.MAX_HISTORY);
        }
        
        // 记录学习
        for (const lesson of result.lessons) {
          this.memory.recordLearning(scenario, process.join(' -> '), outcome, lesson);
        }
        
        return result;
      }
    } catch (error) {
      logger.error(`[元认知] 反思错误: ${error}`);
    }
    
    return {
      scenario,
      process,
      successFactors: [],
      failureReasons: [],
      lessons: [],
      improvements: [],
      confidenceDelta: 0,
    };
  }
  
  /**
   * 评估决策置信度
   */
  async assessDecisionConfidence(
    decision: string,
    context: string
  ): Promise<DecisionConfidence> {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个决策评估系统。评估决策的置信度和风险。

## 决策
${decision}

## 上下文
${context}

## 输出格式（JSON）

{
  "confidence": 0.0-1.0,
  "reasoning": "决策理由分析",
  "uncertainties": ["不确定因素1", "不确定因素2"],
  "missingInfo": ["缺失信息1", "缺失信息2"],
  "alternatives": ["替代方案1", "替代方案2"]
}

## 评估原则

1. 诚实评估，不过度自信
2. 识别所有不确定因素
3. 考虑替代方案
4. 明确缺失的信息`
      },
    ];
    
    try {
      const response = await this.llm.chat(messages, { temperature: 0.2 });
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      logger.error(`[元认知] 置信度评估错误: ${error}`);
    }
    
    return {
      confidence: 0.5,
      reasoning: '无法评估',
      uncertainties: ['评估失败'],
      missingInfo: [],
      alternatives: [],
    };
  }
  
  /**
   * 检查能力边界
   */
  async checkBoundary(request: string): Promise<BoundaryCheck> {
    logger.info(`[元认知] 检查能力边界: ${request.slice(0, 50)}...`);
    
    // 获取可用能力
    const skills = this.skillRegistry.getAll().map(s => s.name);
    const tools = this.toolRegistry.getAll().map(t => t.name);
    const allCapabilities = [...skills, ...tools];
    
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个能力边界检测系统。判断请求是否在系统能力范围内。

## 可用能力
${allCapabilities.join(', ')}

## 用户请求
${request}

## 输出格式（JSON）

{
  "withinCapability": true/false,
  "missingCapabilities": ["缺失能力1", "缺失能力2"],
  "suggestedAlternatives": ["替代方案1", "替代方案2"],
  "requiredResources": ["需要资源1", "需要资源2"],
  "risks": ["风险1", "风险2"]
}

## 判断原则

1. 严格评估，不夸大能力
2. 识别所有缺失的能力
3. 提供可行的替代方案
4. 明确需要的额外资源`
      },
    ];
    
    try {
      const response = await this.llm.chat(messages, { temperature: 0.1 });
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      logger.error(`[元认知] 边界检查错误: ${error}`);
    }
    
    return {
      withinCapability: false,
      missingCapabilities: ['无法评估'],
      suggestedAlternatives: [],
      requiredResources: [],
      risks: ['评估失败'],
    };
  }
  
  /**
   * 学习和改进
   */
  async learnAndImprove(): Promise<{
    insights: string[];
    actions: string[];
    priority: 'high' | 'medium' | 'low';
  }> {
    logger.info('[元认知] 学习和改进');
    
    // 获取最近的反思和学习
    const recentReflections = this.reflectionHistory.slice(-10);
    const recentLearning = this.memory.getRelevantLearning('');
    
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个学习优化系统。根据历史经验，生成改进建议。

## 最近反思
${recentReflections.map(r => `
场景: ${r.scenario}
教训: ${r.lessons.join(', ')}
改进: ${r.improvements.join(', ')}
`).join('\n')}

## 学习记录
${recentLearning.map(l => `
${l.scenario}: ${l.result} - ${l.lesson}
`).join('\n')}

## 输出格式（JSON）

{
  "insights": ["洞察1", "洞察2"],
  "actions": ["行动1", "行动2"],
  "priority": "high" | "medium" | "low"
}

## 分析原则

1. 找出重复出现的问题
2. 识别系统性改进机会
3. 提出具体可执行的行动
4. 按优先级排序`
      },
    ];
    
    try {
      const response = await this.llm.chat(messages, { temperature: 0.4 });
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      logger.error(`[元认知] 学习改进错误: ${error}`);
    }
    
    return {
      insights: [],
      actions: [],
      priority: 'low',
    };
  }
  
  /**
   * 生成自我报告
   */
  async generateSelfReport(): Promise<string> {
    const assessment = await this.assessSelf();
    const learning = await this.learnAndImprove();
    
    const report = `
# 白泽自我评估报告

## 能力概览

${assessment.capabilities.map(c => 
  `- **${c.capability}**: 等级 ${c.level}/10 (置信度: ${(c.confidence * 100).toFixed(0)}%)`
).join('\n')}

## 当前状态

- 精力水平: ${(assessment.state.energy * 100).toFixed(0)}%
- 负载水平: ${(assessment.state.load * 100).toFixed(0)}%
- 信心水平: ${(assessment.state.confidence * 100).toFixed(0)}%

## 已知限制

${assessment.knownLimitations.map(l => `- ${l}`).join('\n') || '(无)'}

## 不确定领域

${assessment.uncertainAreas.map(a => `- ${a}`).join('\n') || '(无)'}

## 改进建议

${assessment.recommendations.map(r => `- ${r}`).join('\n') || '(无)'}

## 学习洞察

${learning.insights.map(i => `- ${i}`).join('\n') || '(无)'}

## 行动计划

${learning.actions.map(a => `- [${learning.priority === 'high' ? '高' : learning.priority === 'medium' ? '中' : '低'}] ${a}`).join('\n') || '(无)'}

---
*报告生成时间: ${new Date().toLocaleString()}*
`;
    
    return report;
  }
  
  // ═══════════════════════════════════════════════════════════════
  // 私有方法
  // ═══════════════════════════════════════════════════════════════
  
  /**
   * 评估各项能力
   */
  private async assessCapabilities(skills: any[], tools: any[]): Promise<CapabilityAssessment[]> {
    const capabilities: CapabilityAssessment[] = [];
    
    // 评估技能能力
    for (const skill of skills.slice(0, 10)) { // 限制评估数量
      const cached = this.capabilityCache.get(skill.name);
      if (cached) {
        capabilities.push(cached);
        continue;
      }
      
      const assessment: CapabilityAssessment = {
        capability: skill.name,
        level: 7, // 默认等级
        confidence: 0.6,
        limitations: [],
        improvements: [],
      };
      
      capabilities.push(assessment);
      this.capabilityCache.set(skill.name, assessment);
    }
    
    // 评估基础能力
    const baseCapabilities = [
      { name: '对话理解', level: 8 },
      { name: '任务规划', level: 6 },
      { name: '工具使用', level: 7 },
      { name: '错误恢复', level: 5 },
      { name: '学习能力', level: 6 },
    ];
    
    for (const cap of baseCapabilities) {
      capabilities.push({
        capability: cap.name,
        level: cap.level,
        confidence: 0.7,
        limitations: [],
        improvements: [],
      });
    }
    
    return capabilities;
  }
  
  /**
   * 分析当前状态
   */
  private analyzeState(memoryStats: any, learningRecords: any[]): SelfAssessment['state'] {
    // 基于记忆和学习记录分析状态
    const successRate = learningRecords.length > 0
      ? learningRecords.filter(l => l.result === 'success').length / learningRecords.length
      : 0.5;
    
    return {
      energy: 0.8, // 假设精力充足
      load: Math.min(1, memoryStats.totalMemories / 1000), // 基于记忆数量估算负载
      confidence: 0.5 + successRate * 0.3, // 基于成功率估算信心
    };
  }
  
  /**
   * 识别限制
   */
  private async identifyLimitations(
    capabilities: CapabilityAssessment[]
  ): Promise<{ knownLimitations: string[]; uncertainAreas: string[] }> {
    const knownLimitations: string[] = [];
    const uncertainAreas: string[] = [];
    
    for (const cap of capabilities) {
      if (cap.level < 5) {
        knownLimitations.push(`${cap.capability} 能力较弱`);
      }
      if (cap.confidence < 0.5) {
        uncertainAreas.push(cap.capability);
      }
      knownLimitations.push(...cap.limitations);
    }
    
    // 添加系统级限制
    knownLimitations.push(
      '无法访问互联网（除非通过工具）',
      '无法执行物理操作',
      '记忆容量有限',
      '无法处理多模态输入（图像、音频）'
    );
    
    return { knownLimitations, uncertainAreas };
  }
  
  /**
   * 生成建议
   */
  private generateRecommendations(
    capabilities: CapabilityAssessment[],
    state: SelfAssessment['state'],
    limitations: string[]
  ): string[] {
    const recommendations: string[] = [];
    
    // 基于能力评估
    const weakCapabilities = capabilities.filter(c => c.level < 6);
    for (const cap of weakCapabilities) {
      if (cap.improvements.length > 0) {
        recommendations.push(...cap.improvements);
      }
    }
    
    // 基于状态
    if (state.load > 0.7) {
      recommendations.push('考虑清理过期记忆以降低负载');
    }
    if (state.confidence < 0.5) {
      recommendations.push('需要更多成功经验来提升信心');
    }
    
    // 去重
    return [...new Set(recommendations)].slice(0, 5);
  }
  
  /**
   * 获取反思历史
   */
  getReflectionHistory(): ReflectionResult[] {
    return [...this.reflectionHistory];
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
