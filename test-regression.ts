/**
 * Baize v3.2.0 全方位回归测试（优化版）
 * 
 * 减少不必要的 LLM 调用，专注于功能验证
 */

import { config } from 'dotenv';
config();

const API_KEY = 'sk-b6cd77165fb14c03afb493470ff314f8';

// 颜色输出
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
  reset: '\x1b[0m',
};

function log(color: keyof typeof colors, message: string) {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title: string) {
  console.log();
  log('cyan', `═══════════════════════════════════════════════════════════════`);
  log('cyan', `  ${title}`);
  log('cyan', `═══════════════════════════════════════════════════════════════`);
}

// 测试结果统计
interface TestResult {
  name: string;
  passed: boolean;
  duration?: number;
  message?: string;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<{ passed: boolean; message?: string; duration?: number }>) {
  const startTime = Date.now();
  process.stdout.write(`  ${name}... `);
  
  try {
    const result = await fn();
    const duration = Date.now() - startTime;
    
    results.push({ name, passed: result.passed, duration, message: result.message });
    
    if (result.passed) {
      log('green', `✓ (${duration}ms)`);
    } else {
      log('red', `✗ (${duration}ms)`);
      if (result.message) log('yellow', `    ${result.message}`);
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);
    
    results.push({ name, passed: false, duration, message: errorMsg });
    log('red', `✗ 错误 (${duration}ms)`);
    log('yellow', `    ${errorMsg}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// 主测试入口
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log();
  log('cyan', '╔═══════════════════════════════════════════════════════════════╗');
  log('cyan', '║        Baize v3.2.0 全方位回归测试                             ║');
  log('cyan', '╚═══════════════════════════════════════════════════════════════╝');
  
  // 设置环境变量
  process.env.ALIYUN_API_KEY = API_KEY;
  process.env.BAIZE_API_KEY = API_KEY;
  process.env.BAIZE_BASE_URL = 'https://api.bailian.aliyuncs.com/compatible-mode/v1';
  process.env.BAIZE_MODEL = 'qwen-plus';

  // 初始化数据库
  const { initDatabase } = await import('./src/memory/database');
  await initDatabase();

  // ═══════════════════════════════════════════════════════════════
  // 测试 1: 简单任务耗时
  // ═══════════════════════════════════════════════════════════════
  logSection('测试 1: 简单任务耗时');

  await test('1.1 进程启动 (< 50ms)', async () => {
    const { ProcessTool } = await import('./src/executor/process-tool');
    const tool = new ProcessTool();
    const start = Date.now();
    const result = await tool.run({ action: 'spawn', command: 'echo', args: ['test'] }, {});
    const duration = Date.now() - start;
    return { passed: result.success && duration < 50, message: `${duration}ms`, duration };
  });

  await test('1.2 记忆存储 (< 50ms)', async () => {
    const { getMemory } = await import('./src/memory');
    const memory = getMemory();
    const start = Date.now();
    memory.recordEpisode('test', '测试记忆');
    const duration = Date.now() - start;
    return { passed: duration < 50, message: `${duration}ms`, duration };
  });

  await test('1.3 技能查询 (< 5ms)', async () => {
    const { getSkillRegistry } = await import('./src/skills/registry');
    const { registerBuiltinSkills } = await import('./src/skills/builtins');
    registerBuiltinSkills();
    const registry = getSkillRegistry();
    const start = Date.now();
    const skills = registry.getAll();
    const duration = Date.now() - start;
    return { passed: skills.length > 0 && duration < 5, message: `${skills.length}个技能, ${duration}ms`, duration };
  });

  // ═══════════════════════════════════════════════════════════════
  // 测试 2: ProcessTool 功能
  // ═══════════════════════════════════════════════════════════════
  logSection('测试 2: ProcessTool 功能');

  await test('2.1 spawn - 启动进程', async () => {
    const { ProcessTool } = await import('./src/executor/process-tool');
    const tool = new ProcessTool();
    const result = await tool.run({ action: 'spawn', command: 'echo', args: ['hello'] }, {});
    return { passed: result.success, message: result.message };
  });

  await test('2.2 list - 列出进程', async () => {
    const { ProcessTool } = await import('./src/executor/process-tool');
    const tool = new ProcessTool();
    const result = await tool.run({ action: 'list' }, {});
    return { passed: result.success, message: result.message?.substring(0, 50) };
  });

  await test('2.3 poll - 轮询输出', async () => {
    const { ProcessTool } = await import('./src/executor/process-tool');
    const tool = new ProcessTool();
    const spawn = await tool.run({ action: 'spawn', command: 'sleep', args: ['1'] }, {});
    if (!spawn.success) return { passed: false, message: '启动失败' };
    const sessionId = (spawn.data as any).sessionId;
    const result = await tool.run({ action: 'poll', sessionId, timeoutMs: 1000 }, {});
    return { passed: result.success, message: `状态: ${(result.data as any)?.state}` };
  });

  await test('2.4 kill - 终止进程', async () => {
    const { ProcessTool } = await import('./src/executor/process-tool');
    const tool = new ProcessTool();
    const spawn = await tool.run({ action: 'spawn', command: 'sleep', args: ['100'] }, {});
    if (!spawn.success) return { passed: false, message: '启动失败' };
    const sessionId = (spawn.data as any).sessionId;
    const result = await tool.run({ action: 'kill', sessionId }, {});
    return { passed: result.success, message: result.message };
  });

  await test('2.5 send-keys - 按键映射', async () => {
    const { SPECIAL_KEYS } = await import('./src/executor/process/types');
    return { passed: SPECIAL_KEYS['Ctrl+C'] === '\x03' && SPECIAL_KEYS['Enter'] === '\x0d', message: '映射正确' };
  });

  // ═══════════════════════════════════════════════════════════════
  // 测试 3: ReAct 执行器
  // ═══════════════════════════════════════════════════════════════
  logSection('测试 3: ReAct 执行器');

  await test('3.1 创建执行器', async () => {
    const { ReActExecutor } = await import('./src/executor/react-executor');
    const executor = new ReActExecutor(5);
    return { passed: executor !== undefined, message: '创建成功' };
  });

  await test('3.2 空任务执行', async () => {
    const { ReActExecutor } = await import('./src/executor/react-executor');
    const executor = new ReActExecutor(3);
    const result = await executor.execute([], [], {}, '你好');
    return { passed: result.success && result.iterations === 1, message: result.finalMessage.substring(0, 30) };
  });

  await test('3.3 最大迭代限制', async () => {
    const { ReActExecutor } = await import('./src/executor/react-executor');
    const { RiskLevel } = await import('./src/types');
    const executor = new ReActExecutor(2);
    const tasks = Array(5).fill(null).map((_, i) => ({
      id: `t${i}`, description: `任务${i}`, type: 'unknown', skillName: 'nonexistent', params: {}, riskLevel: RiskLevel.LOW, dependencies: [],
    }));
    const result = await executor.execute(tasks, [], {}, '测试');
    return { passed: result.iterations <= 2, message: `迭代${result.iterations}次` };
  });

  // ═══════════════════════════════════════════════════════════════
  // 测试 4: 记忆功能
  // ═══════════════════════════════════════════════════════════════
  logSection('测试 4: 记忆功能');

  await test('4.1 短期记忆', async () => {
    const { getMemory } = await import('./src/memory');
    const memory = getMemory();
    memory.recordEpisode('test', '测试记忆A');
    memory.recordEpisode('test', '测试记忆B');
    const recent = memory.getEpisodes('test', 10);
    const hasA = recent.some(e => e.content.includes('A'));
    return { passed: hasA, message: `找到${recent.length}条记忆` };
  });

  await test('4.2 技能信任记录', async () => {
    const { getMemory } = await import('./src/memory');
    const memory = getMemory();
    // 先清除之前的记录
    const before = memory.getTrustRecord('test_skill_reg');
    // 记录新的成功和失败
    memory.recordSuccess('test_skill_reg');
    memory.recordSuccess('test_skill_reg');
    memory.recordFailure('test_skill_reg');
    const record = memory.getTrustRecord('test_skill_reg');
    const passed = record && record.successCount >= 2 && record.failureCount >= 1;
    return { passed, message: `成功${record?.successCount}失败${record?.failureCount}` };
  });

  await test('4.3 用户偏好', async () => {
    const { getMemory } = await import('./src/memory');
    const memory = getMemory();
    memory.setPreference('lang', 'zh');
    const lang = memory.getPreference('lang');
    return { passed: lang === 'zh', message: `语言: ${lang}` };
  });

  // ═══════════════════════════════════════════════════════════════
  // 测试 5: 并行安全
  // ═══════════════════════════════════════════════════════════════
  logSection('测试 5: 并行安全');

  await test('5.1 并发进程启动', async () => {
    const { ProcessTool } = await import('./src/executor/process-tool');
    const tool = new ProcessTool();
    const start = Date.now();
    const promises = Array(10).fill(null).map((_, i) => 
      tool.run({ action: 'spawn', command: 'echo', args: [`test${i}`] }, {})
    );
    const results = await Promise.all(promises);
    const duration = Date.now() - start;
    const allSuccess = results.every(r => r.success);
    return { passed: allSuccess && duration < 500, message: `全部成功, ${duration}ms`, duration };
  });

  await test('5.2 资源锁', async () => {
    const { getLockManager } = await import('./src/scheduler/lock');
    const lockManager = getLockManager();
    const a1 = lockManager.tryAcquire('test_res', 'write', 'h1');
    const a2 = lockManager.tryAcquire('test_res', 'write', 'h2');
    lockManager.release('test_res', 'h1');
    const a3 = lockManager.tryAcquire('test_res', 'write', 'h2');
    lockManager.release('test_res', 'h2');
    return { passed: a1 && !a2 && a3, message: `获取1:${a1} 获取2:${a2} 获取3:${a3}` };
  });

  // ═══════════════════════════════════════════════════════════════
  // 测试 6: 进化功能
  // ═══════════════════════════════════════════════════════════════
  logSection('测试 6: 进化功能');

  await test('6.1 进化管理器', async () => {
    const { getEvolutionManager } = await import('./src/evolution');
    const evolution = getEvolutionManager();
    return { passed: evolution !== undefined, message: '已初始化' };
  });

  await test('6.2 角色团队', async () => {
    const { getRoleTeamManager } = await import('./src/evolution');
    const team = getRoleTeamManager();
    return { passed: team !== undefined, message: '已初始化' };
  });

  await test('6.3 权限管理', async () => {
    const { getPermissionManager } = await import('./src/evolution');
    const perm = getPermissionManager();
    return { passed: perm !== undefined, message: '已初始化' };
  });

  // ═══════════════════════════════════════════════════════════════
  // 测试 7: 插件系统
  // ═══════════════════════════════════════════════════════════════
  logSection('测试 7: 插件系统');

  await test('7.1 插件管理器', async () => {
    const { getPluginManager } = await import('./src/plugins');
    const plugins = getPluginManager();
    return { passed: plugins !== undefined, message: '已初始化' };
  });

  // ═══════════════════════════════════════════════════════════════
  // 测试 8: 技能市场
  // ═══════════════════════════════════════════════════════════════
  logSection('测试 8: 技能市场');

  await test('8.1 ClawHub 客户端', async () => {
    const { getClawHubClient } = await import('./src/skills/market');
    const client = getClawHubClient();
    return { passed: client !== undefined, message: '已初始化' };
  });

  await test('8.2 技能加载器', async () => {
    const { SkillLoader } = await import('./src/skills/loader');
    const loader = new SkillLoader();
    const skills = await loader.loadAll();
    return { passed: Array.isArray(skills), message: `加载${skills.length}个技能` };
  });

  // ═══════════════════════════════════════════════════════════════
  // 测试 9: 沙箱隔离
  // ═══════════════════════════════════════════════════════════════
  logSection('测试 9: 沙箱隔离');

  await test('9.1 沙箱管理器', async () => {
    const { getSandboxManager } = await import('./src/sandbox');
    const sandbox = getSandboxManager();
    return { passed: sandbox !== undefined, message: '已初始化' };
  });

  // ═══════════════════════════════════════════════════════════════
  // 测试 10: 错误恢复
  // ═══════════════════════════════════════════════════════════════
  logSection('测试 10: 错误恢复');

  await test('10.1 错误恢复管理器', async () => {
    const { getRecoveryManager } = await import('./src/core/recovery');
    const recovery = getRecoveryManager();
    return { passed: recovery !== undefined, message: '已初始化' };
  });

  // ═══════════════════════════════════════════════════════════════
  // 测试 11: 成本控制
  // ═══════════════════════════════════════════════════════════════
  logSection('测试 11: 成本控制');

  await test('11.1 成本管理器', async () => {
    const { getCostManager } = await import('./src/core/cost');
    const cost = getCostManager();
    return { passed: cost !== undefined, message: '已初始化' };
  });

  // ═══════════════════════════════════════════════════════════════
  // 测试 12: 安全系统
  // ═══════════════════════════════════════════════════════════════
  logSection('测试 12: 安全系统');

  await test('12.1 安全管理器', async () => {
    const { getSecurityManager } = await import('./src/security');
    const security = getSecurityManager();
    return { passed: security !== undefined, message: '已初始化' };
  });

  // ═══════════════════════════════════════════════════════════════
  // 测试 13: LLM 连接
  // ═══════════════════════════════════════════════════════════════
  logSection('测试 13: LLM 连接');

  await test('13.1 LLM 配置', async () => {
    const { getLLMManager } = await import('./src/llm');
    const llm = getLLMManager();
    const providers = llm.getAvailableProviders();
    return { passed: providers.length > 0, message: `提供商: ${providers.join(', ')}` };
  });

  await test('13.2 简单对话', async () => {
    const { getLLMManager } = await import('./src/llm');
    const llm = getLLMManager();
    const response = await llm.chat([{ role: 'user', content: '回复OK' }]);
    return { passed: response.content.length > 0, message: response.content.substring(0, 20) };
  });

  // ═══════════════════════════════════════════════════════════════
  // 测试报告
  // ═══════════════════════════════════════════════════════════════
  logSection('测试报告');
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const totalDuration = results.reduce((sum, r) => sum + (r.duration || 0), 0);
  
  console.log();
  log('cyan', `总测试数: ${results.length}`);
  log('green', `通过: ${passed}`);
  log('red', `失败: ${failed}`);
  log('gray', `总耗时: ${(totalDuration / 1000).toFixed(2)}s`);
  
  if (failed > 0) {
    console.log();
    log('red', '失败详情:');
    results.filter(r => !r.passed).forEach(r => {
      log('yellow', `  ✗ ${r.name}: ${r.message || '未知错误'}`);
    });
  }
  
  console.log();
  log('cyan', '═══════════════════════════════════════════════════════════════');
  
  if (failed === 0) {
    log('green', '\n✓ 所有测试通过！\n');
  } else {
    const rate = (passed / results.length * 100).toFixed(0);
    log('yellow', `\n! 通过率: ${rate}%\n`);
  }
  
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(error => {
  log('red', `测试失败: ${error}`);
  process.exit(1);
});
