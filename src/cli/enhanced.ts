/**
 * CLI交互模块 - 增强版
 * 
 * 使用增强模块：
 * - 元认知层：能力评估、边界检测
 * - 思考层：任务分解、推理引擎
 * - 执行层：增强ReAct、智能重试
 * - 恢复层：根因分析、策略生成
 */

import * as readline from 'readline';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

// 首先加载.env文件
const envPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '..', '.env'),
  path.resolve(__dirname, '..', '..', '.env'),
];

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

import { getEnhancedCore } from '../core/enhanced';
import { getMetacognition } from '../core/enhanced/metacognition';
import { getLLMManager } from '../llm';
import { getLogger } from '../observability/logger';
import { initDatabase } from '../memory/database';
import { SkillLoader } from '../skills/loader';
import { getSkillRegistry } from '../skills/registry';
import { registerBuiltinSkills } from '../skills/builtins';

const logger = getLogger('cli:enhanced');

let initialized = false;

async function initialize(): Promise<void> {
  if (initialized) return;

  try {
    await initDatabase();
    getLLMManager();
    registerBuiltinSkills();

    const loader = new SkillLoader();
    const skills = await loader.loadAll();
    const registry = getSkillRegistry();
    for (const skill of skills) {
      registry.register(skill);
    }

    initialized = true;
  } catch (error) {
    console.error(chalk.red(`初始化失败: ${error}`));
    process.exit(1);
  }
}

/**
 * 启动交互模式
 */
export async function startInteractive(): Promise<void> {
  await initialize();

  const core = getEnhancedCore();
  const metacognition = getMetacognition();
  const llmManager = getLLMManager();

  console.log(chalk.green('\n🦌 白泽增强版已启动'));
  console.log(chalk.gray('使用增强模块架构：'));
  console.log(chalk.gray('  - 元认知层：能力评估、边界检测'));
  console.log(chalk.gray('  - 思考层：任务分解、推理引擎'));
  console.log(chalk.gray('  - 执行层：增强ReAct、智能重试'));
  console.log(chalk.gray('  - 恢复层：根因分析、策略生成'));
  console.log(chalk.gray('\n输入 "exit" 退出，输入 "help" 查看帮助\n'));

  const providers = llmManager.getAvailableProviders();
  const registry = getSkillRegistry();
  const skills = registry.getAll();

  console.log(chalk.gray(`可用LLM提供商: ${providers.join(', ')}`));
  console.log(chalk.gray(`已加载技能: ${skills.map(s => s.name).join(', ')}\n`));

  // 检查是否是 TTY（真正的交互式终端）
  if (!process.stdin.isTTY) {
    // 非交互模式：从 stdin 读取所有行
    await runNonInteractiveMode(core);
    return;
  }

  // 交互模式
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askQuestion = (): void => {
    rl.question(chalk.cyan('你: '), async (input) => {
      await handleInput(input.trim(), core, metacognition, rl);
      
      // 检查是否应该继续
      if (input.trim().toLowerCase() !== 'exit' && input.trim().toLowerCase() !== 'quit') {
        askQuestion();
      }
    });
  };

  askQuestion();
}

/**
 * 非交互模式（处理管道输入）
 */
async function runNonInteractiveMode(core: any): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  const lines: string[] = [];

  for await (const line of rl) {
    lines.push(line);
  }

  // 处理每一行输入
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.toLowerCase() === 'exit') continue;
    
    await handleInput(trimmed, core, null, null);
  }

  process.exit(0);
}

/**
 * 处理用户输入
 */
async function handleInput(
  input: string,
  core: any,
  metacognition: any,
  rl: readline.Interface | null
): Promise<void> {
  if (!input) return;

  // 退出命令
  if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
    console.log(chalk.gray('\n再见！'));
    if (rl) rl.close();
    process.exit(0);
    return;
  }

  // 帮助命令
  if (input.toLowerCase() === 'help') {
    showHelp();
    return;
  }

  // 状态命令
  if (input.toLowerCase() === 'status' || input.toLowerCase() === 'stats') {
    await showStats(core);
    return;
  }

  // 能力评估命令
  if (input.toLowerCase() === 'assess' || input.toLowerCase() === 'capability') {
    console.log(chalk.cyan('\n【能力边界】'));
    const boundary = await metacognition.getCapabilityBoundary();
    console.log(chalk.gray(`已知能力: ${boundary.knownCapabilities.slice(0, 10).join(', ')}...`));
    console.log(chalk.gray(`不确定能力: ${boundary.uncertainCapabilities.join(', ') || '无'}`));
    console.log(chalk.gray(`置信度: ${(boundary.confidence * 100).toFixed(1)}%`));
    console.log();
    return;
  }

  try {
    console.log();
    
    // 1. 能力评估
    console.log(chalk.gray('【能力评估】'));
    const assessment = await core.assess(input);
    console.log(chalk.gray(`  能否完成: ${assessment.canComplete ? '是' : '否'}`));
    console.log(chalk.gray(`  置信度: ${(assessment.confidence * 100).toFixed(1)}%`));
    
    if (assessment.missingCapabilities.length > 0) {
      console.log(chalk.yellow(`  缺失能力: ${assessment.missingCapabilities.join(', ')}`));
    }
    
    if (assessment.riskFactors.length > 0) {
      console.log(chalk.yellow(`  风险因素: ${assessment.riskFactors.join(', ')}`));
    }

    // 2. 执行任务
    console.log(chalk.gray('\n【执行任务】'));
    const startTime = Date.now();
    const result = await core.process(input, {
      sessionId: 'cli-session',
      workspaceDir: process.cwd(),
    });
    const duration = Date.now() - startTime;

    // 3. 显示结果
    if (result.success) {
      console.log(chalk.green(`  ✓ 执行成功`));
    } else {
      console.log(chalk.red(`  ✗ 执行失败`));
    }
    
    console.log(chalk.gray(`  耗时: ${(duration / 1000).toFixed(2)}s`));
    console.log(chalk.gray(`  迭代次数: ${result.totalIterations}`));
    
    if (result.recoveryUsed) {
      console.log(chalk.yellow(`  使用了错误恢复`));
    }

    // 4. 显示任务结果
    if (result.taskResults.length > 0) {
      console.log(chalk.gray('\n【任务详情】'));
      for (const task of result.taskResults) {
        const icon = task.success ? '✓' : '✗';
        const color = task.success ? chalk.green : chalk.red;
        console.log(color(`  ${icon} ${task.taskId}`));
        if (task.message) {
          console.log(chalk.gray(`    ${task.message.slice(0, 200)}${task.message.length > 200 ? '...' : ''}`));
        }
        if (task.error) {
          console.log(chalk.red(`    错误: ${task.error}`));
        }
      }
    }

    // 5. 显示最终回复
    console.log(chalk.cyan('\n【白泽回复】'));
    console.log(chalk.white(result.finalMessage));

    // 6. 显示经验教训
    if (result.reflections.length > 0) {
      console.log(chalk.gray('\n【经验教训】'));
      for (const lesson of result.reflections) {
        console.log(chalk.gray(`  - ${lesson}`));
      }
    }

    console.log();

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`\n错误: ${errorMsg}\n`));
  }
}

/**
 * 显示统计信息
 */
async function showStats(core: any): Promise<void> {
  console.log(chalk.cyan('\n【系统状态】'));
  
  const registry = getSkillRegistry();
  const skills = registry.getAll();
  console.log(chalk.gray(`已加载技能: ${skills.length}`));
  
  const llm = getLLMManager();
  const providers = llm.getAvailableProviders();
  console.log(chalk.gray(`LLM提供商: ${providers.join(', ')}`));
  
  try {
    const boundary = await core.getCapabilities();
    console.log(chalk.gray(`已知能力: ${boundary.knownCapabilities.length}`));
    console.log(chalk.gray(`能力置信度: ${(boundary.confidence * 100).toFixed(1)}%`));
  } catch (e) {
    console.log(chalk.gray(`能力评估: 暂不可用`));
  }
  
  console.log();
}

/**
 * 单次对话模式
 */
export async function chatOnce(message: string): Promise<void> {
  await initialize();

  const core = getEnhancedCore();

  try {
    const result = await core.process(message, {
      sessionId: 'cli-once',
      workspaceDir: process.cwd(),
    });

    console.log(result.finalMessage);

    if (!result.success) {
      process.exit(1);
    }

  } catch (error) {
    console.error(chalk.red(`错误: ${error}`));
    process.exit(1);
  }
}

/**
 * 运行测试
 */
export async function runTests(): Promise<void> {
  await initialize();

  console.log(chalk.cyan('\n═══════════════════════════════════════════════════════════════'));
  console.log(chalk.cyan('           白泽增强版功能测试'));
  console.log(chalk.cyan('═══════════════════════════════════════════════════════════════\n'));

  const core = getEnhancedCore();
  const metacognition = getMetacognition();

  const tests = [
    {
      name: 'LLM连接',
      run: async () => {
        const llm = getLLMManager();
        const providers = llm.getAvailableProviders();
        return `提供商: ${providers.join(', ')}`;
      },
    },
    {
      name: '能力评估',
      run: async () => {
        const assessment = await metacognition.assessCapability('帮我查天气');
        return `canComplete: ${assessment.canComplete}, confidence: ${assessment.confidence.toFixed(2)}`;
      },
    },
    {
      name: '复杂度分析',
      run: async () => {
        const complexity = await metacognition.analyzeComplexity('搜索Python信息并整理成表格');
        return `score: ${complexity.score}, subtasks: ${complexity.subtaskCount}`;
      },
    },
    {
      name: '任务处理',
      run: async () => {
        const result = await core.process('你好');
        return `success: ${result.success}`;
      },
    },
  ];

  let passed = 0;
  let failed = 0;

  for (let i = 0; i < tests.length; i++) {
    const test = tests[i];
    process.stdout.write(`测试${i + 1}: ${test.name}...\n`);

    try {
      const result = await test.run();
      console.log(chalk.green(`  ✓ ${test.name}正常`), chalk.gray(result));
      passed++;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.log(chalk.red(`  ✗ ${test.name}失败`), chalk.gray(errorMsg));
      failed++;
    }
  }

  console.log(chalk.cyan('\n═══════════════════════════════════════════════════════════════'));
  console.log(chalk.cyan(`测试结果: 通过 ${passed}/${tests.length}`));
  if (failed === 0) {
    console.log(chalk.green('✓ 所有测试通过！'));
  } else {
    console.log(chalk.red(`✗ ${failed} 个测试失败`));
  }
  console.log(chalk.cyan('═══════════════════════════════════════════════════════════════\n'));
}

// ==================== 主入口 ====================

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  switch (command) {
    case 'start':
    case undefined:
      await startInteractive();
      break;
    case 'chat':
      await chatOnce(args.slice(1).join(' '));
      break;
    case 'test':
    case 'test-all':
      await runTests();
      break;
    case 'help':
    case '--help':
    case '-h':
      showHelp();
      break;
    default:
      console.log(chalk.red(`未知命令: ${command}`));
      console.log(chalk.gray('使用 "baize-enhanced help" 查看帮助'));
      process.exit(1);
  }
}

function showHelp(): void {
  console.log(chalk.cyan('\n白泽增强版命令行工具'));
  console.log(chalk.gray('\n用法:'));
  console.log(chalk.gray('  baize-enhanced            启动交互模式'));
  console.log(chalk.gray('  baize-enhanced start      启动交互模式'));
  console.log(chalk.gray('  baize-enhanced chat <msg> 单次对话'));
  console.log(chalk.gray('  baize-enhanced test       运行测试'));
  console.log(chalk.gray('  baize-enhanced help       显示帮助'));
  console.log();
  console.log(chalk.gray('交互模式命令:'));
  console.log(chalk.gray('  help      显示帮助'));
  console.log(chalk.gray('  status    显示系统状态'));
  console.log(chalk.gray('  assess    显示能力边界'));
  console.log(chalk.gray('  exit      退出'));
  console.log();
}

main().catch((error) => {
  console.error(chalk.red(`错误: ${error}`));
  process.exit(1);
});
