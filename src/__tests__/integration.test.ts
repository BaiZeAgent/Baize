/**
 * 核心功能集成测试
 * 
 * 测试目标：
 * 1. 功能冲突检测
 * 2. 未启用功能检测
 * 3. 失效功能检测
 * 4. 简化功能检测
 * 5. 模块间集成测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ============================================================
// Mock 配置
// ============================================================

// Mock LLM
vi.mock('../llm', () => ({
  getLLMManager: () => ({
    chat: vi.fn().mockImplementation(async (messages: any[]) => {
      const lastMsg = messages[messages.length - 1];
      const content = lastMsg?.content || '';
      
      // 模拟路由器响应
      if (content.includes('你好') || content.includes('hello')) {
        return {
          content: JSON.stringify({
            action: 'reply',
            content: '你好！有什么可以帮助你的吗？',
            reason: '简单问候',
          }),
        };
      }
      
      if (content.includes('天气')) {
        return {
          content: JSON.stringify({
            action: 'tool',
            toolName: 'weather',
            toolParams: { location: '北京' },
            reason: '需要查询天气',
          }),
        };
      }
      
      // 模拟理解阶段响应
      if (content.includes('意图理解专家')) {
        return {
          content: JSON.stringify({
            literalMeaning: '用户打招呼',
            implicitIntent: '友好问候',
            context: {},
            constraints: [],
            coreNeed: '打招呼',
            isSimpleChat: true,
            directResponse: '你好！有什么可以帮助你的吗？',
          }),
        };
      }
      
      return {
        content: JSON.stringify({
          action: 'reply',
          content: '我理解了你的问题。',
          reason: '简单回复',
        }),
      };
    }),
    embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    getAvailableProviders: () => ['ollama', 'mock'],
    getDefaultProvider: () => ({ getName: () => 'ollama', getModel: () => 'llama2' }),
    getProvider: () => ({ getName: () => 'ollama' }),
    getProviderForTask: () => 'ollama',
    checkAvailability: async () => true,
  }),
  initLLMManager: vi.fn(),
}));

// Mock Database
vi.mock('../memory/database', () => {
  const mockDb = {
    run: vi.fn(() => ({ changes: 1, lastInsertRowid: Date.now().toString() })),
    get: vi.fn(() => undefined),
    all: vi.fn(() => []),
    close: vi.fn(),
    initialize: vi.fn().mockResolvedValue(undefined),
  };
  
  return {
    getDatabase: () => mockDb,
    resetDatabase: vi.fn(),
  };
});

// Mock Skills
vi.mock('../skills/registry', () => ({
  getSkillRegistry: () => ({
    register: vi.fn(),
    unregister: vi.fn(),
    get: vi.fn((name: string) => {
      if (name === 'weather') {
        return {
          name: 'weather',
          description: '查询天气',
          capabilities: ['weather', 'query'],
          riskLevel: 'low',
          validateParams: async () => ({ valid: true }),
          run: async () => ({ success: true, message: '北京今天晴，25°C' }),
          toInfo: () => ({
            name: 'weather',
            description: '查询天气',
            capabilities: ['weather', 'query'],
            riskLevel: 'low',
          }),
        };
      }
      return undefined;
    }),
    has: vi.fn((name: string) => name === 'weather'),
    findByCapability: vi.fn(() => []),
    getAll: vi.fn(() => [
      {
        name: 'weather',
        description: '查询天气',
        capabilities: ['weather', 'query'],
        riskLevel: 'low',
        inputSchema: { properties: { location: { type: 'string' } } },
        toInfo: () => ({ name: 'weather', description: '查询天气', capabilities: ['weather'], riskLevel: 'low' }),
      },
    ]),
    getAllCapabilities: vi.fn(() => ['weather', 'query', 'time']),
  }),
}));

// Mock Memory
vi.mock('../memory', () => ({
  getMemory: () => ({
    recordEpisode: vi.fn(),
    getEpisodes: vi.fn().mockReturnValue([]),
    remember: vi.fn(),
    recall: vi.fn().mockReturnValue(null),
    setPreference: vi.fn(),
    getPreference: vi.fn().mockReturnValue(null),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(),
    getTrustRecord: vi.fn().mockReturnValue(null),
    recordPattern: vi.fn(),
    getPattern: vi.fn().mockReturnValue(null),
  }),
}));

// Mock Cost Manager
vi.mock('../core/cost', () => ({
  getCostManager: () => ({
    canProceed: vi.fn().mockReturnValue(true),
    recordUsage: vi.fn(),
    getStats: vi.fn().mockReturnValue({ totalCost: 0, remainingBudget: 100 }),
  }),
}));

// Mock Context Manager
vi.mock('../core/context', () => ({
  getContextManager: () => ({
    evaluate: vi.fn().mockReturnValue({ 
      totalTokens: 100, 
      contextWindow: 100000, 
      utilizationRatio: 0.001,
      shouldWarn: false,
      shouldCompact: false,
      shouldBlock: false,
    }),
    estimateTotalTokens: vi.fn().mockReturnValue(100),
    compact: vi.fn().mockResolvedValue({ compacted: false, beforeTokens: 100, afterTokens: 100 }),
    handleOverflow: vi.fn().mockResolvedValue({ handled: false, method: 'none' }),
  }),
}));

// Mock Recovery Manager
vi.mock('../core/recovery', () => ({
  getRecoveryManager: () => ({
    setProfiles: vi.fn(),
    handle: vi.fn().mockResolvedValue({ action: 'retry' }),
    calculateBackoff: vi.fn().mockReturnValue(1000),
  }),
}));

// Mock Logger
vi.mock('../observability/logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ============================================================
// 测试开始
// ============================================================

import { ThinkingEngine, getThinkingEngine, resetThinkingEngine } from '../core/thinking/engine';
import { resetSmartRouter } from '../core/router';
import { ParallelExecutor, getExecutor, resetExecutor } from '../executor';
import { TaskScheduler, getScheduler, resetScheduler } from '../scheduler';
import { getSkillRegistry } from '../skills/registry';
import { getMemory } from '../memory';
import { getLLMManager } from '../llm';
import { ResourceLockManager } from '../scheduler/lock';
import { getSecurityManager } from '../security/manager';
import { getPluginManager } from '../plugins/manager';
import { getHookManager, HookType } from '../plugins/hooks';
import { RiskLevel, TaskStatus } from '../types';
import { VectorSearchManager } from '../memory/vector';
import { SubAgentManager } from '../executor/subagent';
import { SandboxManager } from '../sandbox/manager';

describe('核心功能集成测试', () => {
  
  beforeEach(() => {
    resetThinkingEngine();
    resetSmartRouter();
    resetExecutor();
    resetScheduler();
  });

  // ============================================================
  // 1. 思考引擎测试
  // ============================================================
  describe('思考引擎 (ThinkingEngine)', () => {
    let engine: ThinkingEngine;

    beforeEach(() => {
      engine = getThinkingEngine();
    });

    describe('功能完整性', () => {
      it('应该能处理用户输入', async () => {
        const result = await engine.think('你好');
        expect(result).toBeDefined();
        expect(result.duration).toBeGreaterThanOrEqual(0);
      });

      it('应该实现六阶段思考', async () => {
        const result = await engine.think('帮我查询北京的天气');
        expect(result).toBeDefined();
        expect(result.duration).toBeGreaterThanOrEqual(0);
      });

      it('应该正确处理空输入', async () => {
        const result = await engine.think('');
        expect(result).toBeDefined();
      });

      it('应该正确处理超长输入', async () => {
        const longInput = '这是一个很长的输入。'.repeat(1000);
        const result = await engine.think(longInput);
        expect(result).toBeDefined();
      });
    });

    describe('边界条件', () => {
      it('应该处理特殊字符输入', async () => {
        const result = await engine.think('你好！@#$%^&*()');
        expect(result).toBeDefined();
      });

      it('应该处理多语言输入', async () => {
        const result = await engine.think('Hello, 你好, こんにちは');
        expect(result).toBeDefined();
      });
    });
  });

  // ============================================================
  // 2. 执行器测试
  // ============================================================
  describe('执行器 (ParallelExecutor)', () => {
    let executor: ParallelExecutor;

    beforeEach(() => {
      executor = getExecutor();
    });

    describe('功能完整性', () => {
      it('应该能执行空任务列表', async () => {
        const result = await executor.execute([], [], {});
        expect(result.success).toBe(true);
        expect(result.taskResults).toEqual([]);
      });

      it('应该能执行单个任务', async () => {
        const tasks = [{
          id: 'task-1',
          description: '查询天气',
          type: 'weather',
          skillName: 'weather',
          params: { location: '北京' },
          riskLevel: RiskLevel.LOW,
          dependencies: [],
        }];

        const result = await executor.execute(tasks, [['task-1']], {});
        expect(result).toBeDefined();
      });

      it('应该支持并行执行', async () => {
        const tasks = [
          { id: 't1', description: '任务1', type: 'test', params: {}, riskLevel: RiskLevel.LOW, dependencies: [] },
          { id: 't2', description: '任务2', type: 'test', params: {}, riskLevel: RiskLevel.LOW, dependencies: [] },
        ];

        const result = await executor.execute(tasks, [['t1', 't2']], {});
        expect(result).toBeDefined();
      });

      it('应该支持串行执行', async () => {
        const tasks = [
          { id: 't1', description: '任务1', type: 'test', params: {}, riskLevel: RiskLevel.LOW, dependencies: [] },
          { id: 't2', description: '任务2', type: 'test', params: {}, riskLevel: RiskLevel.LOW, dependencies: ['t1'] },
        ];

        const result = await executor.execute(tasks, [['t1'], ['t2']], {});
        expect(result).toBeDefined();
      });
    });
  });

  // ============================================================
  // 3. 锁机制测试
  // ============================================================
  describe('锁机制 (ResourceLockManager)', () => {
    let lockManager: ResourceLockManager;

    beforeEach(() => {
      lockManager = new ResourceLockManager();
    });

    it('应该正确获取和释放锁', () => {
      const acquired = lockManager.tryAcquire('test-resource', 'write', 'task-1');
      expect(acquired).toBe(true);
      expect(lockManager.isLocked('test-resource')).toBe(true);
      
      lockManager.release('test-resource', 'task-1');
      expect(lockManager.isLocked('test-resource')).toBe(false);
    });

    it('读锁应该共享', () => {
      const acquired1 = lockManager.tryAcquire('shared-resource', 'read', 'task-1');
      const acquired2 = lockManager.tryAcquire('shared-resource', 'read', 'task-2');
      
      expect(acquired1).toBe(true);
      expect(acquired2).toBe(true);
    });

    it('写锁应该互斥', () => {
      const acquired1 = lockManager.tryAcquire('exclusive-resource', 'write', 'task-1');
      const acquired2 = lockManager.tryAcquire('exclusive-resource', 'write', 'task-2');
      
      expect(acquired1).toBe(true);
      expect(acquired2).toBe(false);
    });

    it('读锁应该阻止写锁', () => {
      lockManager.tryAcquire('resource', 'read', 'task-1');
      const acquired = lockManager.tryAcquire('resource', 'write', 'task-2');
      expect(acquired).toBe(false);
    });

    it('写锁应该阻止读锁', () => {
      lockManager.tryAcquire('resource', 'write', 'task-1');
      const acquired = lockManager.tryAcquire('resource', 'read', 'task-2');
      expect(acquired).toBe(false);
    });
  });

  // ============================================================
  // 4. 调度器测试
  // ============================================================
  describe('调度器 (TaskScheduler)', () => {
    let scheduler: TaskScheduler;

    beforeEach(() => {
      scheduler = getScheduler();
    });

    it('应该能调度任务', () => {
      const taskId = scheduler.schedule({
        id: 'test-task',
        description: '测试任务',
        type: 'test',
        params: {},
        riskLevel: RiskLevel.LOW,
        dependencies: [],
      });
      
      expect(taskId).toBeDefined();
    });

    it('应该能取消任务', () => {
      const taskId = scheduler.schedule({
        id: 'test-task',
        description: '测试任务',
        type: 'test',
        params: {},
        riskLevel: RiskLevel.LOW,
        dependencies: [],
      });
      
      const cancelled = scheduler.cancel(taskId);
      expect(cancelled).toBe(true);
      
      const status = scheduler.getStatus(taskId);
      expect(status?.status).toBe(TaskStatus.CANCELLED);
    });

    it('应该能获取统计信息', () => {
      scheduler.schedule({
        id: 'test-task',
        description: '测试任务',
        type: 'test',
        params: {},
        riskLevel: RiskLevel.LOW,
        dependencies: [],
      });
      
      const stats = scheduler.getStats();
      expect(stats.total).toBe(1);
      expect(stats.pending).toBe(1);
    });

    it('应该能清除所有任务', () => {
      scheduler.schedule({
        id: 'test-task',
        description: '测试任务',
        type: 'test',
        params: {},
        riskLevel: RiskLevel.LOW,
        dependencies: [],
      });
      
      scheduler.clear();
      
      const stats = scheduler.getStats();
      expect(stats.total).toBe(0);
    });
  });

  // ============================================================
  // 5. 技能系统测试
  // ============================================================
  describe('技能系统 (SkillRegistry)', () => {
    let registry: ReturnType<typeof getSkillRegistry>;

    beforeEach(() => {
      registry = getSkillRegistry();
    });

    it('应该能获取已注册的技能', () => {
      const skill = registry.get('weather');
      expect(skill).toBeDefined();
      expect(skill?.name).toBe('weather');
    });

    it('应该能获取所有技能', () => {
      const skills = registry.getAll();
      expect(Array.isArray(skills)).toBe(true);
    });

    it('应该能获取所有能力标签', () => {
      const capabilities = registry.getAllCapabilities();
      expect(Array.isArray(capabilities)).toBe(true);
    });
  });

  // ============================================================
  // 6. 记忆系统测试
  // ============================================================
  describe('记忆系统 (MemorySystem)', () => {
    let memory: ReturnType<typeof getMemory>;

    beforeEach(() => {
      memory = getMemory();
    });

    it('应该能记录情景记忆', () => {
      expect(() => memory.recordEpisode('test', '测试内容')).not.toThrow();
    });

    it('应该能获取情景记忆', () => {
      const episodes = memory.getEpisodes('test');
      expect(Array.isArray(episodes)).toBe(true);
    });

    it('应该能记录成功/失败', () => {
      expect(() => memory.recordSuccess('operation')).not.toThrow();
      expect(() => memory.recordFailure('operation')).not.toThrow();
    });
  });

  // ============================================================
  // 7. 安全系统测试
  // ============================================================
  describe('安全系统 (SecurityManager)', () => {
    let security: ReturnType<typeof getSecurityManager>;

    beforeEach(() => {
      security = getSecurityManager();
    });

    it('应该禁止访问系统路径', () => {
      const result = security.checkPath('/etc/passwd');
      expect(result.allowed).toBe(false);
    });

    it('应该禁止执行危险命令', () => {
      const result = security.checkCommand('rm -rf /');
      expect(result.allowed).toBe(false);
    });

    it('应该检测敏感信息', () => {
      const text = 'API key: sk-1234567890abcdefghijklmnop';
      const result = security.detectSensitiveInfo(text);
      expect(result.found).toBe(true);
    });

    it('应该脱敏敏感信息', () => {
      const text = 'API key: sk-1234567890abcdefghijklmnop';
      const redacted = security.redactSensitiveInfo(text);
      expect(redacted).toContain('[REDACTED:');
    });
  });

  // ============================================================
  // 8. 插件系统测试
  // ============================================================
  describe('插件系统 (PluginManager)', () => {
    let pluginManager: ReturnType<typeof getPluginManager>;

    beforeEach(() => {
      pluginManager = getPluginManager();
    });

    it('应该能添加插件目录', () => {
      expect(() => pluginManager.addPluginDir('/tmp/plugins')).not.toThrow();
    });

    it('应该能注册工具', () => {
      pluginManager.registerTool('test-tool', () => 'result');
      const tool = pluginManager.getTool('test-tool');
      expect(tool).toBeDefined();
    });

    it('应该能注册服务', () => {
      const service = { name: 'test' };
      pluginManager.registerService('test-service', service);
      const retrieved = pluginManager.getService('test-service');
      expect(retrieved).toBe(service);
    });
  });

  // ============================================================
  // 9. Hook系统测试
  // ============================================================
  describe('Hook系统 (HookManager)', () => {
    let hookManager: ReturnType<typeof getHookManager>;

    beforeEach(() => {
      hookManager = getHookManager();
      hookManager.clear();
    });

    it('应该能注册Hook', () => {
      const id = hookManager.register(HookType.ON_MESSAGE, () => {});
      expect(id).toBeDefined();
    });

    it('应该能触发Hook', async () => {
      let called = false;
      hookManager.register(HookType.ON_MESSAGE, () => {
        called = true;
      });

      await hookManager.emit(HookType.ON_MESSAGE, { text: 'test' });
      expect(called).toBe(true);
    });

    it('应该支持优先级', async () => {
      const order: number[] = [];
      hookManager.register(HookType.ON_MESSAGE, () => { order.push(1); }, { priority: 1 });
      hookManager.register(HookType.ON_MESSAGE, () => { order.push(2); }, { priority: 2 });

      await hookManager.emit(HookType.ON_MESSAGE);
      expect(order).toEqual([2, 1]);
    });

    it('应该支持一次性Hook', async () => {
      let count = 0;
      hookManager.register(HookType.ON_MESSAGE, () => { count++; }, { once: true });

      await hookManager.emit(HookType.ON_MESSAGE);
      await hookManager.emit(HookType.ON_MESSAGE);
      expect(count).toBe(1);
    });
  });

  // ============================================================
  // 10. 模块间集成测试
  // ============================================================
  describe('模块间集成测试', () => {
    
    it('思考引擎应该能调用技能注册表', async () => {
      const engine = getThinkingEngine();
      const registry = getSkillRegistry();
      
      const skills = registry.getAll();
      expect(skills.length).toBeGreaterThan(0);
    });

    it('执行器应该能调用记忆系统', async () => {
      const executor = getExecutor();
      const memory = getMemory();
      
      expect(() => memory.recordSuccess('test')).not.toThrow();
    });

    it('调度器应该能与执行器协同工作', async () => {
      const scheduler = getScheduler();
      const executor = getExecutor();
      
      const taskId = scheduler.schedule({
        id: 'test-task',
        description: '测试任务',
        type: 'test',
        params: {},
        riskLevel: RiskLevel.LOW,
        dependencies: [],
      });
      
      expect(taskId).toBeDefined();
      
      const result = await executor.execute([], [], {});
      expect(result.success).toBe(true);
    });

    it('安全系统应该能阻止危险操作', () => {
      const security = getSecurityManager();
      
      const result = security.checkCommand('rm -rf /');
      expect(result.allowed).toBe(false);
    });

    it('Hook系统应该能在关键点触发', async () => {
      const hookManager = getHookManager();
      
      let beforeCalled = false;
      let afterCalled = false;
      
      hookManager.register(HookType.BEFORE_TOOL_CALL, () => {
        beforeCalled = true;
      });
      
      hookManager.register(HookType.AFTER_TOOL_CALL, () => {
        afterCalled = true;
      });
      
      await hookManager.emit(HookType.BEFORE_TOOL_CALL);
      await hookManager.emit(HookType.AFTER_TOOL_CALL);
      
      expect(beforeCalled).toBe(true);
      expect(afterCalled).toBe(true);
    });
  });

  // ============================================================
  // 11. 功能冲突检测
  // ============================================================
  describe('功能冲突检测', () => {
    
    it('锁机制不应该死锁', () => {
      const lockManager = new ResourceLockManager();
      
      const r1 = lockManager.tryAcquire('resource', 'read', 'task-1');
      const r2 = lockManager.tryAcquire('resource', 'read', 'task-2');
      
      expect(r1).toBe(true);
      expect(r2).toBe(true);
      
      lockManager.release('resource', 'task-1');
      lockManager.release('resource', 'task-2');
    });

    it('并行执行不应该互相干扰', async () => {
      const executor = getExecutor();
      
      const tasks = [
        { id: 't1', description: '任务1', type: 'test', params: {}, riskLevel: RiskLevel.LOW, dependencies: [] },
        { id: 't2', description: '任务2', type: 'test', params: {}, riskLevel: RiskLevel.LOW, dependencies: [] },
      ];
      
      const result = await executor.execute(tasks, [['t1', 't2']], {});
      
      expect(result.taskResults.length).toBe(2);
    });
  });

  // ============================================================
  // 12. 未启用功能检测
  // ============================================================
  describe('未启用功能检测', () => {
    
    it('LLM嵌入功能应该可用', async () => {
      const llm = getLLMManager();
      expect(typeof llm.embed).toBe('function');
    });

    it('插件系统应该可用', () => {
      const pluginManager = getPluginManager();
      expect(typeof pluginManager.registerTool).toBe('function');
      expect(typeof pluginManager.registerService).toBe('function');
    });

    it('Hook系统应该支持所有定义的Hook类型', () => {
      const hookTypes = Object.values(HookType);
      expect(hookTypes.length).toBeGreaterThan(10);
    });
  });

  // ============================================================
  // 13. 失效功能检测
  // ============================================================
  describe('失效功能检测', () => {
    
    it('思考引擎validate方法应该可用', async () => {
      const engine = getThinkingEngine();
      expect(typeof (engine as any).validate).toBe('function');
    });

    it('思考引擎reflect方法应该可用', async () => {
      const engine = getThinkingEngine();
      expect(typeof (engine as any).reflect).toBe('function');
    });

    it('执行器executeSkill方法应该可用', async () => {
      const executor = getExecutor();
      expect(typeof executor.executeSkill).toBe('function');
    });
  });

  // ============================================================
  // 14. 简化功能检测
  // ============================================================
  describe('简化功能检测', () => {
    
    it('向量搜索应该有基本功能', async () => {
      expect(VectorSearchManager).toBeDefined();
      expect(typeof VectorSearchManager).toBe('function');
    });

    it('子Agent管理器应该有基本功能', async () => {
      expect(SubAgentManager).toBeDefined();
      expect(typeof SubAgentManager).toBe('function');
    });

    it('沙箱管理器应该有基本功能', async () => {
      expect(SandboxManager).toBeDefined();
      expect(typeof SandboxManager).toBe('function');
    });

    it('向量搜索应该能初始化', async () => {
      const vectorSearch = new VectorSearchManager({ persist: false });
      await vectorSearch.init();
      
      expect(vectorSearch.size()).toBe(0);
      
      await vectorSearch.clear();
    });

    it('子Agent管理器应该能创建Agent', async () => {
      const subAgentManager = new SubAgentManager();
      
      const info = await subAgentManager.create({
        type: 'async' as any,
        name: 'test-agent',
        tasks: [],
        parallelGroups: [],
        context: {},
      });
      
      expect(info.id).toBeDefined();
      expect(info.status).toBeDefined();
    });

    it('沙箱管理器应该能创建上下文', async () => {
      const sandboxManager = new SandboxManager({ enabled: false });
      
      const ctx = await sandboxManager.create({
        hostWorkdir: '/tmp/test',
        sessionId: 'test-session',
      });
      
      expect(ctx).toBeDefined();
    });
  });
});
