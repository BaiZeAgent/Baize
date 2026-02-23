/**
 * 角色团队 - 自进化角色定义
 */
import { Role, RoleThought } from '../../types';
import { getLLMManager } from '../../llm';
import { getLogger } from '../../observability/logger';

const logger = getLogger('evolution:team');

/**
 * 角色定义
 */
export interface RoleDefinition {
  name: Role;
  title: string;
  description: string;
  responsibilities: string[];
  expertise: string[];
  prompt: string;
}

/**
 * 预定义角色
 */
export const ROLE_DEFINITIONS: Record<Role, RoleDefinition> = {
  [Role.PRODUCT_MANAGER]: {
    name: Role.PRODUCT_MANAGER,
    title: '产品经理',
    description: '负责需求分析和用户体验',
    responsibilities: [
      '分析需求合理性',
      '评估用户体验影响',
      '考虑边界情况',
      '判断是否值得实现',
    ],
    expertise: ['需求分析', '用户体验', '产品规划'],
    prompt: `你是产品经理角色。你的职责是：
1. 分析需求是否合理
2. 评估用户体验影响
3. 考虑边界情况
4. 判断是否值得实现

请以JSON格式输出你的分析：
{
  "thoughts": "你的思考过程",
  "decisions": ["决策1", "决策2"],
  "concerns": ["担忧1", "担忧2"],
  "suggestions": ["建议1", "建议2"],
  "approved": true/false,
  "vetoReason": "否决原因（如果否决）"
}`,
  },
  [Role.DEVELOPER]: {
    name: Role.DEVELOPER,
    title: '开发者',
    description: '负责技术实现',
    responsibilities: [
      '评估技术可行性',
      '分析实现复杂度',
      '考虑代码质量',
      '识别潜在风险',
    ],
    expertise: ['技术架构', '代码实现', '性能优化'],
    prompt: `你是开发者角色。你的职责是：
1. 评估技术可行性
2. 分析实现复杂度
3. 考虑代码质量
4. 识别潜在风险

请以JSON格式输出你的分析：
{
  "thoughts": "你的思考过程",
  "decisions": ["决策1", "决策2"],
  "concerns": ["担忧1", "担忧2"],
  "suggestions": ["建议1", "建议2"],
  "approved": true/false,
  "vetoReason": "否决原因（如果否决）"
}`,
  },
  [Role.TESTER]: {
    name: Role.TESTER,
    title: '测试工程师',
    description: '负责质量保证',
    responsibilities: [
      '设计测试用例',
      '识别边界情况',
      '评估测试覆盖',
      '预测可能的bug',
    ],
    expertise: ['测试设计', '质量保证', '自动化测试'],
    prompt: `你是测试工程师角色。你的职责是：
1. 设计测试用例
2. 识别边界情况
3. 评估测试覆盖
4. 预测可能的bug

请以JSON格式输出你的分析：
{
  "thoughts": "你的思考过程",
  "decisions": ["决策1", "决策2"],
  "concerns": ["担忧1", "担忧2"],
  "suggestions": ["建议1", "建议2"],
  "approved": true/false,
  "vetoReason": "否决原因（如果否决）"
}`,
  },
  [Role.BETA_TESTER]: {
    name: Role.BETA_TESTER,
    title: '内测用户',
    description: '代表用户视角',
    responsibilities: [
      '从用户角度体验',
      '评估易用性',
      '发现体验问题',
      '提出改进建议',
    ],
    expertise: ['用户体验', '可用性测试', '反馈收集'],
    prompt: `你是内测用户角色。你的职责是：
1. 从用户角度体验
2. 评估易用性
3. 发现体验问题
4. 提出改进建议

请以JSON格式输出你的分析：
{
  "thoughts": "你的思考过程",
  "decisions": ["决策1", "决策2"],
  "concerns": ["担忧1", "担忧2"],
  "suggestions": ["建议1", "建议2"],
  "approved": true/false,
  "vetoReason": "否决原因（如果否决）"
}`,
  },
  [Role.REVIEWER]: {
    name: Role.REVIEWER,
    title: '代码审查者',
    description: '负责代码审查',
    responsibilities: [
      '检查代码规范',
      '评估安全性',
      '审查架构影响',
      '决定是否批准',
    ],
    expertise: ['代码审查', '安全审计', '架构设计'],
    prompt: `你是代码审查者角色。你的职责是：
1. 检查代码规范
2. 评估安全性
3. 审查架构影响
4. 决定是否批准

请以JSON格式输出你的分析：
{
  "thoughts": "你的思考过程",
  "decisions": ["决策1", "决策2"],
  "concerns": ["担忧1", "担忧2"],
  "suggestions": ["建议1", "建议2"],
  "approved": true/false,
  "vetoReason": "否决原因（如果否决）"
}`,
  },
};

/**
 * 角色团队管理器
 */
export class RoleTeamManager {
  private llm = getLLMManager();

  /**
   * 获取角色定义
   */
  getRoleDefinition(role: Role): RoleDefinition {
    return ROLE_DEFINITIONS[role];
  }

  /**
   * 让角色思考
   */
  async think(role: Role, context: string): Promise<RoleThought> {
    const definition = ROLE_DEFINITIONS[role];
    
    logger.debug(`角色思考: ${definition.title}`);
    
    const response = await this.llm.chat([
      { role: 'system', content: definition.prompt },
      { role: 'user', content: context },
    ]);

    return this.parseResponse(response.content, role);
  }

  /**
   * 团队讨论
   */
  async discuss(context: string, roles?: Role[]): Promise<RoleThought[]> {
    const teamRoles = roles || [
      Role.PRODUCT_MANAGER,
      Role.DEVELOPER,
      Role.TESTER,
      Role.BETA_TESTER,
    ];

    const thoughts: RoleThought[] = [];

    for (const role of teamRoles) {
      const thought = await this.think(role, context);
      thoughts.push(thought);
      
      // 如果有否决，提前结束
      if (!thought.approved) {
        logger.warn(`角色 ${ROLE_DEFINITIONS[role].title} 否决了提议`);
        break;
      }
    }

    return thoughts;
  }

  /**
   * 解析响应
   */
  private parseResponse(content: string, role: Role): RoleThought {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          role,
          thoughts: parsed.thoughts || content,
          decisions: parsed.decisions || [],
          concerns: parsed.concerns || [],
          suggestions: parsed.suggestions || [],
          approved: parsed.approved !== false,
          vetoReason: parsed.vetoReason,
        };
      }
    } catch {
      // 解析失败
    }

    return {
      role,
      thoughts: content,
      decisions: [],
      concerns: [],
      suggestions: [],
      approved: true,
    };
  }
}

// 全局实例
let roleTeamManager: RoleTeamManager | null = null;

export function getRoleTeamManager(): RoleTeamManager {
  if (!roleTeamManager) {
    roleTeamManager = new RoleTeamManager();
  }
  return roleTeamManager;
}
