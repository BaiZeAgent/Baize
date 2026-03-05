/**
 * 目标定义器 - L3 目标定义层
 * 
 * 负责：
 * 1. 理解用户意图
 * 2. 定义成功标准
 * 3. 评估任务复杂度
 */

import { getLogger } from '../../observability/logger';
import { getLLMManager } from '../../llm';
import {
  GoalDefinition,
  SuccessCriterion,
  TaskAnalysis,
  TaskFeatures,
  ComplexityLevel,
  ExperienceMatch,
} from './types';
import { LLMMessage } from '../../types';
import { getExperienceStore } from './ExperienceStore';

const logger = getLogger('executor:goal');

// ═══════════════════════════════════════════════════════════════
// 目标定义器
// ═══════════════════════════════════════════════════════════════

export class GoalDefiner {
  private llm = getLLMManager();
  private experienceStore = getExperienceStore();
  
  /**
   * 定义目标
   */
  async defineGoal(userInput: string): Promise<GoalDefinition> {
    logger.info(`[目标定义器] 分析: ${userInput.slice(0, 50)}...`);
    
    // 分析意图
    const intentAnalysis = await this.analyzeIntent(userInput);
    
    // 定义成功标准
    const successCriteria = await this.defineSuccessCriteria(userInput, intentAnalysis);
    
    // 评估风险
    const risks = await this.assessRisks(userInput, intentAnalysis);
    
    return {
      userInput,
      intent: intentAnalysis.intent,
      deepGoal: intentAnalysis.deepGoal,
      successCriteria,
      expectedOutput: intentAnalysis.expectedOutput,
      risks,
      confidence: intentAnalysis.confidence,
    };
  }
  
  /**
   * 分析任务
   */
  async analyzeTask(userInput: string): Promise<TaskAnalysis> {
    // 查询相似经验
    const similarExperiences = await this.experienceStore.findSimilar(userInput, {
      limit: 5,
      minSimilarity: 0.6,
    });
    
    // 提取任务特征
    const features = await this.extractFeatures(userInput);
    
    // 评估复杂度
    const complexity = this.assessComplexity(features);
    
    // 定义目标
    const goal = await this.defineGoal(userInput);
    
    // 识别任务类型
    const taskType = this.identifyTaskType(userInput, features);
    
    // 评估风险等级
    const riskLevel = this.assessRiskLevel(features, similarExperiences);
    
    return {
      userInput,
      features,
      complexity,
      taskType,
      successCriteria: goal.successCriteria,
      similarExperiences,
      riskLevel,
    };
  }
  
  /**
   * 定义成功标准
   */
  async defineSuccessCriteria(
    userInput: string,
    intentAnalysis: { intent: string; deepGoal: string }
  ): Promise<SuccessCriterion[]> {
    const prompt = `请为以下任务定义成功标准。

用户请求：${userInput}
理解的意图：${intentAnalysis.intent}
深层目标：${intentAnalysis.deepGoal}

成功标准应该是：
1. 可验证的（能判断是否达成）
2. 具体的（不是模糊的描述）
3. 完整的（覆盖所有关键要求）

输出JSON数组格式：
[
  {
    "id": "criterion_1",
    "description": "标准描述",
    "priority": "required" | "preferred" | "optional",
    "verificationMethod": "automatic" | "llm_check" | "user_confirm"
  }
]

例如：
- 用户请求"读取文件内容" → 成功标准：["成功获取文件内容", "内容完整无截断"]
- 用户请求"创建文件" → 成功标准：["文件被创建", "内容正确写入", "文件可读取"]
- 用户请求"点击搜索按钮" → 成功标准：["按钮被点击", "搜索框出现或页面跳转"]`;

    try {
      const response = await this.llm.chat([
        { role: 'system', content: '你是一个任务分析专家，擅长定义清晰的成功标准。' },
        { role: 'user', content: prompt },
      ], { temperature: 0.2 });
      
      const jsonMatch = response.content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        
        return parsed.map((c: any, i: number) => ({
          id: c.id || `criterion_${i + 1}`,
          description: c.description,
          priority: c.priority || 'required',
          verificationMethod: c.verificationMethod || 'automatic',
        }));
      }
    } catch (error) {
      logger.error(`[目标定义器] 定义成功标准失败: ${error}`);
    }
    
    // 返回默认标准
    return [{
      id: 'criterion_1',
      description: '任务成功完成',
      priority: 'required',
      verificationMethod: 'automatic',
    }];
  }
  
  // ═══════════════════════════════════════════════════════════════
  // 私有方法
  // ═══════════════════════════════════════════════════════════════
  
  private async analyzeIntent(userInput: string): Promise<{
    intent: string;
    deepGoal: string;
    expectedOutput: string;
    confidence: number;
  }> {
    const prompt = `分析用户请求的意图。

用户请求：${userInput}

请分析：
1. 表面意图：用户字面表达的需求
2. 深层目标：用户真正想要达到的目标
3. 预期输出：用户期望看到什么样的结果

输出JSON格式：
{
  "intent": "表面意图",
  "deepGoal": "深层目标",
  "expectedOutput": "预期输出描述",
  "confidence": 0.0-1.0
}`;

    try {
      const response = await this.llm.chat([
        { role: 'system', content: '你是一个意图分析专家。' },
        { role: 'user', content: prompt },
      ], { temperature: 0.2 });
      
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      logger.error(`[目标定义器] 意图分析失败: ${error}`);
    }
    
    return {
      intent: userInput,
      deepGoal: userInput,
      expectedOutput: '任务完成',
      confidence: 0.5,
    };
  }
  
  private async extractFeatures(userInput: string): Promise<TaskFeatures> {
    const lowerInput = userInput.toLowerCase();
    
    // 基于关键词的简单特征提取
    const features: TaskFeatures = {
      requiresMultipleSteps: this.checkMultipleSteps(lowerInput),
      involvesExternalSystem: this.checkExternalSystem(lowerInput),
      requiresObservation: this.checkObservation(lowerInput),
      hasTimeDependency: this.checkTimeDependency(lowerInput),
      hasConditionalBranches: this.checkConditionalBranches(lowerInput),
      requiresPrecision: this.checkPrecision(lowerInput),
      involvesBrowser: this.checkBrowser(lowerInput),
      involvesFileSystem: this.checkFileSystem(lowerInput),
      involvesNetwork: this.checkNetwork(lowerInput),
    };
    
    return features;
  }
  
  private checkMultipleSteps(input: string): boolean {
    const indicators = ['然后', '之后', '接着', '再', '并且', '同时', 'and then', 'after', 'next'];
    return indicators.some(i => input.includes(i));
  }
  
  private checkExternalSystem(input: string): boolean {
    const indicators = ['浏览器', '网页', '网站', 'api', '数据库', '网络', 'browser', 'website', 'api', 'database'];
    return indicators.some(i => input.includes(i));
  }
  
  private checkObservation(input: string): boolean {
    const indicators = ['查看', '观察', '检查', '确认', '等待', 'check', 'observe', 'wait', 'verify'];
    return indicators.some(i => input.includes(i));
  }
  
  private checkTimeDependency(input: string): boolean {
    const indicators = ['等待', '定时', '每隔', 'wait', 'schedule', 'interval'];
    return indicators.some(i => input.includes(i));
  }
  
  private checkConditionalBranches(input: string): boolean {
    const indicators = ['如果', '否则', '当', '条件', 'if', 'else', 'when', 'condition'];
    return indicators.some(i => input.includes(i));
  }
  
  private checkPrecision(input: string): boolean {
    const indicators = ['精确', '准确', '精确地', '准确到', 'exact', 'precise', 'accurate'];
    return indicators.some(i => input.includes(i));
  }
  
  private checkBrowser(input: string): boolean {
    const indicators = ['浏览器', '网页', '点击', '输入', '滚动', 'browser', 'click', 'type', 'scroll', 'page'];
    return indicators.some(i => input.includes(i));
  }
  
  private checkFileSystem(input: string): boolean {
    const indicators = ['文件', '目录', '读取', '写入', '创建', '删除', 'file', 'directory', 'read', 'write', 'create', 'delete'];
    return indicators.some(i => input.includes(i));
  }
  
  private checkNetwork(input: string): boolean {
    const indicators = ['网络', 'http', '请求', '下载', '上传', 'network', 'request', 'download', 'upload'];
    return indicators.some(i => input.includes(i));
  }
  
  private assessComplexity(features: TaskFeatures): ComplexityLevel {
    let score = 0;
    
    if (features.requiresMultipleSteps) score += 2;
    if (features.involvesExternalSystem) score += 2;
    if (features.requiresObservation) score += 3;
    if (features.hasTimeDependency) score += 1;
    if (features.hasConditionalBranches) score += 2;
    if (features.requiresPrecision) score += 1;
    if (features.involvesBrowser) score += 2;
    
    if (score >= 8) return 'very_complex';
    if (score >= 5) return 'complex';
    if (score >= 3) return 'moderate';
    return 'simple';
  }
  
  private identifyTaskType(userInput: string, features: TaskFeatures): string {
    if (features.involvesBrowser) return 'browser_automation';
    if (features.involvesFileSystem) return 'file_operation';
    if (features.involvesNetwork) return 'network_operation';
    
    const lowerInput = userInput.toLowerCase();
    
    if (lowerInput.includes('搜索') || lowerInput.includes('查找')) return 'search';
    if (lowerInput.includes('计算') || lowerInput.includes('算')) return 'calculation';
    if (lowerInput.includes('分析') || lowerInput.includes('统计')) return 'analysis';
    if (lowerInput.includes('创建') || lowerInput.includes('生成')) return 'creation';
    if (lowerInput.includes('修改') || lowerInput.includes('更新')) return 'modification';
    if (lowerInput.includes('删除') || lowerInput.includes('移除')) return 'deletion';
    
    return 'general';
  }
  
  private assessRiskLevel(
    features: TaskFeatures,
    similarExperiences: ExperienceMatch[]
  ): 'low' | 'medium' | 'high' {
    // 有成功经验，风险低
    const hasSuccess = similarExperiences.some(
      e => e.experience.result === 'success' && e.similarity > 0.8
    );
    if (hasSuccess) return 'low';
    
    // 涉及删除或修改，风险高
    if (features.involvesFileSystem) return 'medium';
    
    // 涉及浏览器，风险中等
    if (features.involvesBrowser) return 'medium';
    
    // 复杂任务，风险中等
    if (features.requiresMultipleSteps || features.hasConditionalBranches) return 'medium';
    
    return 'low';
  }
  
  private async assessRisks(
    userInput: string,
    intentAnalysis: { intent: string; deepGoal: string }
  ): Promise<string[]> {
    const prompt = `评估以下任务的风险。

用户请求：${userInput}
意图：${intentAnalysis.intent}

请列出可能的风险（如数据丢失、权限问题、不可逆操作等）。

输出JSON数组格式：
["风险1", "风险2", ...]

如果没有明显风险，输出空数组 []`;

    try {
      const response = await this.llm.chat([
        { role: 'user', content: prompt }
      ], { temperature: 0.2 });
      
      const jsonMatch = response.content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      logger.error(`[目标定义器] 风险评估失败: ${error}`);
    }
    
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════
// 全局实例
// ═══════════════════════════════════════════════════════════════

let goalDefinerInstance: GoalDefiner | null = null;

export function getGoalDefiner(): GoalDefiner {
  if (!goalDefinerInstance) {
    goalDefinerInstance = new GoalDefiner();
  }
  return goalDefinerInstance;
}

export function resetGoalDefiner(): void {
  goalDefinerInstance = null;
}
