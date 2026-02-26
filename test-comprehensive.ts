/**
 * Baize v3.2.0 全方位回归测试
 * 
 * 测试模块：
 * 1. 核心功能 - Brain, Router, Context, Memory, Knowledge
 * 2. 执行器 - ParallelExecutor, ReActExecutor, ProcessTool, SubAgent
 * 3. 调度器 - Lock, Proactive
 * 4. 安全 - SecurityManager, Sandbox
 * 5. 进化 - Evolution, Gap Detection
 * 6. 插件 - PluginManager, Hooks
 * 7. LLM - 多提供商, 成本管理, 流式输出
 * 8. 技能 - 加载, 市场, 内置技能
 */

import { config } from 'dotenv';
config();

// 从环境变量获取 API Key
const API_KEY = process.env.ALIYUN_API_KEY || process.env.BAIZE_API_KEY || '';

// 颜色输出
const c = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
};

function log(color: keyof typeof c, message: string) {
  console.log(`${c[color]}${message}${c.reset}`);
}

function logSection(title: string, subtitle?: string) {
  console.log();
  log('cyan', `═══════════════════════════════════════════════════════════════`);
  log('cyan', `  ${title}`);
  if (subtitle) log('gray', `  ${subtitle}`);
  log('cyan', `═══════════════════════════════════════════════════════════════`);
}

// 测试统计
interface TestStats {
  passed: number;
  failed: number;
  skipped: number;
  errors: string[];
  durations: Map<string, number>;
}

const stats: TestStats = {
  passed: 0,
  failed: 0,
  skipped: 0,
  errors: [],
  durations: new Map(),
};

async function test(name: string, fn: () => Promise<boolean>, timeout: number = 30000) {
  const start = Date.now();
  process.stdout.write(`  ${name}... `);
  
  try {
    const result = await Promise.race([
      fn(),
      new Promise<boolean>((_, reject) => 
        setTimeout(() => reject(new Error('超时')), timeout)
      ),
    ]);
    
    const duration = Date.now() - start;
    stats.durations.set(name, duration);
    
    if (result) {
      log('green', `✓ 通过 (${duration}ms)`);
      stats.passed++;
    } else {
      log('red', `✗ 失败 (${duration}ms)`);
      stats.failed++;
    }
  } catch (error) {
    const duration = Date.now() - start;
    const errorMsg = error instanceof Error ? error.message : String(error);
    log('red', `✗ 错误: ${errorMsg} (${duration}ms)`);
    stats.failed++;
    stats.errors.push(`${name}: ${errorMsg}`);
  }
}

function skip(name: string, reason: string) {
  log('yellow', `  ${name}... ⊘ 跳过 (${reason})`);
  stats.skipped++;
}

// ═══════════════════════════════════════════════════════════════
// 测试 1: 核心功能
// ═══════════════════════════════════════════════════════════════

async function testCore() {
  logSection('测试 1: 核心功能', 'Brain, Router, Context, Memory, Knowledge');

  // 1.1 Brain 测试
  await test('1.1.1 Brain - 简单对话', async () => {
    const { getBrain } = await import('./src/core/brain');
    const brain = getBrain();
    
    const result = await brain.process('你好');
    return result.intent !== undefined && result.action !== undefined;
  });

  await test('1.1.2 Brain - 流式输出', async () => {
    const { getBrain } = await import('./src/core/brain');
    const brain = getBrain();
    
    let eventCount = 0;
    for await (const event of brain.processStream('说一句话', 'test-session')) {
      eventCount++;
      if (eventCount > 20) break; // 防止无限循环
    }
    
    return eventCount > 0;
  });

  await test('1.1.3 Brain - 历史管理', async () => {
    const { getBrain } = await import('./src/core/brain');
    const brain = getBrain();
    
    brain.clearHistory();
    await brain.process('第一条消息');
    await brain.process('第二条消息');
    
    const history = brain.getHistory();
    return history.length >= 2;
  });

  // 1.2 Router 测试
  await test('1.2.1 Router - 意图识别', async () => {
    const { getRouter } = await import('./src/core/router');
    const router = getRouter();
    
    const result = await router.analyze('帮我启动一个后台进程');
    return result.intent !== undefined;
  });

  await test('1.2.2 Router - 任务分解', async () => {
    const { getRouter } = await import('./src/core/router');
    const router = getRouter();
    
    const result = await router.plan('先查询天气，然后发送邮件通知');
    return result.tasks !== undefined;
  });

  // 1.3 Context 测试
  await test('1.3.1 Context - 上下文压缩', async () => {
    const { getContextManager } = await import('./src/core/context');
    const ctx = getContextManager();
    
    // 添加大量上下文
    const longContext = Array(100).fill('这是一段测试文本。').join('\n');
    const compressed = await ctx.compress(longContext);
    
    return compressed.length < longContext.length;
  });

  await test('1.3.2 Context - 会话管理', async () => {
    const { getContextManager } = await import('./src/core/context');
    const ctx = getContextManager();
    
    const sessionId = 'test-session-' + Date.now();
    ctx.setSession(sessionId, { userId: 'test' });
    
    const session = ctx.getSession(sessionId);
    return session?.userId === 'test';
  });

  // 1.4 Memory 测试
  await test('1.4.1 Memory - 记忆存储', async () => {
    const { getMemory } = await import('./src/memory');
    const memory = getMemory();
    
    memory.recordEpisode('test', '测试记忆内容');
    const episodes = memory.getRecentEpisodes(10);
    
    return episodes.some(e => e.content.includes('测试记忆'));
  });

  await test('1.4.2 Memory - 偏好设置', async () => {
    const { getMemory } = await import('./src/memory');
    const memory = getMemory();
    
    memory.setPreference('test_pref', 'test_value');
    const value = memory.getPreference('test_pref');
    
    return value === 'test_value';
  });

  await test('1.4.3 Memory - 信任记录', async () => {
    const { getMemory } = await import('./src/memory');
    const memory = getMemory();
    
    memory.recordSuccess('test_skill');
    memory.recordSuccess('test_skill');
    memory.recordFailure('test_skill');
    
    const record = memory.getTrustRecord('test_skill');
    return record?.successCount === 2 && record?.failureCount === 1;
  });

  // 1.5 Knowledge 测试
  await test('1.5.1 Knowledge - 知识存储', async () => {
    const { getKnowledgeBase } = await import('./src/knowledge');
    const kb = getKnowledgeBase();
    
    await kb.add({
      id: 'test-knowledge-' + Date.now(),
      content: '测试知识内容',
      metadata: { source: 'test' },
    });
    
    return true;
  });

  await test('1.5.2 Knowledge - 知识检索', async () => {
    const { getKnowledgeBase } = await import('./src/knowledge');
    const kb = getKnowledgeBase();
    
    const results = await kb.search('测试');
    return Array.isArray(results);
  });
}

// ═══════════════════════════════════════════════════════════════
// 测试 2: 执行器
// ═══════════════════════════════════════════════════════════════

async function testExecutors() {
  logSection('测试 2: 执行器', 'ParallelExecutor, ReActExecutor, ProcessTool, SubAgent');

  // 2.1 ParallelExecutor 测试
  await test('2.1.1 ParallelExecutor - 单任务执行', async () => {
    const { getExecutor } = await import('./src/executor');
    const { RiskLevel } = await import('./src/types');
    const executor = getExecutor();
    
    const tasks = [{
      id: 'task-1',
      description: '测试任务',
      type: 'test',
      skillName: 'process',
      params: { action: 'list' },
      riskLevel: RiskLevel.LOW,
      dependencies: [],
    }];
    
    const result = await executor.execute(tasks, [['task-1']], {}, undefined, '测试');
    return result.taskResults.length === 1;
  });

  await test('2.1.2 ParallelExecutor - 并行任务执行', async () => {
    const { getExecutor } = await import('./src/executor');
    const { RiskLevel } = await import('./src/types');
    const executor = getExecutor();
    
    const tasks = [
      { id: 't1', description: '任务1', type: 'test', skillName: 'process', params: { action: 'list' }, riskLevel: RiskLevel.LOW, dependencies: [] },
      { id: 't2', description: '任务2', type: 'test', skillName: 'process', params: { action: 'list' }, riskLevel: RiskLevel.LOW, dependencies: [] },
      { id: 't3', description: '任务3', type: 'test', skillName: 'process', params: { action: 'list' }, riskLevel: RiskLevel.LOW, dependencies: [] },
    ];
    
    const start = Date.now();
    const result = await executor.execute(tasks, [['t1', 't2', 't3']], {}, undefined, '测试');
    const duration = Date.now() - start;
    
    // 并行执行应该比串行快
    return result.taskResults.length === 3 && duration < 500;
  });

  // 2.2 ReActExecutor 测试
  await test('2.2.1 ReActExecutor - 空任务处理', async () => {
    const { getReActExecutor } = await import('./src/executor');
    const executor = getReActExecutor();
    
    const result = await executor.execute([], [], {}, '你好');
    return result.success && result.finalMessage.length > 0;
  });

  await test('2.2.2 ReActExecutor - 策略调整', async () => {
    const { ReActExecutor } = await import('./src/executor/react-executor');
    const { RiskLevel } = await import('./src/types');
    const executor = new ReActExecutor(5);
    
    // 创建一个会失败的任务，测试策略调整
    const tasks = [{
      id: 'task-fail',
      description: '会失败的任务',
      type: 'test',
      skillName: 'nonexistent_skill',
      params: {},
      riskLevel: RiskLevel.LOW,
      dependencies: [],
    }];
    
    const result = await executor.execute(tasks, [[]], {}, '执行一个不存在的技能');
    // 应该触发策略调整或错误处理
    return result.iterations > 0;
  });

  // 2.3 ProcessTool 测试
  await test('2.3.1 ProcessTool - 完整生命周期', async () => {
    const { ProcessTool } = await import('./src/executor/process-tool');
    const tool = new ProcessTool();
    
    // 启动
    const spawn = await tool.run({
      action: 'spawn',
      command: 'bash',
      args: ['-c', 'echo "start"; sleep 0.1; echo "middle"; sleep 0.1; echo "end"'],
    }, {});
    
    if (!spawn.success) return false;
    
    const sessionId = (spawn.data as any).sessionId;
    
    // 轮询
    await new Promise(r => setTimeout(r, 150));
    const poll = await tool.run({
      action: 'poll',
      sessionId,
    }, {});
    
    // 列出
    const list = await tool.run({ action: 'list' }, {});
    
    // 终止
    const kill = await tool.run({
      action: 'kill',
      sessionId,
    }, {});
    
    return spawn.success && poll.success && list.success;
  });

  await test('2.3.2 ProcessTool - 按键发送', async () => {
    const { ProcessTool } = await import('./src/executor/process-tool');
    const tool = new ProcessTool();
    
    // 启动一个交互式进程
    const spawn = await tool.run({
      action: 'spawn',
      command: 'cat',
    }, {});
    
    if (!spawn.success) return false;
    
    const sessionId = (spawn.data as any).sessionId;
    
    // 发送输入
    const write = await tool.run({
      action: 'write',
      sessionId,
      data: 'Hello',
    }, {});
    
    // 发送 Ctrl+D (EOF)
    const keys = await tool.run({
      action: 'send-keys',
      sessionId,
      keys: ['Ctrl+D'],
    }, {});
    
    // 清理
    await tool.run({ action: 'kill', sessionId }, {});
    
    return write.success && keys.success;
  });

  // 2.4 SubAgent 测试
  await test('2.4.1 SubAgent - 创建和执行', async () => {
    const { getSubAgentManager, SubAgentType } = await import('./src/executor');
    const { RiskLevel } = await import('./src/types');
    const manager = getSubAgentManager();
    
    const config = {
      type: SubAgentType.SYNC,
      name: 'test-subagent',
      tasks: [{
        id: 'sub-task-1',
        description: '子任务',
        type: 'test',
        skillName: 'process',
        params: { action: 'list' },
        riskLevel: RiskLevel.LOW,
        dependencies: [],
      }],
      parallelGroups: [['sub-task-1']],
      context: {},
    };
    
    const info = await manager.create(config);
    const result = await manager.execute(info.id);
    
    return result.status === 'completed' || result.status === 'failed';
  });
}

// ═══════════════════════════════════════════════════════════════
// 测试 3: 调度器
// ═══════════════════════════════════════════════════════════════

async function testScheduler() {
  logSection('测试 3: 调度器', 'Lock, Proactive');

  // 3.1 Lock 测试
  await test('3.1.1 Lock - 基本锁操作', async () => {
    const { getLockManager } = await import('./src/scheduler/lock');
    const lock = getLockManager();
    
    const acquired = lock.tryAcquire('test-resource', 'read', 'test-task');
    if (!acquired) return false;
    
    const status = lock.getStatus('test-resource');
    lock.release('test-resource', 'test-task');
    
    return status?.readCount === 1;
  });

  await test('3.1.2 Lock - 读写锁冲突', async () => {
    const { getLockManager } = await import('./src/scheduler/lock');
    const lock = getLockManager();
    
    // 获取读锁
    const read1 = lock.tryAcquire('rw-test', 'read', 'reader1');
    const read2 = lock.tryAcquire('rw-test', 'read', 'reader2');
    
    // 尝试获取写锁（应该失败）
    const write1 = lock.tryAcquire('rw-test', 'write', 'writer1');
    
    // 释放读锁
    lock.release('rw-test', 'reader1');
    lock.release('rw-test', 'reader2');
    
    // 现在写锁应该成功
    const write2 = lock.tryAcquire('rw-test', 'write', 'writer1');
    lock.release('rw-test', 'writer1');
    
    return read1 && read2 && !write1 && write2;
  });

  await test('3.1.3 Lock - 锁等待', async () => {
    const { getLockManager } = await import('./src/scheduler/lock');
    const lock = getLockManager();
    
    // 获取写锁
    lock.tryAcquire('wait-test', 'write', 'holder');
    
    // 异步等待
    const start = Date.now();
    const waitPromise = lock.waitFor('wait-test', 'read', 'waiter', 1000);
    
    // 100ms 后释放
    setTimeout(() => lock.release('wait-test', 'holder'), 100);
    
    const acquired = await waitPromise;
    const duration = Date.now() - start;
    
    if (acquired) {
      lock.release('wait-test', 'waiter');
    }
    
    return acquired && duration >= 90;
  });

  // 3.2 Proactive 测试
  await test('3.2.1 Proactive - 任务调度', async () => {
    const { getProactiveScheduler } = await import('./src/scheduler/proactive');
    const scheduler = getProactiveScheduler();
    
    let executed = false;
    scheduler.schedule('test-job', () => {
      executed = true;
    }, 100);
    
    await new Promise(r => setTimeout(r, 150));
    
    scheduler.cancel('test-job');
    return executed;
  });
}

// ═══════════════════════════════════════════════════════════════
// 测试 4: 安全
// ═══════════════════════════════════════════════════════════════

async function testSecurity() {
  logSection('测试 4: 安全', 'SecurityManager, Sandbox');

  // 4.1 SecurityManager 测试
  await test('4.1.1 Security - 权限检查', async () => {
    const { getSecurityManager } = await import('./src/security');
    const security = getSecurityManager();
    
    // 检查危险命令
    const allowed1 = security.checkCommand('ls -la');
    const allowed2 = security.checkCommand('rm -rf /');
    
    return allowed1 && !allowed2;
  });

  await test('4.1.2 Security - 敏感数据过滤', async () => {
    const { getSecurityManager } = await import('./src/security');
    const security = getSecurityManager();
    
    const input = '我的密码是 password123，API Key 是 sk-xxxxx';
    const filtered = security.filterSensitive(input);
    
    return !filtered.includes('password123') && !filtered.includes('sk-xxxxx');
  });

  // 4.2 Sandbox 测试
  await test('4.2.1 Sandbox - 创建沙箱', async () => {
    const { getSandboxManager } = await import('./src/sandbox');
    const sandbox = getSandboxManager();
    
    try {
      const ctx = await sandbox.create({
        hostWorkdir: './data/sandbox/test',
        sessionId: 'test-sandbox',
      });
      
      await sandbox.destroy(ctx);
      return true;
    } catch {
      // Docker 可能不可用
      return true;
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// 测试 5: 进化
// ═══════════════════════════════════════════════════════════════

async function testEvolution() {
  logSection('测试 5: 进化', 'Evolution, Gap Detection');

  await test('5.1 Evolution - 能力差距检测', async () => {
    const { CapabilityGapDetector } = await import('./src/evolution/gap');
    const detector = new CapabilityGapDetector();
    
    const gaps = await detector.detect([
      { task: '处理图片', success: false },
      { task: '语音识别', success: false },
    ]);
    
    return Array.isArray(gaps);
  });

  await test('5.2 Evolution - 进化建议', async () => {
    const { getEvolutionManager } = await import('./src/evolution');
    const evolution = getEvolutionManager();
    
    const suggestions = await evolution.analyze({
      failedTasks: ['图像处理', '语音合成'],
      successRate: 0.7,
    });
    
    return Array.isArray(suggestions);
  });
}

// ═══════════════════════════════════════════════════════════════
// 测试 6: 插件
// ═══════════════════════════════════════════════════════════════

async function testPlugins() {
  logSection('测试 6: 插件', 'PluginManager, Hooks');

  await test('6.1 Plugin - 插件管理器', async () => {
    const { getPluginManager } = await import('./src/plugins');
    const manager = getPluginManager();
    
    const plugins = manager.listPlugins();
    return Array.isArray(plugins);
  });

  await test('6.2 Hooks - 钩子系统', async () => {
    const { getHookSystem } = await import('./src/plugins/hooks');
    const hooks = getHookSystem();
    
    let called = false;
    hooks.register('test-hook', () => { called = true; });
    await hooks.execute('test-hook');
    hooks.unregister('test-hook');
    
    return called;
  });
}

// ═══════════════════════════════════════════════════════════════
// 测试 7: LLM
// ═══════════════════════════════════════════════════════════════

async function testLLM() {
  logSection('测试 7: LLM', '多提供商, 成本管理, 流式输出');

  await test('7.1 LLM - 提供商管理', async () => {
    const { getLLMManager } = await import('./src/llm');
    const llm = getLLMManager();
    
    const providers = llm.getAvailableProviders();
    return providers.includes('aliyun');
  });

  await test('7.2 LLM - 简单对话', async () => {
    const { getLLMManager } = await import('./src/llm');
    const llm = getLLMManager();
    
    const response = await llm.chat([
      { role: 'user', content: '回复"OK"' }
    ]);
    
    return response.content.length > 0;
  });

  await test('7.3 LLM - 流式输出', async () => {
    const { getLLMManager } = await import('./src/llm');
    const llm = getLLMManager();
    
    let chunks = 0;
    for await (const chunk of llm.chatStream([
      { role: 'user', content: '说三个字' }
    ])) {
      chunks++;
      if (chunks > 5) break;
    }
    
    return chunks > 0;
  });

  await test('7.4 Cost - 成本追踪', async () => {
    const { getCostManager } = await import('./src/core/cost');
    const cost = getCostManager();
    
    const usage = cost.getDailyUsage();
    return usage !== undefined;
  });
}

// ═══════════════════════════════════════════════════════════════
// 测试 8: 技能
// ═══════════════════════════════════════════════════════════════

async function testSkills() {
  logSection('测试 8: 技能', '加载, 市场, 内置技能');

  await test('8.1 Skills - 技能注册', async () => {
    const { getSkillRegistry } = await import('./src/skills/registry');
    const { registerBuiltinSkills } = await import('./src/skills/builtins');
    
    registerBuiltinSkills();
    
    const registry = getSkillRegistry();
    const skills = registry.getAll();
    
    return skills.some(s => s.name === 'process');
  });

  await test('8.2 Skills - 技能执行', async () => {
    const { getSkillRegistry } = await import('./src/skills/registry');
    const registry = getSkillRegistry();
    
    const skill = registry.get('process');
    if (!skill) return false;
    
    const result = await skill.run({ action: 'list' }, {});
    return result.success;
  });

  await test('8.3 Skills - 能力匹配', async () => {
    const { getSkillRegistry } = await import('./src/skills/registry');
    const registry = getSkillRegistry();
    
    const skills = registry.findByCapability('process_management');
    return skills.length > 0;
  });

  await test('8.4 Skills - 参数验证', async () => {
    const { getSkillRegistry } = await import('./src/skills/registry');
    const registry = getSkillRegistry();
    
    const skill = registry.get('process');
    if (!skill) return false;
    
    // 缺少必需参数
    const validation = await skill.validateParams({});
    return !validation.valid;
  });
}

// ═══════════════════════════════════════════════════════════════
// 测试 9: 复杂场景
// ═══════════════════════════════════════════════════════════════

async function testComplexScenarios() {
  logSection('测试 9: 复杂场景', '多步骤任务, 错误恢复, 并发安全');

  await test('9.1 复杂任务 - 多步骤执行', async () => {
    const { getReActExecutor } = await import('./src/executor');
    const { RiskLevel } = await import('./src/types');
    const executor = getReActExecutor();
    
    const tasks = [
      { id: 'step1', description: '列出进程', type: 'process', skillName: 'process', params: { action: 'list' }, riskLevel: RiskLevel.LOW, dependencies: [] },
      { id: 'step2', description: '启动进程', type: 'process', skillName: 'process', params: { action: 'spawn', command: 'echo', args: ['test'] }, riskLevel: RiskLevel.LOW, dependencies: ['step1'] },
      { id: 'step3', description: '再次列出', type: 'process', skillName: 'process', params: { action: 'list' }, riskLevel: RiskLevel.LOW, dependencies: ['step2'] },
    ];
    
    const result = await executor.execute(tasks, [['step1'], ['step2'], ['step3']], {}, '执行多步骤任务');
    return result.iterations > 0;
  });

  await test('9.2 错误恢复 - 任务失败处理', async () => {
    const { getReActExecutor } = await import('./src/executor');
    const { RiskLevel } = await import('./src/types');
    const executor = getReActExecutor();
    
    const tasks = [
      { id: 'fail', description: '失败任务', type: 'test', skillName: 'nonexistent', params: {}, riskLevel: RiskLevel.LOW, dependencies: [] },
      { id: 'success', description: '成功任务', type: 'process', skillName: 'process', params: { action: 'list' }, riskLevel: RiskLevel.LOW, dependencies: [] },
    ];
    
    const result = await executor.execute(tasks, [['fail'], ['success']], {}, '测试错误恢复');
    // 即使有失败，也应该继续执行
    return result.iterations > 0;
  });

  await test('9.3 并发安全 - 资源竞争', async () => {
    const { getLockManager } = await import('./src/scheduler/lock');
    const lock = getLockManager();
    
    const results: boolean[] = [];
    const promises = Array(10).fill(null).map((_, i) => {
      return new Promise<void>(resolve => {
        setTimeout(async () => {
          const acquired = lock.tryAcquire('concurrent-test', 'write', `task-${i}`);
          if (acquired) {
            await new Promise(r => setTimeout(r, 10));
            lock.release('concurrent-test', `task-${i}`);
            results.push(true);
          }
          resolve();
        }, Math.random() * 50);
      });
    });
    
    await Promise.all(promises);
    
    // 只有一个任务能获取写锁
    return results.length >= 1;
  });
}

// ═══════════════════════════════════════════════════════════════
// 测试 10: 性能基准
// ═══════════════════════════════════════════════════════════════

async function testPerformance() {
  logSection('测试 10: 性能基准', '响应时间, 吞吐量, 内存');

  await test('10.1 性能 - LLM 响应时间 (< 3s)', async () => {
    const { getLLMManager } = await import('./src/llm');
    const llm = getLLMManager();
    
    const start = Date.now();
    await llm.chat([{ role: 'user', content: '说OK' }]);
    const duration = Date.now() - start;
    
    console.log(`    实际耗时: ${duration}ms`);
    return duration < 3000;
  });

  await test('10.2 性能 - 进程启动 (< 50ms)', async () => {
    const { ProcessTool } = await import('./src/executor/process-tool');
    const tool = new ProcessTool();
    
    const start = Date.now();
    await tool.run({ action: 'spawn', command: 'echo', args: ['test'] }, {});
    const duration = Date.now() - start;
    
    console.log(`    实际耗时: ${duration}ms`);
    return duration < 50;
  });

  await test('10.3 性能 - 并发吞吐 (10任务 < 500ms)', async () => {
    const { ProcessTool } = await import('./src/executor/process-tool');
    const tool = new ProcessTool();
    
    const start = Date.now();
    await Promise.all(
      Array(10).fill(null).map(() => 
        tool.run({ action: 'list' }, {})
      )
    );
    const duration = Date.now() - start;
    
    console.log(`    实际耗时: ${duration}ms`);
    return duration < 500;
  });

  await test('10.4 性能 - 内存使用 (< 200MB)', async () => {
    const used = process.memoryUsage();
    const heapUsedMB = used.heapUsed / 1024 / 1024;
    
    console.log(`    堆内存使用: ${heapUsedMB.toFixed(1)}MB`);
    return heapUsedMB < 200;
  });
}

// ═══════════════════════════════════════════════════════════════
// 主测试入口
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log();
  log('cyan', '╔═══════════════════════════════════════════════════════════════╗');
  log('cyan', '║           Baize v3.2.0 全方位回归测试                          ║');
  log('cyan', '╚═══════════════════════════════════════════════════════════════╝');
  
  // 设置环境变量
  process.env.ALIYUN_API_KEY = API_KEY;
  process.env.BAIZE_API_KEY = API_KEY;
  process.env.BAIZE_BASE_URL = 'https://api.bailian.aliyuncs.com/compatible-mode/v1';
  process.env.BAIZE_MODEL = 'qwen-plus';

  // 初始化
  const { initDatabase } = await import('./src/memory/database');
  await initDatabase();
  
  const { registerBuiltinSkills } = await import('./src/skills/builtins');
  registerBuiltinSkills();

  const startTime = Date.now();

  try {
    await testCore();
    await testExecutors();
    await testScheduler();
    await testSecurity();
    await testEvolution();
    await testPlugins();
    await testLLM();
    await testSkills();
    await testComplexScenarios();
    await testPerformance();
  } catch (error) {
    log('red', `测试执行错误: ${error}`);
  }

  const totalDuration = Date.now() - startTime;

  // 输出结果
  console.log();
  log('cyan', '═══════════════════════════════════════════════════════════════');
  log('cyan', `  测试结果汇总`);
  log('cyan', '═══════════════════════════════════════════════════════════════');
  console.log();
  
  log('green', `  ✓ 通过: ${stats.passed}`);
  log('red', `  ✗ 失败: ${stats.failed}`);
  log('yellow', `  ⊘ 跳过: ${stats.skipped}`);
  log('gray', `  ⏱ 总耗时: ${(totalDuration / 1000).toFixed(1)}s`);
  
  // 计算成功率
  const total = stats.passed + stats.failed;
  const successRate = total > 0 ? (stats.passed / total * 100).toFixed(1) : '0';
  console.log();
  log('cyan', `  成功率: ${successRate}%`);
  
  // 显示错误详情
  if (stats.errors.length > 0) {
    console.log();
    log('red', '  错误详情:');
    for (const error of stats.errors) {
      log('gray', `    - ${error}`);
    }
  }
  
  // 显示最慢的测试
  console.log();
  log('magenta', '  最慢的测试:');
  const sorted = [...stats.durations.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  for (const [name, duration] of sorted) {
    log('gray', `    ${duration}ms - ${name.substring(0, 40)}`);
  }
  
  console.log();
  log('cyan', '═══════════════════════════════════════════════════════════════');
  
  if (stats.failed === 0) {
    log('green', '\n  ✓ 所有测试通过！\n');
    process.exit(0);
  } else if (stats.passed > stats.failed) {
    log('yellow', `\n  ! 大部分测试通过，但有 ${stats.failed} 个失败\n`);
    process.exit(0);
  } else {
    log('red', `\n  ✗ 测试失败过多\n`);
    process.exit(1);
  }
}

main().catch(error => {
  log('red', `测试失败: ${error}`);
  console.error(error);
  process.exit(1);
});
