/**
 * CLI交互模块
 * 
 * v3.2.0 更新：
 * - 支持流式输出
 * - 支持思考过程展示
 * - 保持现有命令兼容
 */

import * as readline from 'readline';
import chalk from 'chalk';
import ora from 'ora';
import { getBrain, Decision } from '../core/brain';
import { getExecutor } from '../executor';
import { getMemory } from '../memory';
import { getLLMManager } from '../llm';
import { getLogger } from '../observability/logger';
import { initDatabase, getDatabase } from '../memory/database';
import { SkillLoader } from '../skills/loader';
import { getSkillRegistry } from '../skills/registry';
import { getClawHubClient } from '../skills/market';
import { startWebServer } from '../interaction/webServer';
import { createAPIServer } from '../interaction/api';
import { StreamEvent } from '../types/stream';

const logger = getLogger('cli');

let initialized = false;

async function initialize(): Promise<void> {
  if (initialized) return;

  try {
    // 初始化数据库
    await initDatabase();

    // 初始化LLM
    getLLMManager();

    // 加载技能
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
 * 启动交互模式（流式版本）
 */
export async function startInteractive(): Promise<void> {
  await initialize();

  const brain = getBrain();
  const memory = getMemory();
  const llmManager = getLLMManager();

  console.log(chalk.green('\n🦌 白泽3.2 已启动'));
  console.log(chalk.gray('输入 "exit" 退出，输入 "help" 查看帮助\n'));

  // 显示可用提供商和技能
  const providers = llmManager.getAvailableProviders();
  const registry = getSkillRegistry();
  const skills = registry.getAll();

  console.log(chalk.gray(`可用LLM提供商: ${providers.join(', ')}`));
  console.log(chalk.gray(`已加载技能: ${skills.map(s => s.name).join(', ')}\n`));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () => {
    rl.question(chalk.cyan('你: '), async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        prompt();
        return;
      }

      // 退出命令
      if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
        console.log(chalk.gray('\n再见！'));
        rl.close();
        process.exit(0);
      }

      // 帮助命令
      if (trimmed.toLowerCase() === 'help') {
        showHelp();
        prompt();
        return;
      }

      // 清空历史命令
      if (trimmed.toLowerCase() === 'clear') {
        brain.clearHistory();
        console.log(chalk.gray('对话历史已清空\n'));
        prompt();
        return;
      }

      // 历史命令
      if (trimmed.toLowerCase() === 'history') {
        const history = brain.getHistory();
        console.log(chalk.gray('\n对话历史:'));
        for (const h of history) {
          const prefix = h.role === 'user' ? '你: ' : '白泽: ';
          console.log(chalk.gray(`  ${prefix}${h.content}`));
        }
        console.log();
        prompt();
        return;
      }

      try {
        // 记录用户输入
        memory.recordEpisode('conversation', `用户: ${trimmed}`);

        // 使用流式处理
        console.log();
        let thinkingShown = false;
        let contentStarted = false;
        let fullContent = '';
        const startTime = Date.now();

        for await (const event of brain.processStream(trimmed, 'cli-session')) {
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
                console.log(); // 空行
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

        // 记录回复
        if (fullContent) {
          memory.recordEpisode('conversation', `白泽: ${fullContent}`);
        }

        console.log(); // 空行

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`\n错误: ${errorMsg}\n`));
      }

      prompt();
    });
  };

  prompt();
}

/**
 * 单次对话模式
 */
export async function chatOnce(message: string): Promise<void> {
  await initialize();

  const brain = getBrain();
  const memory = getMemory();

  try {
    // 使用流式处理
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
        const db = getDatabase();
        const tables = db.all("SELECT name FROM sqlite_master WHERE type='table'");
        const tableNames = tables.map((t: any) => t.name).join(', ');
        return `表: ${tableNames}`;
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
        const memory = getMemory();
        memory.recordEpisode('test', '测试记忆');
        return '正常';
      },
    },
    {
      name: '大脑决策',
      run: async () => {
        const brain = getBrain();
        const decision = await brain.process('你好');
        return `意图: ${decision.intent}, 动作: ${decision.action}`;
      },
    },
    {
      name: '流式处理',
      run: async () => {
        const brain = getBrain();
        let eventCount = 0;
        for await (const event of brain.processStream('你好', 'test')) {
          eventCount++;
        }
        return `事件数: ${eventCount}`;
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

/**
 * 启动 Web 服务
 */
async function startWeb(): Promise<void> {
  console.log(chalk.cyan('\n启动白泽 Web 服务...'));
  console.log(chalk.gray('API 服务: http://localhost:3000'));
  console.log(chalk.gray('Web 界面: http://localhost:8080'));
  console.log();
  
  // 启动 API 服务
  const apiServer = createAPIServer({ port: 3000 });
  await apiServer.start();
  
  // 启动 Web 服务
  startWebServer(8080);
  
  console.log(chalk.green('✓ 服务已启动'));
  console.log(chalk.gray('按 Ctrl+C 停止服务\n'));
}

/**
 * 启动 API 服务
 */
async function startAPI(): Promise<void> {
  console.log(chalk.cyan('\n启动白泽 API 服务...'));
  
  const port = parseInt(args[1]) || 3000;
  const apiServer = createAPIServer({ port });
  await apiServer.start();
  
  console.log(chalk.green(`✓ API 服务已启动: http://localhost:${port}`));
  console.log(chalk.gray('按 Ctrl+C 停止服务\n'));
}

/**
 * 处理技能命令
 */
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

/**
 * 列出已安装技能
 */
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

/**
 * 搜索 ClawHub 技能市场
 */
async function searchSkills(query: string): Promise<void> {
  if (!query) {
    console.log(chalk.red('请提供搜索关键词'));
    return;
  }
  
  const spinner = ora('搜索 ClawHub...').start();
  
  try {
    const client = getClawHubClient();
    const results = await client.search(query);
    
    spinner.succeed(`找到 ${results.length} 个结果`);
    
    if (results.length === 0) {
      console.log(chalk.gray('没有找到匹配的技能'));
      return;
    }
    
    console.log(chalk.cyan('\n搜索结果 (来自 ClawHub):'));
    console.log(chalk.gray('─'.repeat(50)));
    
    for (const skill of results) {
      console.log(chalk.white(`  ${skill.slug}`) + chalk.gray(` - ${skill.displayName}`));
      console.log(chalk.gray(`    ${skill.summary.substring(0, 60)}...`));
      console.log(chalk.gray(`    版本: ${skill.version} | 相关度: ${skill.score.toFixed(2)}`));
    }
    
    console.log(chalk.gray('─'.repeat(50)));
    console.log(chalk.gray('使用 "baize skill install <slug>" 安装技能\n'));
    
  } catch (error) {
    spinner.fail('搜索失败');
    console.error(chalk.red(`错误: ${error}`));
  }
}

/**
 * 从 ClawHub 安装技能
 */
async function installSkill(slug: string): Promise<void> {
  if (!slug) {
    console.log(chalk.red('请提供技能 slug'));
    console.log(chalk.gray('使用 "baize skill search <关键词>" 搜索技能'));
    return;
  }
  
  console.log(chalk.cyan(`\n📦 安装技能: ${slug}`));
  console.log(chalk.gray('─'.repeat(50)));
  
  const steps = ['获取技能信息', '下载技能包', '解压文件', '检查依赖', '完成安装'];
  let currentStep = 0;
  
  const spinner = ora(steps[0]).start();
  
  const updateProgress = (step: number) => {
    currentStep = step;
    spinner.text = `${steps[step]} [${step + 1}/${steps.length}]`;
  };
  
  try {
    const client = getClawHubClient();
    
    // 模拟进度更新
    const progressInterval = setInterval(() => {
      if (currentStep < steps.length - 2) {
        updateProgress(currentStep + 1);
      }
    }, 500);
    
    const result = await client.install(slug);
    
    clearInterval(progressInterval);
    
    if (result.success) {
      spinner.succeed(`${steps[4]} [${steps.length}/${steps.length}]`);
      console.log(chalk.gray('─'.repeat(50)));
      console.log(chalk.green(`\n✓ 技能 ${slug} 安装成功`));
      console.log(chalk.gray(`  路径: ${result.path}`));
      
      if (result.warnings && result.warnings.length > 0) {
        console.log(chalk.yellow('\n提示:'));
        for (const w of result.warnings) {
          console.log(chalk.yellow(`  ${w}`));
        }
      }
      
      if (result.requiredEnv && result.requiredEnv.length > 0) {
        console.log(chalk.cyan('\n需要配置环境变量:'));
        for (const env of result.requiredEnv) {
          console.log(chalk.cyan(`  - ${env}`));
        }
      }
      
      console.log(chalk.gray('\n重启白泽后生效\n'));
    } else {
      spinner.fail(`安装失败: ${result.error}`);
      
      if (result.warnings && result.warnings.length > 0) {
        console.log(chalk.yellow('\n提示:'));
        for (const w of result.warnings) {
          console.log(chalk.yellow(`  ${w}`));
        }
      }
    }
    
  } catch (error) {
    spinner.fail('安装失败');
    console.error(chalk.red(`错误: ${error}`));
  }
}

/**
 * 卸载技能
 */
async function uninstallSkill(slug: string): Promise<void> {
  if (!slug) {
    console.log(chalk.red('请提供技能 slug'));
    return;
  }
  
  const spinner = ora(`卸载 ${slug}...`).start();
  
  try {
    const client = getClawHubClient();
    const result = await client.uninstall(slug);
    
    if (result.success) {
      spinner.succeed(`技能 ${slug} 已卸载`);
    } else {
      spinner.fail(`卸载失败: ${result.error}`);
    }
    
  } catch (error) {
    spinner.fail('卸载失败');
    console.error(chalk.red(`错误: ${error}`));
  }
}

/**
 * 显示技能详情
 */
async function showSkillInfo(slug: string): Promise<void> {
  if (!slug) {
    console.log(chalk.red('请提供技能 slug'));
    return;
  }
  
  const spinner = ora('获取详情...').start();
  
  try {
    const client = getClawHubClient();
    const details = await client.getSkillDetails(slug);
    
    if (!details) {
      spinner.fail('未找到技能');
      return;
    }
    
    spinner.succeed();
    
    console.log(chalk.cyan('\n技能详情 (来自 ClawHub):'));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(chalk.white(`  名称: ${details.skill.displayName}`));
    console.log(chalk.gray(`  Slug: ${details.skill.slug}`));
    console.log(chalk.gray(`  描述: ${details.skill.summary || '无'}`));
    console.log(chalk.gray(`  作者: ${details.owner?.handle || '未知'}`));
    if (details.latestVersion) {
      console.log(chalk.gray(`  版本: ${details.latestVersion.version}`));
      console.log(chalk.gray(`  更新: ${new Date(details.latestVersion.createdAt).toLocaleDateString()}`));
    }
    console.log(chalk.gray(`  下载: ${details.skill.stats.downloads} | 星标: ${details.skill.stats.stars}`));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(chalk.gray(`使用 "baize skill install ${slug}" 安装此技能\n`));
    
  } catch (error) {
    spinner.fail('获取详情失败');
    console.error(chalk.red(`错误: ${error}`));
  }
}

/**
 * 显示帮助
 */
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
  console.log(chalk.gray('\n技能命令 (连接 ClawHub 技能市场):'));
  console.log(chalk.gray('  baize skill list              列出已安装技能'));
  console.log(chalk.gray('  baize skill search <query>    搜索技能'));
  console.log(chalk.gray('  baize skill install <slug>    安装技能'));
  console.log(chalk.gray('  baize skill uninstall <slug>  卸载技能'));
  console.log(chalk.gray('  baize skill info <slug>       查看技能详情'));
  console.log();
}

main().catch((error) => {
  console.error(chalk.red(`错误: ${error}`));
  process.exit(1);
});
