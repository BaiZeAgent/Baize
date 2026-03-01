/**
 * 白泽 V3 功能测试
 * 
 * 测试所有新增的核心能力：
 * 1. 智能路由器
 * 2. 任务规划器
 * 3. 增强记忆
 * 4. 元认知引擎
 * 5. 统一大脑
 */

import chalk from 'chalk';
import { getIntelligentRouter } from '../src/core/router/intelligent-router';
import { getTaskPlanner } from '../src/core/planner';
import { getEnhancedMemory } from '../src/memory/v3';
import { getMetacognition } from '../src/core/metacognition';
import { getBrainV3 } from '../src/core/brain-v3';
import { initDatabase } from '../src/memory/database';
import { getLLMManager } from '../src/llm';
import { registerBuiltinSkills } from '../src/skills/builtins';
import { SkillLoader } from '../src/skills/loader';
import { getSkillRegistry } from '../src/skills/registry';

// 测试结果
interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  duration: number;
}

const results: TestResult[] = [];

/**
 * 运行测试
 */
async function runTest(
  name: string,
  testFn: () => Promise<void>
): Promise<void> {
  const startTime = Date.now();
  process.stdout.write(`测试: ${name}... `);
  
  try {
    await testFn();
    const duration = Date.now() - startTime;
    results.push({ name, passed: true, message: '通过', duration });
    console.log(chalk.green('✓ 通过'), chalk.gray(`(${duration}ms)`));
  } catch (error) {
    const duration = Date.now() - startTime;
    const message = error instanceof Error ? error.message : String(error);
    results.push({ name, passed: false, message, duration });
    console.log(chalk.red('✗ 失败'), chalk.gray(`(${duration}ms)`));
    console.log(chalk.red(`  错误: ${message}`));
  }
}

/**
 * 初始化
 */
async function initialize(): Promise<void> {
  console.log(chalk.cyan('\n═══════════════════════════════════════════════════════════════'));
  console.log(chalk.cyan('           白泽 V3 功能测试'));
  console.log(chalk.cyan('═══════════════════════════════════════════════════════════════\n'));
  
  // 初始化数据库
  await initDatabase();
  
  // 初始化 LLM
  getLLMManager();
  
  // 注册内置技能
  registerBuiltinSkills();
  
  // 加载外部技能
  const loader = new SkillLoader();
  const skills = await loader.loadAll();
  const registry = getSkillRegistry();
  for (const skill of skills) {
    registry.register(skill);
  }
  
  console.log(chalk.gray(`初始化完成，已加载 ${registry.size} 个技能\n`));
}

/**
 * 测试智能路由器
 */
async function testIntelligentRouter(): Promise<void> {
  console.log(chalk.cyan('\n【智能路由器测试】\n'));
  
  const router = getIntelligentRouter();
  
  // 测试1: 简单问候
  await runTest('路由器 - 简单问候', async () => {
    const decision = await router.route({
      userInput: '你好',
      sessionId: 'test',
    });
    
    if (decision.action !== 'reply') {
      throw new Error(`期望 action=reply, 实际 action=${decision.action}`);
    }
    if (!decision.content?.includes('你好')) {
      throw new Error('回复内容不正确');
    }
  });
  
  // 测试2: 信息查询
  await runTest('路由器 - 信息查询', async () => {
    const decision = await router.route({
      userInput: '今天杭州天气怎么样',
      sessionId: 'test',
    });
    
    if (!decision.intent) {
      throw new Error('缺少意图分析');
    }
    if (decision.intent.type !== 'information' && decision.intent.type !== 'action') {
      throw new Error(`意图类型不正确: ${decision.intent.type}`);
    }
  });
  
  // 测试3: 复杂任务
  await runTest('路由器 - 复杂任务', async () => {
    const decision = await router.route({
      userInput: '帮我分析这个网页的内容并生成摘要',
      sessionId: 'test',
    });
    
    if (!decision.intent) {
      throw new Error('缺少意图分析');
    }
    if (decision.intent.complexity < 5) {
      throw new Error(`复杂度评估过低: ${decision.intent.complexity}`);
    }
  });
  
  // 测试4: 路由统计
  await runTest('路由器 - 统计功能', async () => {
    const stats = router.getStats();
    if (typeof stats.totalRoutings !== 'number') {
      throw new Error('统计信息格式错误');
    }
  });
}

/**
 * 测试任务规划器
 */
async function testTaskPlanner(): Promise<void> {
  console.log(chalk.cyan('\n【任务规划器测试】\n'));
  
  const planner = getTaskPlanner();
  
  // 测试1: 创建简单计划
  await runTest('规划器 - 创建简单计划', async () => {
    const plan = await planner.createPlan(
      '查询今天杭州的天气',
      {
        surface: '查询天气',
        deep: '了解杭州今天的天气情况',
        execution: '调用天气查询工具',
        type: 'information',
        urgency: 5,
        complexity: 3,
      },
      {
        sessionId: 'test',
        completedTasks: new Map(),
        variables: {},
        userInput: '查询今天杭州的天气',
      }
    );
    
    if (!plan.id) {
      throw new Error('计划ID缺失');
    }
    if (plan.tasks.length === 0) {
      throw new Error('任务列表为空');
    }
  });
  
  // 测试2: 获取计划
  await runTest('规划器 - 获取计划', async () => {
    const plans = planner.getActivePlans();
    if (!Array.isArray(plans)) {
      throw new Error('返回格式错误');
    }
  });
}

/**
 * 测试增强记忆
 */
async function testEnhancedMemory(): Promise<void> {
  console.log(chalk.cyan('\n【增强记忆系统测试】\n'));
  
  const memory = getEnhancedMemory();
  
  // 测试1: 记录事件
  await runTest('记忆 - 记录事件', async () => {
    const id = await memory.recordEvent('test_event', '这是一个测试事件');
    if (!id) {
      throw new Error('事件ID缺失');
    }
  });
  
  // 测试2: 存储事实
  await runTest('记忆 - 存储事实', async () => {
    const id = await memory.rememberFact('用户喜欢简洁的回答', {
      importance: 0.8,
      source: 'inferred',
    });
    if (!id) {
      throw new Error('事实ID缺失');
    }
  });
  
  // 测试3: 用户偏好
  await runTest('记忆 - 用户偏好', async () => {
    memory.setPreference('language', 'zh-CN', 'explicit', 0.9);
    const value = memory.getPreference('language');
    if (value !== 'zh-CN') {
      throw new Error(`偏好值不正确: ${value}`);
    }
  });
  
  // 测试4: 工作记忆
  await runTest('记忆 - 工作记忆', async () => {
    memory.setContext('测试任务', '测试意图');
    const context = memory.getContext();
    if (context.currentTask !== '测试任务') {
      throw new Error('工作记忆设置失败');
    }
  });
  
  // 测试5: 学习记录
  await runTest('记忆 - 学习记录', async () => {
    memory.recordLearning('测试场景', '测试动作', 'success', '测试教训');
    const records = memory.getRelevantLearning('测试');
    if (records.length === 0) {
      throw new Error('学习记录未保存');
    }
  });
  
  // 测试6: 统计
  await runTest('记忆 - 统计功能', async () => {
    const stats = memory.getStats();
    if (typeof stats.totalMemories !== 'number') {
      throw new Error('统计格式错误');
    }
  });
}

/**
 * 测试元认知引擎
 */
async function testMetacognition(): Promise<void> {
  console.log(chalk.cyan('\n【元认知引擎测试】\n'));
  
  const meta = getMetacognition();
  
  // 测试1: 自我评估
  await runTest('元认知 - 自我评估', async () => {
    const assessment = await meta.assessSelf();
    if (!assessment.capabilities || assessment.capabilities.length === 0) {
      throw new Error('能力评估缺失');
    }
    if (typeof assessment.state.confidence !== 'number') {
      throw new Error('状态评估格式错误');
    }
  });
  
  // 测试2: 能力边界检查
  await runTest('元认知 - 能力边界检查', async () => {
    const check = await meta.checkBoundary('帮我飞到月球');
    if (check.withinCapability) {
      throw new Error('应该检测到超出能力范围');
    }
    if (check.missingCapabilities.length === 0) {
      throw new Error('应该识别缺失的能力');
    }
  });
  
  // 测试3: 反思
  await runTest('元认知 - 反思功能', async () => {
    const result = await meta.reflect(
      '测试场景',
      ['步骤1', '步骤2', '步骤3'],
      'success'
    );
    if (!result.lessons) {
      throw new Error('反思结果缺失');
    }
  });
  
  // 测试4: 学习改进
  await runTest('元认知 - 学习改进', async () => {
    const learning = await meta.learnAndImprove();
    if (!learning.insights || !learning.actions) {
      throw new Error('学习结果格式错误');
    }
  });
}

/**
 * 测试统一大脑
 */
async function testUnifiedBrain(): Promise<void> {
  console.log(chalk.cyan('\n【统一大脑 V3 测试】\n'));
  
  const brain = getBrainV3();
  
  // 测试1: 简单对话
  await runTest('大脑V3 - 简单对话', async () => {
    const result = await brain.process('你好', 'test-session');
    if (!result.success) {
      throw new Error('处理失败');
    }
    if (!result.response) {
      throw new Error('响应缺失');
    }
  });
  
  // 测试2: 自我评估报告
  await runTest('大脑V3 - 自我评估报告', async () => {
    const report = await brain.getSelfAssessment();
    if (!report || report.length < 50) {
      throw new Error('报告内容不足');
    }
  });
  
  // 测试3: 路由统计
  await runTest('大脑V3 - 路由统计', async () => {
    const stats = brain.getRouterStats();
    if (typeof stats.totalRoutings !== 'number') {
      throw new Error('统计格式错误');
    }
  });
  
  // 测试4: 记忆统计
  await runTest('大脑V3 - 记忆统计', async () => {
    const stats = brain.getMemoryStats();
    if (typeof stats.totalMemories !== 'number') {
      throw new Error('统计格式错误');
    }
  });
}

/**
 * 输出测试报告
 */
function printReport(): void {
  console.log(chalk.cyan('\n═══════════════════════════════════════════════════════════════'));
  console.log(chalk.cyan('                    测试报告'));
  console.log(chalk.cyan('═══════════════════════════════════════════════════════════════\n'));
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
  
  console.log(`总计: ${total} 个测试`);
  console.log(chalk.green(`通过: ${passed}`));
  console.log(chalk.red(`失败: ${failed}`));
  console.log(chalk.gray(`总耗时: ${totalDuration}ms\n`));
  
  if (failed > 0) {
    console.log(chalk.red('失败的测试:'));
    for (const result of results.filter(r => !r.passed)) {
      console.log(chalk.red(`  ✗ ${result.name}: ${result.message}`));
    }
  }
  
  console.log(chalk.cyan('\n═══════════════════════════════════════════════════════════════'));
  
  if (failed === 0) {
    console.log(chalk.green('✓ 所有测试通过！'));
  } else {
    console.log(chalk.red(`✗ ${failed} 个测试失败`));
  }
  console.log(chalk.cyan('═══════════════════════════════════════════════════════════════\n'));
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  try {
    await initialize();
    
    await testIntelligentRouter();
    await testTaskPlanner();
    await testEnhancedMemory();
    await testMetacognition();
    await testUnifiedBrain();
    
    printReport();
    
    process.exit(results.filter(r => !r.passed).length > 0 ? 1 : 0);
  } catch (error) {
    console.error(chalk.red(`\n测试执行错误: ${error}`));
    process.exit(1);
  }
}

main();
