/**
 * CLI交互模块
 * 
 * v3.2.0 更新：
 * - 支持流式输出
 * - 支持思考过程展示
 * - 支持多轮对话
 * - 保持现有命令兼容
 */

import * as readline from 'readline';
import chalk from 'chalk';
import { getBrain } from '../core/brain';
import { getMemory } from '../memory';
import { getLLMManager } from '../llm';
import { getLogger } from '../observability/logger';
import { initDatabase } from '../memory/database';
import { SkillLoader } from '../skills/loader';
import { getSkillRegistry } from '../skills/registry';
import { registerBuiltinSkills } from '../skills/builtins';
import { getClawHubClient } from '../skills/market';
import { startWebServer } from '../interaction/webServer';
import { createAPIServer } from '../interaction/api';

const logger = getLogger('cli');

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

  const brain = getBrain();
  const memory = getMemory();
  const llmManager = getLLMManager();

  console.log(chalk.green('\n🦌 白泽3.2 已启动'));
  console.log(chalk.gray('输入 "exit" 退出，输入 "help" 查看帮助\n'));

  const providers = llmManager.getAvailableProviders();
  const registry = getSkillRegistry();
  const skills = registry.getAll();

  console.log(chalk.gray(`可用LLM提供商: ${providers.join(', ')}`));
  console.log(chalk.gray(`已加载技能: ${skills.map(s => s.name).join(', ')}\n`));

  // 检查是否是 TTY（真正的交互式终端）
  if (!process.stdin.isTTY) {
    // 非交互模式：从 stdin 读取所有行
    await runNonInteractiveMode(brain, memory);
    return;
  }

  // 交互模式
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askQuestion = (): void => {
    rl.question(chalk.cyan('你: '), async (input) => {
      await handleInput(input.trim(), brain, memory, rl);
      
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
async function runNonInteractiveMode(brain: any, memory: any): Promise<void> {
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
    
    await handleInput(trimmed, brain, memory, null);
  }

  process.exit(0);
}

/**
 * 处理用户输入
 */
async function handleInput(
  input: string,
  brain: any,
  memory: any,
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

  // 清空历史命令
  if (input.toLowerCase() === 'clear') {
    brain.clearHistory();
    console.log(chalk.gray('对话历史已清空\n'));
    return;
  }

  // 历史命令
  if (input.toLowerCase() === 'history') {
    const history = brain.getHistory();
    console.log(chalk.gray('\n对话历史:'));
    for (const h of history) {
      const prefix = h.role === 'user' ? '你: ' : '白泽: ';
      console.log(chalk.gray(`  ${prefix}${h.content}`));
    }
    console.log();
    return;
  }

  try {
    memory.recordEpisode('conversation', `用户: ${input}`);

    console.log();
    let thinkingShown = false;
    let contentStarted = false;
    let fullContent = '';

    for await (const event of brain.processStream(input, 'cli-session')) {
      switch (event.type) {
        case 'thinking':
          if (!thinkingShown) {
            console.log(chalk.gray('【思考过程】'));
            thinkingShown = true;
          }
          const thinkingData = event.data as any;
          console.log(chalk.gray(`  → ${thinkingData.message}`));
          break;

        case 'tool_call':
          const toolCallData = event.data as any;
          console.log(chalk.blue(`  → 调用工具: ${toolCallData.tool}`));
          break;

        case 'tool_result':
          const toolResultData = event.data as any;
          const resultIcon = toolResultData.success ? '✓' : '✗';
          const resultColor = toolResultData.success ? chalk.green : chalk.red;
          console.log(resultColor(`  ${resultIcon} 执行${toolResultData.success ? '成功' : '失败'} (${toolResultData.duration}ms)`));
          break;

        case 'content':
          if (!contentStarted) {
            console.log();
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

    if (fullContent) {
      memory.recordEpisode('conversation', `白泽: ${fullContent}`);
    }

    console.log();

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(chalk.red(`\n错误: ${errorMsg}\n`));
  }
}

/**
 * 单次对话模式
 */
export async function chatOnce(message: string): Promise<void> {
  await initialize();

  const brain = getBrain();
  const memory = getMemory();

  try {
    let thinkingShown = false;
    let contentStarted = false;
    let fullContent = '';

    for await (const event of brain.processStream(message, 'cli-once')) {
      switch (event.type) {
        case 'thinking':
          if (!thinkingShown) {
            console.log(chalk.gray('\n【思考过程】'));
            thinkingShown = true;
          }
          const thinkingData = event.data as any;
          console.log(chalk.gray(`  → ${thinkingData.message}`));
          break;

        case 'content':
          if (!contentStarted) {
            console.log();
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

    if (fullContent) {
      memory.recordEpisode('conversation', `白泽: ${fullContent}`);
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
  console.log(chalk.cyan('           白泽3.2 功能测试'));
  console.log(chalk.cyan('═══════════════════════════════════════════════════════════════\n'));

  const tests = [
    {
      name: '数据库',
      run: async () => {
        const db = require('../memory/database').getDatabase();
        const tables = db.all("SELECT name FROM sqlite_master WHERE type='table'");
        return `表: ${tables.map((t: any) => t.name).join(', ')}`;
      },
    },
    {
      name: 'LLM连接',
      run: async () => {
        const llm = getLLMManager();
        const providers = llm.getAvailableProviders();
        return `提供商: ${providers.join(', ')}`;
      },
    },
    {
      name: '技能系统',
      run: async () => {
        const registry = getSkillRegistry();
        const skills = registry.getAll();
        return `技能: ${skills.map(s => s.name).join(', ')}`;
      },
    },
    {
      name: '记忆系统',
      run: async () => {
        const mem = getMemory();
        mem.recordEpisode('test', '测试记忆');
        return '正常';
      },
    },
    {
      name: '大脑决策',
      run: async () => {
        const b = getBrain();
        const decision = await b.process('你好');
        return `意图: ${decision.intent}, 动作: ${decision.action}`;
      },
    },
    {
      name: '流式处理',
      run: async () => {
        const b = getBrain();
        let count = 0;
        for await (const _ of b.processStream('你好', 'test')) {
          count++;
        }
        return `事件数: ${count}`;
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
      await handleSkillCommand(args.slice(1));
      break;
    case 'web':
      await startWeb();
      break;
    case 'api':
      await startAPI();
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

async function startWeb(): Promise<void> {
  console.log(chalk.cyan('\n启动白泽 Web 服务...'));
  console.log(chalk.gray('API 服务: http://localhost:3000'));
  console.log(chalk.gray('Web 界面: http://localhost:8080'));
  console.log();
  
  const apiServer = createAPIServer({ port: 3000 });
  await apiServer.start();
  startWebServer(8080);
  
  console.log(chalk.green('✓ 服务已启动'));
  console.log(chalk.gray('按 Ctrl+C 停止服务\n'));
}

async function startAPI(): Promise<void> {
  console.log(chalk.cyan('\n启动白泽 API 服务...'));
  
  const port = parseInt(args[1]) || 3000;
  const apiServer = createAPIServer({ port });
  await apiServer.start();
  
  console.log(chalk.green(`✓ API 服务已启动: http://localhost:${port}`));
  console.log(chalk.gray('按 Ctrl+C 停止服务\n'));
}

async function handleSkillCommand(skillArgs: string[]): Promise<void> {
  const subCommand = skillArgs[0];
  
  switch (subCommand) {
    case 'list':
    case 'ls':
      await listSkills();
      break;
    case 'search':
      await searchSkills(skillArgs.slice(1).join(' '));
      break;
    case 'install':
      await installSkill(skillArgs[1]);
      break;
    case 'uninstall':
      await uninstallSkill(skillArgs[1]);
      break;
    case 'info':
      await showSkillInfo(skillArgs[1]);
      break;
    default:
      console.log(chalk.cyan('\n技能命令:'));
      console.log(chalk.gray('  baize skill list              列出已安装技能'));
      console.log(chalk.gray('  baize skill search <name>     搜索 ClawHub 技能市场'));
      console.log(chalk.gray('  baize skill install <slug>    从 ClawHub 安装技能'));
      console.log(chalk.gray('  baize skill uninstall <slug>  卸载技能'));
      console.log(chalk.gray('  baize skill info <slug>       查看技能详情'));
      console.log();
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
    console.log(chalk.gray(`    能力: ${skill.capabilities.join(', ')}`));
    console.log(chalk.gray(`    风险: ${skill.riskLevel}`));
  }
  
  console.log(chalk.gray('─'.repeat(50)));
  console.log(chalk.gray(`共 ${skills.length} 个技能\n`));
}

async function searchSkills(query: string): Promise<void> {
  if (!query) {
    console.log(chalk.red('请提供搜索关键词'));
    return;
  }
  
  console.log(chalk.cyan(`\n搜索: ${query}`));
  
  try {
    const client = getClawHubClient();
    const results = await client.search(query);
    
    console.log(chalk.green(`找到 ${results.length} 个结果\n`));
    
    for (const skill of results) {
      console.log(chalk.white(`  ${skill.slug}`) + chalk.gray(` - ${skill.displayName}`));
    }
    
    console.log();
  } catch (error) {
    console.error(chalk.red(`错误: ${error}`));
  }
}

async function installSkill(slug: string): Promise<void> {
  if (!slug) {
    console.log(chalk.red('请提供技能 slug'));
    return;
  }
  
  console.log(chalk.cyan(`\n安装技能: ${slug}`));
  
  try {
    const client = getClawHubClient();
    const result = await client.install(slug);
    
    if (result.success) {
      console.log(chalk.green(`✓ 安装成功: ${result.path}`));
    } else {
      console.log(chalk.red(`✗ 安装失败: ${result.error}`));
    }
  } catch (error) {
    console.error(chalk.red(`错误: ${error}`));
  }
}

async function uninstallSkill(slug: string): Promise<void> {
  if (!slug) {
    console.log(chalk.red('请提供技能 slug'));
    return;
  }
  
  try {
    const client = getClawHubClient();
    const result = await client.uninstall(slug);
    
    if (result.success) {
      console.log(chalk.green(`✓ 已卸载: ${slug}`));
    } else {
      console.log(chalk.red(`✗ 卸载失败: ${result.error}`));
    }
  } catch (error) {
    console.error(chalk.red(`错误: ${error}`));
  }
}

async function showSkillInfo(slug: string): Promise<void> {
  if (!slug) {
    console.log(chalk.red('请提供技能 slug'));
    return;
  }
  
  try {
    const client = getClawHubClient();
    const details = await client.getSkillDetails(slug);
    
    if (!details) {
      console.log(chalk.red('未找到技能'));
      return;
    }
    
    console.log(chalk.cyan('\n技能详情:'));
    console.log(chalk.white(`  名称: ${details.skill.displayName}`));
    console.log(chalk.gray(`  Slug: ${details.skill.slug}`));
    console.log();
  } catch (error) {
    console.error(chalk.red(`错误: ${error}`));
  }
}

function showHelp(): void {
  console.log(chalk.cyan('\n白泽3.2 命令行工具'));
  console.log(chalk.gray('\n用法:'));
  console.log(chalk.gray('  baize                    启动交互模式'));
  console.log(chalk.gray('  baize start              启动交互模式'));
  console.log(chalk.gray('  baize chat <msg>         单次对话'));
  console.log(chalk.gray('  baize test               运行测试'));
  console.log(chalk.gray('  baize skill <command>    技能管理'));
  console.log(chalk.gray('  baize web                启动 Web 服务'));
  console.log(chalk.gray('  baize api [port]         启动 API 服务'));
  console.log(chalk.gray('  baize help               显示帮助'));
  console.log();
}

main().catch((error) => {
  console.error(chalk.red(`错误: ${error}`));
  process.exit(1);
});
