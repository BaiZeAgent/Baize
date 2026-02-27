/**
 * 多场景对话测试
 */

import chalk from 'chalk';
import { initDatabase } from './src/memory/database';
import { getLLMManager } from './src/llm';
import { getSkillRegistry } from './src/skills/registry';
import { registerBuiltinSkills } from './src/skills/builtins';
import { SkillLoader } from './src/skills/loader';
import { getMemory } from './src/memory';
import { getBrainV2 } from './src/core/brain/brain-v2';
import { getLogger } from './src/observability/logger';

const logger = getLogger('multi-scenario-test');

async function initialize(): Promise<void> {
  await initDatabase();
  getLLMManager();
  registerBuiltinSkills();
  const loader = new SkillLoader();
  const skills = await loader.loadAll();
  const registry = getSkillRegistry();
  for (const skill of skills) {
    registry.register(skill);
  }
}

interface TestResult {
  scenario: string;
  input: string;
  output: string;
  success: boolean;
  duration: number;
}

async function testScenario(
  brain: ReturnType<typeof getBrainV2>,
  scenario: string,
  input: string
): Promise<TestResult> {
  const startTime = Date.now();
  console.log(chalk.cyan(`\n【${scenario}】`));
  console.log(chalk.gray(`输入: ${input}`));
  
  try {
    const decision = await brain.process(input);
    const duration = Date.now() - startTime;
    
    console.log(chalk.green(`回复: ${decision.response?.slice(0, 200)}...`));
    console.log(chalk.gray(`意图: ${decision.intent}, 动作: ${decision.action}, 耗时: ${duration}ms`));
    
    return {
      scenario,
      input,
      output: decision.response || '',
      success: true,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.log(chalk.red(`错误: ${errorMsg}`));
    
    return {
      scenario,
      input,
      output: errorMsg,
      success: false,
      duration,
    };
  }
}

async function main(): Promise<void> {
  console.log(chalk.cyan('\n═══════════════════════════════════════════════════════════════'));
  console.log(chalk.cyan('           白泽多场景对话测试'));
  console.log(chalk.cyan('═══════════════════════════════════════════════════════════════\n'));

  await initialize();
  const brain = getBrainV2();
  const results: TestResult[] = [];

  // 场景 1: 基础问候
  results.push(await testScenario(brain, '基础问候', '你好，请介绍一下你自己'));

  // 场景 2: 知识问答
  results.push(await testScenario(brain, '知识问答', '什么是人工智能？请简单解释'));

  // 场景 3: 任务请求
  results.push(await testScenario(brain, '任务请求', '请帮我列出当前目录的文件'));

  // 场景 4: 技能调用
  results.push(await testScenario(brain, '技能调用', '使用 process 工具列出所有进程'));

  // 场景 5: 多轮对话
  brain.clearHistory();
  await brain.process('我叫李四，我喜欢编程');
  results.push(await testScenario(brain, '多轮对话', '我叫什么名字？我有什么爱好？'));

  // 场景 6: 复杂任务
  results.push(await testScenario(brain, '复杂任务', '请帮我分析一下如何学习编程'));

  // 场景 7: 情感对话
  results.push(await testScenario(brain, '情感对话', '我今天心情不太好，能安慰我一下吗'));

  // 场景 8: 创意任务
  results.push(await testScenario(brain, '创意任务', '请给我讲一个简短的故事'));

  // 场景 9: 技能市场
  results.push(await testScenario(brain, '技能市场', '有哪些可用的技能？'));

  // 场景 10: 错误处理
  results.push(await testScenario(brain, '错误处理', '请使用一个不存在的技能 xyz'));

  // 输出汇总
  console.log(chalk.cyan('\n═══════════════════════════════════════════════════════════════'));
  console.log(chalk.cyan('                      测试结果汇总'));
  console.log(chalk.cyan('═══════════════════════════════════════════════════════════════\n'));

  const passed = results.filter(r => r.success).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  console.log(`总计: ${results.length} 个场景`);
  console.log(chalk.green(`通过: ${passed}`));
  console.log(chalk.red(`失败: ${results.length - passed}`));
  console.log(chalk.gray(`总耗时: ${(totalDuration / 1000).toFixed(2)}s`));

  console.log(chalk.cyan('\n详细结果:'));
  for (const r of results) {
    const icon = r.success ? chalk.green('✓') : chalk.red('✗');
    console.log(`${icon} ${r.scenario}: ${r.duration}ms`);
  }

  console.log(chalk.cyan('\n═══════════════════════════════════════════════════════════════'));

  process.exit(0);
}

main().catch(console.error);
