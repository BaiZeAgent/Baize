/**
 * CLI交互模块 - V4 版本
 * 
 * 使用简化大脑 V4：
 * - 快速分类
 * - 最小化LLM调用
 * - 高响应速度
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

import { getBrainV4 } from '../core/brain-v4';
import { getLLMManager } from '../llm';
import { getLogger } from '../observability/logger';
import { initDatabase } from '../memory/database';
import { getSkillRegistry } from '../skills/registry';
import { StreamEvent } from '../types/stream';

const logger = getLogger('cli');

let initialized = false;

async function initialize(): Promise<void> {
  if (initialized) return;

  try {
    await initDatabase();
    getLLMManager();
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

  const brain = getBrainV4();
  const llmManager = getLLMManager();

  console.log(chalk.green('\n🦌 白泽 V4 已启动'));
  console.log(chalk.gray('使用简化大脑 V4 架构'));
  console.log(chalk.gray('输入 "exit" 退出，输入 "help" 查看帮助\n'));

  const providers = llmManager.getAvailableProviders();
  console.log(chalk.gray(`可用LLM提供商: ${providers.join(', ')}\n`));

  // 检查是否是 TTY（真正的交互式终端）
  if (!process.stdin.isTTY) {
    // 非交互模式：从 stdin 读取所有行
    await runNonInteractiveMode(brain);
    return;
  }

  // 交互模式
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askQuestion = (): void => {
    rl.question(chalk.cyan('你: '), async (input) => {
      await handleInput(input.trim(), brain, rl);
      
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
async function runNonInteractiveMode(brain: any): Promise<void> {
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
    
    await handleInput(trimmed, brain, null);
  }

  process.exit(0);
}

/**
 * 处理用户输入
 */
async function handleInput(
  input: string,
  brain: any,
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
    showStats(brain);
    return;
  }

  try {
    console.log();
    let contentStarted = false;
    let fullContent = '';

    for await (const event of brain.processStream(input, 'cli-session')) {
      switch (event.type) {
        case 'thinking':
          const thinkingData = event.data as any;
          console.log(chalk.gray(`  → [${thinkingData.stage}] ${thinkingData.message}`));
          break;

        case 'tool_call':
          const toolCallData = event.data as any;
          console.log(chalk.blue(`  → 调用工具: ${toolCallData.tool}`));
          if (toolCallData.reason) {
            console.log(chalk.gray(`    理由: ${toolCallData.reason}`));
          }
          break;

        case 'tool_result':
          const toolResultData = event.data as any;
          const resultIcon = toolResultData.success ? '✓' : '✗';
          const resultColor = toolResultData.success ? chalk.green : chalk.red;
          console.log(resultColor(`  ${resultIcon} 执行${toolResultData.success ? '成功' : '失败'} (${toolResultData.duration}ms)`));
          break;

        case 'content':
          if (!contentStarted) {
            process.stdout.write(chalk.cyan('白泽: '));
            contentStarted = true;
          }
          const contentData = event.data as any;
          process.stdout.write(contentData.text);
          fullContent += contentData.text;
          break;

        case 'done':
          if (!contentStarted) {
            console.log(chalk.cyan('白泽: ') + '(无内容)');
          }
          const doneData = event.data as any;
          console.log();
          console.log(chalk.gray(`[总耗时 ${(doneData.duration / 1000).toFixed(2)}s]`));
          break;

        case 'error':
          const errorData = event.data as any;
          console.log(chalk.red(`错误: ${errorData.message}`));
          break;
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
function showStats(brain: any): void {
  console.log(chalk.cyan('\n【系统状态】'));
  
  const stats = brain.getStats();
  console.log(chalk.gray(`技能数量: ${stats.skillsCount}`));
  console.log(chalk.gray(`工具数量: ${stats.toolsCount}`));
  console.log(chalk.gray(`对话历史: ${stats.historyLength} 条`));
  
  console.log();
}

/**
 * 单次对话模式
 */
export async function chatOnce(message: string): Promise<void> {
  await initialize();

  const brain = getBrainV4();

  try {
    let contentStarted = false;
    let fullContent = '';

    for await (const event of brain.processStream(message, 'cli-once')) {
      switch (event.type) {
        case 'thinking':
          const thinkingData = event.data as any;
          console.log(chalk.gray(`  → [${thinkingData.stage}] ${thinkingData.message}`));
          break;

        case 'content':
          if (!contentStarted) {
            process.stdout.write(chalk.cyan('白泽: '));
            contentStarted = true;
          }
          const contentData = event.data as any;
          process.stdout.write(contentData.text);
          fullContent += contentData.text;
          break;

        case 'done':
          if (!contentStarted) {
            console.log(chalk.cyan('\n白泽: ') + '(无内容)');
          }
          console.log();
          break;

        case 'error':
          const errorData = event.data as any;
          console.log(chalk.red(`\n错误: ${errorData.message}`));
          break;
      }
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
  console.log(chalk.cyan('           白泽 V4 功能测试'));
  console.log(chalk.cyan('═══════════════════════════════════════════════════════════════\n'));

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
      name: '简单问候',
      run: async () => {
        const b = getBrainV4();
        const result = await b.process('你好');
        return `响应: ${result.response.slice(0, 30)}...`;
      },
    },
    {
      name: '响应速度',
      run: async () => {
        const b = getBrainV4();
        const start = Date.now();
        await b.process('hi');
        return `耗时: ${Date.now() - start}ms`;
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
    case 'skill':
    case 'skills':
      await listSkills();
      break;
    case 'help':
    case '--help':
    case '-h':
      showHelp();
      break;
    default:
      console.log(chalk.red(`未知命令: ${command}`));
      console.log(chalk.gray('使用 "baize help" 查看帮助'));
      process.exit(1);
  }
}

async function listSkills(): Promise<void> {
  await initialize();
  
  const registry = getSkillRegistry();
  const skills = registry.getAll();
  
  console.log(chalk.cyan('\n已安装技能:'));
  console.log(chalk.gray('─'.repeat(50)));
  
  for (const skill of skills) {
    console.log(chalk.white(`  ${skill.name}`) + chalk.gray(` - ${skill.description}`));
  }
  
  console.log(chalk.gray('─'.repeat(50)));
  console.log(chalk.gray(`共 ${skills.length} 个技能\n`));
}

function showHelp(): void {
  console.log(chalk.cyan('\n白泽 V4 命令行工具'));
  console.log(chalk.gray('\n用法:'));
  console.log(chalk.gray('  baize                    启动交互模式'));
  console.log(chalk.gray('  baize start              启动交互模式'));
  console.log(chalk.gray('  baize chat <msg>         单次对话'));
  console.log(chalk.gray('  baize test               运行测试'));
  console.log(chalk.gray('  baize skill              列出技能'));
  console.log(chalk.gray('  baize help               显示帮助'));
  console.log();
  console.log(chalk.gray('交互模式命令:'));
  console.log(chalk.gray('  help      显示帮助'));
  console.log(chalk.gray('  status    显示系统状态'));
  console.log(chalk.gray('  exit      退出'));
  console.log();
}

main().catch((error) => {
  console.error(chalk.red(`错误: ${error}`));
  process.exit(1);
});
