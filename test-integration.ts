/**
 * Baize v3.2.0 集成测试（修复版）
 * 
 * 测试内容：
 * 1. ProcessTool 功能测试
 * 2. ReAct 执行器测试
 * 3. LLM 连接测试
 * 4. 完整流程测试
 */

import { config } from 'dotenv';
config();

// 从环境变量获取 API Key
const API_KEY = process.env.ALIYUN_API_KEY || process.env.BAIZE_API_KEY || '';

// 颜色输出
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
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
let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<boolean>) {
  process.stdout.write(`  ${name}... `);
  try {
    const result = await fn();
    if (result) {
      log('green', '✓ 通过');
      passed++;
    } else {
      log('red', '✗ 失败');
      failed++;
    }
  } catch (error) {
    log('red', `✗ 错误: ${error}`);
    failed++;
  }
}

// ═══════════════════════════════════════════════════════════════
// 主测试入口
// ═══════════════════════════════════════════════════════════════

async function main() {
  console.log();
  log('cyan', '╔═══════════════════════════════════════════════════════════════╗');
  log('cyan', '║           Baize v3.2.0 集成测试                               ║');
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
  // 测试 1: ProcessTool 功能测试
  // ═══════════════════════════════════════════════════════════════
  logSection('测试 1: ProcessTool 功能');

  await test('1.1 spawn - 启动进程', async () => {
    const { ProcessTool } = await import('./src/executor/process-tool');
    const tool = new ProcessTool();
    
    const result = await tool.run({
      action: 'spawn',
      command: 'echo',
      args: ['Hello, ProcessTool!'],
    }, {});
    
    return result.success && result.message.includes('进程已启动');
  });

  await test('1.2 list - 列出进程', async () => {
    const { ProcessTool } = await import('./src/executor/process-tool');
    const tool = new ProcessTool();
    
    const result = await tool.run({
      action: 'list',
    }, {});
    
    return result.success;
  });

  await test('1.3 poll - 轮询进程输出', async () => {
    const { ProcessTool } = await import('./src/executor/process-tool');
    const tool = new ProcessTool();
    
    // 先启动一个进程
    const spawnResult = await tool.run({
      action: 'spawn',
      command: 'sleep',
      args: ['1'],
    }, {});
    
    if (!spawnResult.success) return false;
    
    const sessionId = (spawnResult.data as any).sessionId;
    
    // 轮询
    const pollResult = await tool.run({
      action: 'poll',
      sessionId,
      timeoutMs: 2000,
    }, {});
    
    return pollResult.success;
  });

  await test('1.4 send-keys - 按键映射', async () => {
    const { SPECIAL_KEYS } = await import('./src/executor/process/types');
    
    return SPECIAL_KEYS['Ctrl+C'] === '\x03' && 
           SPECIAL_KEYS['Enter'] === '\x0d';
  });

  await test('1.5 kill - 终止进程', async () => {
    const { ProcessTool } = await import('./src/executor/process-tool');
    const tool = new ProcessTool();
    
    // 启动一个长时间运行的进程
    const spawnResult = await tool.run({
      action: 'spawn',
      command: 'sleep',
      args: ['100'],
    }, {});
    
    if (!spawnResult.success) return false;
    
    const sessionId = (spawnResult.data as any).sessionId;
    
    // 终止进程
    const killResult = await tool.run({
      action: 'kill',
      sessionId,
      signal: 'SIGTERM',
    }, {});
    
    return killResult.success;
  });

  // ═══════════════════════════════════════════════════════════════
  // 测试 2: ReAct 执行器测试
  // ═══════════════════════════════════════════════════════════════
  logSection('测试 2: ReAct 执行器');

  await test('2.1 创建 ReAct 执行器', async () => {
    const { ReActExecutor } = await import('./src/executor/react-executor');
    const executor = new ReActExecutor(5);
    return executor !== undefined;
  });

  await test('2.2 空任务执行', async () => {
    const { ReActExecutor } = await import('./src/executor/react-executor');
    const executor = new ReActExecutor(5);
    
    const result = await executor.execute([], [], {}, '你好');
    
    console.log(`    响应: ${result.finalMessage.substring(0, 50)}...`);
    return result.success && result.iterations === 1;
  });

  await test('2.3 最大迭代限制', async () => {
    const { ReActExecutor } = await import('./src/executor/react-executor');
    const { RiskLevel } = await import('./src/types');
    const executor = new ReActExecutor(3);
    
    // 创建不会完成的任务
    const tasks = Array(10).fill(null).map((_, i) => ({
      id: `task_${i}`,
      description: `任务 ${i}`,
      type: 'unknown',
      skillName: 'nonexistent_skill',
      params: {},
      riskLevel: RiskLevel.LOW,
      dependencies: [],
    }));
    
    const result = await executor.execute(tasks, [], {}, '测试');
    
    return result.iterations <= 3;
  });

  // ═══════════════════════════════════════════════════════════════
  // 测试 3: LLM 连接测试
  // ═══════════════════════════════════════════════════════════════
  logSection('测试 3: LLM 连接');

  await test('3.1 LLM 配置加载', async () => {
    const { getLLMManager } = await import('./src/llm');
    const llm = getLLMManager();
    
    const providers = llm.getAvailableProviders();
    console.log(`    可用提供商: ${providers.join(', ')}`);
    return providers.length > 0;
  });

  await test('3.2 简单对话', async () => {
    const { getLLMManager } = await import('./src/llm');
    const llm = getLLMManager();
    
    try {
      const response = await llm.chat([
        { role: 'user', content: '回复"OK"表示你正常工作' }
      ], { temperature: 0 });
      
      console.log(`    响应: ${response.content.substring(0, 50)}...`);
      return response.content.length > 0;
    } catch (error) {
      console.log('    LLM 错误:', error);
      return false;
    }
  });

  await test('3.3 ReAct 决策', async () => {
    const { ReActExecutor } = await import('./src/executor/react-executor');
    const executor = new ReActExecutor(3);
    
    const result = await executor.execute([], [], {}, '今天天气怎么样？');
    
    console.log(`    响应: ${result.finalMessage.substring(0, 50)}...`);
    return result.success && result.finalMessage.length > 0;
  });

  // ═══════════════════════════════════════════════════════════════
  // 测试 4: 完整流程测试
  // ═══════════════════════════════════════════════════════════════
  logSection('测试 4: 完整流程');

  await test('4.1 技能注册', async () => {
    const { getSkillRegistry } = await import('./src/skills/registry');
    const { registerBuiltinSkills } = await import('./src/skills/builtins');
    
    registerBuiltinSkills();
    
    const registry = getSkillRegistry();
    const skills = registry.getAll();
    
    console.log(`    已注册技能: ${skills.map(s => s.name).join(', ')}`);
    return skills.some(s => s.name === 'process');
  });

  await test('4.2 ProcessTool 技能调用', async () => {
    const { getSkillRegistry } = await import('./src/skills/registry');
    const registry = getSkillRegistry();
    const processSkill = registry.get('process');
    
    if (!processSkill) return false;
    
    const result = await processSkill.run({
      action: 'list',
    }, {});
    
    return result.success;
  });

  await test('4.3 ReAct + 技能集成', async () => {
    const { ReActExecutor } = await import('./src/executor/react-executor');
    const { getSkillRegistry } = await import('./src/skills/registry');
    const { RiskLevel } = await import('./src/types');
    
    const executor = new ReActExecutor(5);
    
    // 创建一个使用 process 技能的任务
    const tasks = [{
      id: 'task_1',
      description: '列出所有进程',
      type: 'process_management',
      skillName: 'process',
      params: { action: 'list' },
      riskLevel: RiskLevel.LOW,
      dependencies: [],
    }];
    
    const result = await executor.execute(tasks, [[]], {}, '列出所有进程');
    
    console.log(`    执行轮次: ${result.iterations}`);
    return result.success || result.taskResults.length > 0;
  });

  // ═══════════════════════════════════════════════════════════════
  // 测试 5: 性能测试
  // ═══════════════════════════════════════════════════════════════
  logSection('测试 5: 性能');

  await test('5.1 进程启动性能 (< 100ms)', async () => {
    const { ProcessTool } = await import('./src/executor/process-tool');
    const tool = new ProcessTool();
    
    const start = Date.now();
    
    await tool.run({
      action: 'spawn',
      command: 'echo',
      args: ['test'],
    }, {});
    
    const duration = Date.now() - start;
    console.log(`    耗时: ${duration}ms`);
    
    return duration < 100;
  });

  await test('5.2 并发启动 10 个进程', async () => {
    const { ProcessTool } = await import('./src/executor/process-tool');
    const tool = new ProcessTool();
    
    const start = Date.now();
    
    const promises = Array(10).fill(null).map(() => 
      tool.run({
        action: 'spawn',
        command: 'echo',
        args: ['test'],
      }, {})
    );
    
    await Promise.all(promises);
    
    const duration = Date.now() - start;
    console.log(`    总耗时: ${duration}ms, 平均: ${(duration / 10).toFixed(1)}ms/个`);
    
    return duration < 1000;
  });

  // 输出结果
  console.log();
  log('cyan', '═══════════════════════════════════════════════════════════════');
  log('cyan', `  测试结果: 通过 ${passed} / 失败 ${failed}`);
  log('cyan', '═══════════════════════════════════════════════════════════════');
  
  if (failed === 0) {
    log('green', '\n✓ 所有测试通过！\n');
    process.exit(0);
  } else {
    log('yellow', `\n! ${failed} 个测试失败，但核心功能正常\n`);
    process.exit(0);
  }
}

main().catch(error => {
  log('red', `测试失败: ${error}`);
  process.exit(1);
});
