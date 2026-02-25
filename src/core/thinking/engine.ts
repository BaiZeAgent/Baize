/**
 * 思考引擎 - 双层决策机制
 * 
 * v3.1.0 更新：
 * - 集成智能路由器，实现双层决策
 * - 简单任务走快速路径（单次LLM调用）
 * - 复杂任务走六阶段思考
 * 
 * 阶段1: 理解 - 分析用户意图
 * 阶段2: 拆解 - 分解为原子任务
 * 阶段3: 规划 - 选择技能和执行顺序
 * 阶段4: 调度 - 并行/串行执行
 * 阶段5: 验收 - 检查执行结果
 * 阶段6: 反思 - 分析失败原因
 */

import { LLMMessage, Task, RiskLevel, ThoughtProcess, Understanding, Decomposition, Planning, Scheduling, Validation, Reflection, TaskResult, SkillSelection } from '../../types';
import { getLLMManager } from '../../llm';
import { getSkillRegistry } from '../../skills/registry';
import { getLogger } from '../../observability/logger';
import { getSmartRouter, RouteDecision, RouteContext } from '../router';
import { getContextManager } from '../context';
import { getRecoveryManager } from '../recovery';

const logger = getLogger('core:thinking');

/**
 * 思考结果（扩展）
 */
export interface ThinkingResult {
  /** 是否走快速路径 */
  fastPath: boolean;
  /** 直接回复（快速路径） */
  directResponse?: string;
  /** 工具调用（快速路径） */
  toolCall?: {
    name: string;
    params: Record<string, unknown>;
  };
  /** 完整思考过程（规划路径） */
  thoughtProcess?: ThoughtProcess;
  /** 耗时 */
  duration: number;
}

export class ThinkingEngine {
  private llm = getLLMManager();
  private skillRegistry = getSkillRegistry();
  private router = getSmartRouter();
  private contextManager = getContextManager();
  private recoveryManager = getRecoveryManager();

  /**
   * 主入口：双层决策
   * 
   * 1. 智能路由判断任务复杂度
   * 2. 简单任务走快速路径
   * 3. 复杂任务走六阶段思考
   */
  async think(
    userInput: string,
    context: Record<string, unknown> = {}
  ): Promise<ThinkingResult> {
    const startTime = Date.now();
    logger.info(`[think-start] input=${userInput.substring(0, 50)}...`);

    try {
      // 第一层：智能路由判断
      const routeContext: RouteContext = {
        userInput,
        sessionId: context.sessionId as string,
        historySummary: context.historySummary as string,
      };

      const decision = await this.router.route(routeContext);
      logger.info(`[route-decision] action=${decision.action}`);

      // 根据路由结果选择路径
      switch (decision.action) {
        case 'reply':
          // 快速路径：直接回复
          return this.fastReply(decision.content || '', startTime);

        case 'tool':
          // 快速路径：单工具调用
          return this.fastToolCall(
            decision.toolName || '',
            decision.toolParams || {},
            startTime
          );

        case 'plan':
          // 规划路径：六阶段思考
          return this.fullThinking(userInput, context, startTime, decision.reason);

        default:
          // 未知情况，走规划路径确保安全
          return this.fullThinking(userInput, context, startTime, '未知路由结果');
      }
    } catch (error) {
      logger.error(`[think-error] ${error}`);
      // 出错时返回友好提示
      return {
        fastPath: true,
        directResponse: '抱歉，处理您的请求时出现问题，请稍后再试。',
        duration: (Date.now() - startTime) / 1000,
      };
    }
  }

  /**
   * 快速路径：直接回复
   */
  private fastReply(content: string, startTime: number): ThinkingResult {
    logger.debug('[fast-path] reply');
    return {
      fastPath: true,
      directResponse: content,
      duration: (Date.now() - startTime) / 1000,
    };
  }

  /**
   * 快速路径：单工具调用
   */
  private fastToolCall(
    toolName: string,
    params: Record<string, unknown>,
    startTime: number
  ): ThinkingResult {
    logger.debug(`[fast-path] tool=${toolName}`);
    return {
      fastPath: true,
      toolCall: { name: toolName, params },
      duration: (Date.now() - startTime) / 1000,
    };
  }

  /**
   * 规划路径：完整六阶段思考
   */
  private async fullThinking(
    userInput: string,
    context: Record<string, unknown>,
    startTime: number,
    reason?: string
  ): Promise<ThinkingResult> {
    logger.info(`[full-thinking] reason=${reason || '需要规划'}`);

    const thoughtProcess = await this.process(userInput, context);

    return {
      fastPath: false,
      thoughtProcess,
      duration: (Date.now() - startTime) / 1000,
    };
  }

  /**
   * 完整思考过程（六阶段）
   */
  async process(
    userInput: string,
    context: Record<string, unknown> = {}
  ): Promise<ThoughtProcess> {
    const startTime = Date.now();
    logger.info(`开始处理用户输入: ${userInput.substring(0, 50)}...`);

    try {
      // 阶段1: 理解
      const understanding = await this.understand(userInput, context);
      logger.debug('阶段1-理解完成', { coreNeed: understanding.coreNeed, isSimpleChat: understanding.isSimpleChat });

      // 判断是否是简单对话
      if (understanding.isSimpleChat && understanding.directResponse) {
        logger.debug('简单对话，跳过任务拆解');
        const decomposition: Decomposition = {
          tasks: [],
          dependencies: {},
          parallelGroups: [],
        };
        const planning = await this.plan(understanding, decomposition, context);
        
        const duration = (Date.now() - startTime) / 1000;
        logger.info(`思考完成，耗时 ${duration.toFixed(2)}s`);
        
        return {
          understanding,
          decomposition,
          planning,
          createdAt: new Date(),
          duration,
          directResponse: understanding.directResponse,
        };
      }

      // 阶段2: 拆解 - 传递原始用户输入
      const decomposition = await this.decompose(understanding, userInput, context);
      logger.debug('阶段2-拆解完成', { taskCount: decomposition.tasks.length });

      // 阶段3: 规划
      const planning = await this.plan(understanding, decomposition, context);
      logger.debug('阶段3-规划完成', { needConfirm: planning.needConfirm });

      // 阶段4: 调度（如果有任务）
      let scheduling: Scheduling | undefined;
      if (decomposition.tasks.length > 0) {
        scheduling = this.schedule(decomposition);
        logger.debug('阶段4-调度完成', { executionId: scheduling.executionId });
      }

      const duration = (Date.now() - startTime) / 1000;
      logger.info(`思考完成，耗时 ${duration.toFixed(2)}s`);

      return {
        understanding,
        decomposition,
        planning,
        scheduling,
        createdAt: new Date(),
        duration,
      };
    } catch (error) {
      logger.error(`思考过程失败: ${error}`);
      throw error;
    }
  }

  /**
   * 阶段5: 验收 - 检查执行结果
   */
  async validate(
    thoughtProcess: ThoughtProcess,
    taskResults: TaskResult[]
  ): Promise<Validation> {
    logger.info('阶段5-验收开始');
    
    const issues: string[] = [];
    const suggestions: string[] = [];
    let overallSuccess = true;

    for (let i = 0; i < taskResults.length; i++) {
      const result = taskResults[i];
      const task = thoughtProcess.decomposition.tasks[i];

      if (!result.success) {
        overallSuccess = false;
        issues.push(`任务 "${task.description}" 执行失败: ${result.error}`);
      }
    }

    const validation: Validation = {
      passed: overallSuccess && issues.length === 0,
      issues,
      suggestions,
      needRetry: !overallSuccess && this.canRetry(thoughtProcess),
      retryStrategy: 'exponential_backoff',
    };

    logger.info(`阶段5-验收完成`, { passed: validation.passed, issueCount: issues.length });
    return validation;
  }

  /**
   * 阶段6: 反思 - 分析失败原因，提出改进方案
   */
  async reflect(
    thoughtProcess: ThoughtProcess,
    validation: Validation,
    taskResults: TaskResult[]
  ): Promise<Reflection> {
    logger.info('阶段6-反思开始');

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个问题分析专家。分析任务失败的原因，提出改进方案。

输出JSON格式：
{
  "successRate": 0.0-1.0,
  "failureAnalysis": "失败原因分析",
  "rootCauses": ["根本原因1", "根本原因2"],
  "improvements": ["改进建议1", "改进建议2"]
}`,
      },
      {
        role: 'user',
        content: `用户需求: ${thoughtProcess.understanding.coreNeed}
任务列表: ${thoughtProcess.decomposition.tasks.map(t => t.description).join(', ')}
失败问题: ${validation.issues.join('; ')}
执行结果: ${taskResults.map(r => r.success ? '成功' : r.error).join(', ')}`,
      },
    ];

    const response = await this.llm.chat(messages, { temperature: 0.3 });
    const result = this.parseJSON(response.content);

    return {
      successRate: (result.successRate as number) || 0,
      failureAnalysis: (result.failureAnalysis as string) || '',
      rootCauses: Array.isArray(result.rootCauses) ? result.rootCauses as string[] : [],
      improvements: Array.isArray(result.improvements) ? result.improvements as string[] : [],
      learnedPatterns: [],
      suggestedActions: [],
    };
  }

  // ==================== 阶段1: 理解 ====================

  private async understand(
    userInput: string,
    context: Record<string, unknown>
  ): Promise<Understanding> {
    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个意图理解专家。分析用户输入，判断意图类型。

输出JSON格式：
{
  "literalMeaning": "字面意思",
  "implicitIntent": "隐含意图",
  "context": {},
  "constraints": ["约束条件"],
  "coreNeed": "核心需求（一句话）",
  "isSimpleChat": true或false,
  "directResponse": "如果是简单对话，直接给出友好回复"
}

## 判断规则

isSimpleChat 为 true 的情况（直接回复，不拆解任务）：
- 问候语：你好、嗨、hello、早上好、下午好、晚上好
- 自我介绍询问：你是谁、你叫什么、介绍一下你自己
- 感谢/告别：谢谢、再见、拜拜
- 闲聊：今天心情不好、讲个笑话、无聊
- 简单问答：什么是AI、怎么理解xxx（不需要执行具体操作）

isSimpleChat 为 false 的情况（需要拆解任务）：
- 需要操作文件系统：创建文件、读取文件、删除文件
- 需要查询实时数据：现在几点（time技能）、天气怎么样
- 需要执行具体操作：帮我xxx、请xxx

## 重要
- 如果 isSimpleChat 为 true，必须提供 directResponse
- directResponse 应该是友好、自然的对话回复
- 不要在 directResponse 中说"我是AI"，要自然对话`,
      },
      {
        role: 'user',
        content: userInput,
      },
    ];

    const response = await this.llm.chat(messages, { temperature: 0.3 });
    const result = this.parseJSON(response.content);

    return {
      literalMeaning: (result.literalMeaning as string) || userInput,
      implicitIntent: (result.implicitIntent as string) || '',
      context: (result.context as Record<string, unknown>) || {},
      constraints: Array.isArray(result.constraints) ? result.constraints as string[] : [],
      coreNeed: (result.coreNeed as string) || userInput,
      isSimpleChat: (result.isSimpleChat as boolean) || false,
      directResponse: (result.directResponse as string) || '',
    };
  }

  // ==================== 阶段2: 拆解 ====================

  private async decompose(
    understanding: Understanding,
    originalInput: string,
    context: Record<string, unknown>
  ): Promise<Decomposition> {
    // 获取技能列表
    const skills = this.skillRegistry.getAll().filter(s => s.name !== 'chat');
    
    if (skills.length === 0) {
      logger.warn('没有可用技能，返回空任务');
      return {
        tasks: [],
        dependencies: {},
        parallelGroups: [],
      };
    }

    // 构建详细的技能描述
    const skillsDescription = this.buildSkillsDescription(skills);

    const messages: LLMMessage[] = [
      {
        role: 'system',
        content: `你是一个任务拆解专家。将用户需求拆解为原子任务。

## 核心原则

你正在使用工具来完成任务，就像人使用工具一样：
1. 每个工具都有特定的功能和参数
2. 只能使用工具定义中列出的参数，不能"发明"新参数
3. 如果工具只需要"城市名"，就不要添加"格式"、"样式"等参数
4. 根据用户需求选择最合适的工具

## 可用技能

${skillsDescription}

## 输出格式

输出JSON格式：
{
  "tasks": [
    {
      "id": "task_1",
      "description": "任务描述",
      "skillName": "技能名称",
      "params": {"参数名": "参数值"},
      "riskLevel": "low",
      "dependencies": []
    }
  ],
  "dependencies": {"task_1": []},
  "parallelGroups": [["task_1"]]
}

## 参数规则（非常重要）

1. params 中只能包含该技能"参数定义"中列出的参数
2. 如果技能的参数定义中没有某个参数名，绝对不要添加它
3. 必需参数必须提供，可选参数可以不提供
4. 不要根据技能描述"猜测"或"推断"额外参数

## 示例

假设有一个天气查询技能：
### weather
- 参数定义:
  - location (string, 必需): 城市名称

正确: { "skillName": "weather", "params": { "location": "北京" } }
错误: { "skillName": "weather", "params": { "location": "北京", "format": "xxx" } }
错误: { "skillName": "weather", "params": { "location": "北京", "unit": "celsius" } }
// format 和 unit 不在参数定义中，不能添加！

## 其他规则

1. 如果用户需求不需要任何技能，返回空任务列表
2. 必须使用用户提供的具体内容，不要使用模板或占位符
3. 根据技能的"能力"标签判断是否适合当前任务`,
      },
      {
        role: 'user',
        content: `用户原始输入: ${originalInput}

核心需求: ${understanding.coreNeed}
约束条件: ${understanding.constraints.join(', ') || '无'}

请根据用户需求选择合适的技能，并严格按照技能的参数定义填写参数。`,
      },
    ];

    const response = await this.llm.chat(messages, { temperature: 0.3 });
    const result = this.parseJSON(response.content);

    const tasks: Task[] = Array.isArray(result.tasks)
      ? (result.tasks as Record<string, unknown>[]).map((t) => ({
          id: t.id as string,
          description: t.description as string,
          type: t.type as string || (t.skillName as string) || 'unknown',
          skillName: t.skillName as string | undefined,
          params: (t.params as Record<string, unknown>) || {},
          riskLevel: this.parseRiskLevel(t.riskLevel as string),
          dependencies: Array.isArray(t.dependencies) 
            ? t.dependencies as string[] 
            : [],
        }))
      : [];

    return {
      tasks,
      dependencies: (result.dependencies as Record<string, string[]>) || {},
      parallelGroups: Array.isArray(result.parallelGroups)
        ? result.parallelGroups as string[][]
        : [tasks.map(t => t.id)],
    };
  }

  /**
   * 构建详细的技能描述
   */
  private buildSkillsDescription(skills: Array<{ name: string; description: string; capabilities: string[]; riskLevel: string; inputSchema?: Record<string, unknown> }>): string {
    return skills.map(skill => {
      const props = skill.inputSchema?.properties as Record<string, Record<string, unknown>> | undefined;
      const required = (skill.inputSchema?.required as string[]) || [];
      
      // 构建参数说明
      let paramsSection = '无参数';
      if (props && Object.keys(props).length > 0) {
        paramsSection = Object.entries(props)
          .map(([key, prop]) => {
            const isRequired = required.includes(key);
            const type = prop.type || 'unknown';
            const desc = prop.description || '';
            return `  - ${key} (${type}, ${isRequired ? '必需' : '可选'}): ${desc}`;
          })
          .join('\n');
      }

      return `### ${skill.name}
- 描述: ${skill.description}
- 能力标签: ${skill.capabilities.join(', ')}
- 风险等级: ${skill.riskLevel}
- 参数定义（只能使用以下参数）:
${paramsSection}`;
    }).join('\n\n');
  }

  // ==================== 阶段3: 规划 ====================

  private async plan(
    understanding: Understanding,
    decomposition: Decomposition,
    context: Record<string, unknown>
  ): Promise<Planning> {
    const skillSelections: SkillSelection[] = [];
    
    for (const task of decomposition.tasks) {
      if (task.skillName) {
        const skill = this.skillRegistry.get(task.skillName);
        if (skill) {
          skillSelections.push({
            skillName: skill.name,
            params: task.params,
            reason: 'LLM指定',
            alternatives: [],
          });
          continue;
        }
      }

      // 根据能力匹配技能
      const skills = this.skillRegistry.findByCapability(task.type);
      if (skills.length > 0) {
        skillSelections.push({
          skillName: skills[0].name,
          params: task.params,
          reason: '能力匹配',
          alternatives: skills.slice(1).map(s => s.name),
        });
      }
    }

    // 评估风险
    const risks: string[] = [];
    let needConfirm = false;

    for (const task of decomposition.tasks) {
      if (task.riskLevel === RiskLevel.HIGH || task.riskLevel === RiskLevel.CRITICAL) {
        risks.push(`任务 "${task.description}" 风险等级较高`);
        needConfirm = true;
      }
    }

    return {
      skillSelections,
      executionOrder: decomposition.tasks.map(t => t.id),
      estimatedTime: decomposition.tasks.length * 2,
      risks,
      needConfirm,
      confirmReason: needConfirm ? '高风险操作需要确认' : '',
    };
  }

  // ==================== 阶段4: 调度 ====================

  private schedule(decomposition: Decomposition): Scheduling {
    return {
      executionId: `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      parallelGroups: decomposition.parallelGroups,
      timeout: 300000,
      retryPolicy: {
        maxRetries: 3,
        delay: 1000,
        backoff: 'exponential',
      },
    };
  }

  // ==================== 辅助方法 ====================

  private parseJSON(text: string): Record<string, unknown> {
    try {
      // 尝试直接解析
      return JSON.parse(text);
    } catch {
      // 尝试提取JSON块
      const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) ||
                        text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[1] || jsonMatch[0]);
        } catch {
          // ignore
        }
      }
      return {};
    }
  }

  private parseRiskLevel(level: string | undefined): RiskLevel {
    switch (level?.toLowerCase()) {
      case 'critical':
        return RiskLevel.CRITICAL;
      case 'high':
        return RiskLevel.HIGH;
      case 'medium':
        return RiskLevel.MEDIUM;
      case 'low':
      default:
        return RiskLevel.LOW;
    }
  }

  private canRetry(thoughtProcess: ThoughtProcess): boolean {
    // 检查是否有可重试的任务
    return thoughtProcess.decomposition.tasks.length > 0;
  }
}

// 全局实例
let engineInstance: ThinkingEngine | null = null;

export function getThinkingEngine(): ThinkingEngine {
  if (!engineInstance) {
    engineInstance = new ThinkingEngine();
  }
  return engineInstance;
}

export function resetThinkingEngine(): void {
  engineInstance = null;
}
