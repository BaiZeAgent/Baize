/**
 * 白泽 OpenClaw 风格改造测试
 * 
 * 测试场景：
 * 1. 基础对话
 * 2. 记忆系统
 * 3. 任务执行
 * 4. 技能市场
 * 5. Web 服务
 */

import chalk from 'chalk';
import { initDatabase, getDatabase } from './src/memory/database';
import { getLLMManager } from './src/llm';
import { getSkillRegistry } from './src/skills/registry';
import { registerBuiltinSkills } from './src/skills/builtins';
import { SkillLoader } from './src/skills/loader';
import { getMemory } from './src/memory';
import { getBrainV2 } from './src/core/brain/brain-v2';
import { getReActExecutorV2 } from './src/executor/react-executor-v2';
import { getVectorSearch } from './src/memory/vector';
import { getClawHubClient } from './src/skills/market';
import { getLogger } from './src/observability/logger';

const logger = getLogger('test');

// ═══════════════════════════════════════════════════════════════
// 测试结果统计
// ═══════════════════════════════════════════════════════════════

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  duration: number;
}

const results: TestResult[] = [];

async function runTest(
  name: string,
  testFn: () => Promise<string>
): Promise<void> {
  const startTime = Date.now();
  process.stdout.write(chalk.cyan(`\n▶ ${name}...`));
  
  try {
    const message = await testFn();
    const duration = Date.now() - startTime;
    results.push({ name, passed: true, message, duration });
    console.log(chalk.green(` ✓`) + chalk.gray(` (${duration}ms)`));
    console.log(chalk.gray(`  ${message}`));
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, message: errorMsg, duration });
    console.log(chalk.red(` ✗`) + chalk.gray(` (${duration}ms)`));
    console.log(chalk.red(`  ${errorMsg}`));
  }
}

// ═══════════════════════════════════════════════════════════════
// 初始化
// ═══════════════════════════════════════════════════════════════

async function initialize(): Promise<void> {
  console.log(chalk.cyan('\n═══════════════════════════════════════════════════════════════'));
  console.log(chalk.cyan('           白泽 OpenClaw 风格改造测试'));
  console.log(chalk.cyan('═══════════════════════════════════════════════════════════════\n'));

  console.log(chalk.gray('初始化系统...'));
  
  // 初始化数据库
  await initDatabase();
  console.log(chalk.gray('  ✓ 数据库已初始化'));
  
  // 初始化 LLM
  const llm = getLLMManager();
  const providers = llm.getAvailableProviders();
  console.log(chalk.gray(`  ✓ LLM 提供商: ${providers.join(', ')}`));
  
  // 注册内置技能
  registerBuiltinSkills();
  console.log(chalk.gray('  ✓ 内置技能已注册'));
  
  // 加载外部技能
  const loader = new SkillLoader();
  const skills = await loader.loadAll();
  const registry = getSkillRegistry();
  for (const skill of skills) {
    registry.register(skill);
  }
  console.log(chalk.gray(`  ✓ 已加载 ${skills.length} 个外部技能`));
  
  console.log();
}

// ═══════════════════════════════════════════════════════════════
// 测试场景
// ═══════════════════════════════════════════════════════════════

async function testBasicConversation(): Promise<void> {
  console.log(chalk.cyan('\n【场景 1: 基础对话】'));
  
  await runTest('简单问候', async () => {
    const brain = getBrainV2();
    const decision = await brain.process('你好');
    return `意图: ${decision.intent}, 回复: ${decision.response?.slice(0, 50)}...`;
  });

  await runTest('复杂问题', async () => {
    const brain = getBrainV2();
    const decision = await brain.process('请解释一下什么是 ReAct 模式');
    return `意图: ${decision.intent}, 回复长度: ${decision.response?.length || 0}`;
  });

  await runTest('多轮对话', async () => {
    const brain = getBrainV2();
    await brain.process('我叫张三');
    const decision = await brain.process('我叫什么名字？');
    return `回复: ${decision.response?.slice(0, 50)}...`;
  });
}

async function testMemorySystem(): Promise<void> {
  console.log(chalk.cyan('\n【场景 2: 记忆系统】'));
  
  await runTest('情景记忆', async () => {
    const memory = getMemory();
    const id = memory.recordEpisode('test', '测试情景记忆');
    const episodes = memory.getEpisodes('test', 1);
    return `记录ID: ${id}, 最新记录: ${episodes[0]?.content}`;
  });

  await runTest('声明式记忆', async () => {
    const memory = getMemory();
    memory.remember('test_key', 'test_value', 0.9);
    const result = memory.recall('test_key');
    return `存储并回忆: ${result?.value}, 置信度: ${result?.confidence}`;
  });

  await runTest('偏好记忆', async () => {
    const memory = getMemory();
    memory.setPreference('language', '中文');
    const pref = memory.getPreference('language');
    return `语言偏好: ${pref}`;
  });

  await runTest('信任记录', async () => {
    const memory = getMemory();
    memory.recordSuccess('test_operation');
    const record = memory.getTrustRecord('test_operation');
    return `成功次数: ${record?.successCount}, 可跳过确认: ${record?.skipConfirm}`;
  });

  await runTest('向量搜索', async () => {
    const vectorSearch = getVectorSearch();
    
    // 添加测试向量
    await vectorSearch.add('test_vec_1', '这是一个测试文档', { type: 'test' });
    
    // 搜索
    const results = await vectorSearch.search('测试', { limit: 3 });
    return `搜索结果数: ${results.length}, 最相关: ${results[0]?.id}`;
  });
}

async function testTaskExecution(): Promise<void> {
  console.log(chalk.cyan('\n【场景 3: 任务执行】'));
  
  await runTest('技能列表', async () => {
    const registry = getSkillRegistry();
    const skills = registry.getAll();
    return `已注册技能: ${skills.map((s: any) => s.name).join(', ')}`;
  });

  await runTest('ProcessTool 可用性', async () => {
    const registry = getSkillRegistry();
    const processSkill = registry.get('process');
    if (!processSkill) {
      throw new Error('ProcessTool 未注册');
    }
    return `ProcessTool 已注册, 描述: ${processSkill.description.slice(0, 50)}...`;
  });

  await runTest('ReAct 执行器', async () => {
    const executor = getReActExecutorV2();
    const result = await executor.execute([], [], {}, '你好');
    return `执行成功: ${result.success}, 迭代次数: ${result.iterations}`;
  });

  await runTest('流式处理', async () => {
    const brain = getBrainV2();
    let eventCount = 0;
    let contentLength = 0;
    
    for await (const event of brain.processStream('你好，请简单介绍一下自己', 'test')) {
      eventCount++;
      if (event.type === 'content') {
        contentLength += (event.data as any).text?.length || 0;
      }
    }
    
    return `事件数: ${eventCount}, 内容长度: ${contentLength}`;
  });
}

async function testSkillMarket(): Promise<void> {
  console.log(chalk.cyan('\n【场景 4: 技能市场】'));
  
  await runTest('ClawHub 连接', async () => {
    const client = getClawHubClient();
    // 测试连接（可能失败，因为需要网络）
    try {
      const results = await client.search('test');
      return `搜索结果: ${results.length} 个`;
    } catch (error) {
      return 'ClawHub 连接测试（需要网络）';
    }
  });

  await runTest('技能信息', async () => {
    const registry = getSkillRegistry();
    const skills = registry.getAll();
    const skillInfo = skills.map((s: any) => ({
      name: s.name,
      capabilities: s.capabilities.slice(0, 2),
    }));
    return `技能信息: ${JSON.stringify(skillInfo[0])}`;
  });
}

async function testErrorRecovery(): Promise<void> {
  console.log(chalk.cyan('\n【场景 5: 错误恢复】'));
  
  await runTest('不存在的技能', async () => {
    const brain = getBrainV2();
    const decision = await brain.process('请使用不存在的技能 xyz');
    return `处理结果: ${decision.intent}, 回复长度: ${decision.response?.length || 0}`;
  });

  await runTest('无效参数', async () => {
    const registry = getSkillRegistry();
    const processSkill = registry.get('process');
    if (!processSkill) {
      return 'ProcessTool 未注册，跳过';
    }
    
    const validation = await processSkill.validateParams({ action: 'invalid_action' });
    return `验证结果: ${validation.valid ? '通过' : '失败 - ' + validation.error}`;
  });

  await runTest('超时恢复', async () => {
    // 模拟超时场景
    const brain = getBrainV2();
    const decision = await brain.process('这是一个测试超时恢复的问题');
    return `处理完成: ${decision.intent}`;
  });
}

async function testContextManagement(): Promise<void> {
  console.log(chalk.cyan('\n【场景 6: 上下文管理】'));
  
  await runTest('历史记录', async () => {
    const brain = getBrainV2();
    brain.clearHistory();
    
    await brain.process('第一条消息');
    await brain.process('第二条消息');
    await brain.process('第三条消息');
    
    const history = brain.getHistory();
    return `历史记录数: ${history.length}`;
  });

  await runTest('历史清空', async () => {
    const brain = getBrainV2();
    brain.clearHistory();
    const history = brain.getHistory();
    return `清空后历史数: ${history.length}`;
  });

  await runTest('长对话处理', async () => {
    const brain = getBrainV2();
    brain.clearHistory();
    
    // 模拟长对话
    for (let i = 0; i < 5; i++) {
      await brain.process(`这是第 ${i + 1} 条消息`);
    }
    
    const history = brain.getHistory();
    return `长对话历史: ${history.length} 条`;
  });
}

// ═══════════════════════════════════════════════════════════════
// 主函数
// ═══════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  try {
    await initialize();
    
    // 运行所有测试
    await testBasicConversation();
    await testMemorySystem();
    await testTaskExecution();
    await testSkillMarket();
    await testErrorRecovery();
    await testContextManagement();
    
    // 输出结果汇总
    console.log(chalk.cyan('\n═══════════════════════════════════════════════════════════════'));
    console.log(chalk.cyan('                      测试结果汇总'));
    console.log(chalk.cyan('═══════════════════════════════════════════════════════════════\n'));
    
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
    
    console.log(`总计: ${results.length} 个测试`);
    console.log(chalk.green(`通过: ${passed}`));
    console.log(chalk.red(`失败: ${failed}`));
    console.log(chalk.gray(`总耗时: ${(totalDuration / 1000).toFixed(2)}s`));
    
    if (failed > 0) {
      console.log(chalk.red('\n失败的测试:'));
      for (const r of results.filter(r => !r.passed)) {
        console.log(chalk.red(`  ✗ ${r.name}: ${r.message}`));
      }
    }
    
    console.log(chalk.cyan('\n═══════════════════════════════════════════════════════════════'));
    
    // 退出码
    process.exit(failed > 0 ? 1 : 0);
    
  } catch (error) {
    console.error(chalk.red(`\n测试执行失败: ${error}`));
    process.exit(1);
  }
}

main();
