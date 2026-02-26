/**
 * 会话管理器
 * 
 * 功能：
 * - 会话存储
 * - 实体提取（位置、时间等）
 * - 上下文摘要
 * - 对话历史管理
 */

import { getLogger } from '../../observability/logger';

const logger = getLogger('core:session');

/** 会话 */
export interface Session {
  id: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  entities: Map<string, string>;
  lastSkill: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 会话管理器
 */
export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private maxHistoryLength = 20;

  // 城市列表（用于实体提取）
  private cities = [
    '北京', '上海', '广州', '深圳', '杭州', '南京', '成都', '武汉', 
    '西安', '重庆', '天津', '苏州', '长沙', '郑州', '青岛', '大连',
    '宁波', '厦门', '福州', '哈尔滨', '沈阳', '长春', '济南', '合肥'
  ];

  /**
   * 获取或创建会话
   */
  getOrCreateSession(sessionId: string): Session {
    if (!this.sessions.has(sessionId)) {
      const session: Session = {
        id: sessionId,
        history: [],
        entities: new Map(),
        lastSkill: null,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      this.sessions.set(sessionId, session);
      logger.debug(`创建新会话: ${sessionId}`);
    }
    
    const session = this.sessions.get(sessionId)!;
    session.updatedAt = new Date();
    return session;
  }

  /**
   * 添加消息到历史
   */
  addMessage(sessionId: string, role: 'user' | 'assistant', content: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.history.push({ role, content });
    session.updatedAt = new Date();

    // 限制历史长度
    if (session.history.length > this.maxHistoryLength) {
      session.history = session.history.slice(-this.maxHistoryLength);
    }

    // 提取实体
    this.extractEntities(session, content);
  }

  /**
   * 提取实体
   */
  private extractEntities(session: Session, content: string): void {
    // 提取城市
    for (const city of this.cities) {
      if (content.includes(city)) {
        session.entities.set('location', city);
        logger.debug(`提取实体: location = ${city}`);
        break;
      }
    }

    // 提取时间
    const timePatterns: [RegExp, string][] = [
      [/今天/, '今天'],
      [/明天/, '明天'],
      [/后天/, '后天'],
      [/昨天/, '昨天'],
      [/大后天/, '大后天'],
    ];
    for (const [pattern, value] of timePatterns) {
      if (pattern.test(content)) {
        session.entities.set('date', value);
        logger.debug(`提取实体: date = ${value}`);
        break;
      }
    }

    // 提取股票代码（6位数字）
    const stockMatch = content.match(/\b(\d{6})\b/);
    if (stockMatch) {
      session.entities.set('stockCode', stockMatch[1]);
      logger.debug(`提取实体: stockCode = ${stockMatch[1]}`);
    }

    // 提取人名（简单匹配）
    const namePatterns = [
      /告诉(\S+)/,
      /提醒(\S+)/,
      /发给(\S+)/,
    ];
    for (const pattern of namePatterns) {
      const match = content.match(pattern);
      if (match) {
        session.entities.set('target', match[1]);
        break;
      }
    }
  }

  /**
   * 记录技能调用
   */
  recordSkill(sessionId: string, skillName: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastSkill = skillName;
      session.updatedAt = new Date();
      logger.debug(`记录技能: ${skillName}`);
    }
  }

  /**
   * 记录实体
   */
  recordEntity(sessionId: string, key: string, value: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.entities.set(key, value);
      session.updatedAt = new Date();
      logger.debug(`记录实体: ${key} = ${value}`);
    }
  }

  /**
   * 获取实体
   */
  getEntity(sessionId: string, key: string): string | undefined {
    return this.sessions.get(sessionId)?.entities.get(key);
  }

  /**
   * 获取所有实体
   */
  getAllEntities(sessionId: string): Record<string, string> {
    const session = this.sessions.get(sessionId);
    if (!session) return {};
    return Object.fromEntries(session.entities);
  }

  /**
   * 构建上下文摘要
   */
  buildContextSummary(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) return '';

    const parts: string[] = [];

    // 实体
    if (session.entities.size > 0) {
      const entities = Array.from(session.entities.entries())
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      parts.push(`已知信息: ${entities}`);
    }

    // 上次技能
    if (session.lastSkill) {
      parts.push(`上次操作: ${session.lastSkill}`);
    }

    return parts.join('; ');
  }

  /**
   * 获取历史（用于LLM）
   */
  getHistory(sessionId: string, limit: number = 6): Array<{ role: 'user' | 'assistant'; content: string }> {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return session.history.slice(-limit);
  }

  /**
   * 获取格式化的历史（用于提示词）
   */
  getFormattedHistory(sessionId: string, limit: number = 6): string {
    const history = this.getHistory(sessionId, limit);
    if (history.length === 0) return '';
    
    return history.map(h => {
      const role = h.role === 'user' ? '用户' : '白泽';
      return `${role}: ${h.content}`;
    }).join('\n');
  }

  /**
   * 检测是否是追问
   */
  isFollowUp(sessionId: string, input: string): boolean {
    // 追问关键词
    const followUpPatterns = [
      /那/, /呢/, /会.*吗/, /它/, /这个/, 
      /继续/, /还有/, /然后/, /之后/, /呢$/,
      /怎么样/, /如何/, /多少/, /什么/
    ];
    
    const hasFollowUpPattern = followUpPatterns.some(p => p.test(input));
    const session = this.sessions.get(sessionId);
    const hasHistory = session && session.history && session.history.length > 0;
    
    return hasFollowUpPattern && !!hasHistory;
  }

  /**
   * 清除会话
   */
  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    logger.debug(`清除会话: ${sessionId}`);
  }

  /**
   * 清除所有会话
   */
  clearAll(): void {
    this.sessions.clear();
    logger.debug('清除所有会话');
  }

  /**
   * 获取会话数量
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * 获取会话列表
   */
  getSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }
}

// 单例
let instance: SessionManager | null = null;

export function getSessionManager(): SessionManager {
  if (!instance) {
    instance = new SessionManager();
  }
  return instance;
}

export function resetSessionManager(): void {
  instance = null;
}
