/**
 * CLI交互模块
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
 * 启动交互模式
 */
export async function startInteractive(): Promise<void> {
  await initialize();

  const brain = getBrain();
  const memory = getMemory();
  const llmManager = getLLMManager();

  console.log(chalk.green('\n🦌 白泽3.0 已启动'));
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

        // 调用大脑处理
        const spinner = ora('思考中...').start();
        const startTime = Date.now();

        const decision = await brain.process(trimmed);
        const duration = (Date.now() - startTime) / 1000;

        spinner.succeed('思考完成');

        // 根据决策类型处理
        switch (decision.action) {
          case 'reply':
            // 直接回复
            console.log(chalk.gray('\n【意图】') + chalk.gray(decision.intent));
            console.log(chalk.cyan('\n白泽:'), decision.response);
            memory.recordEpisode('conversation', `白泽: ${decision.response}`);
            break;

          case 'confirm':
            // 需要确认
            console.log(chalk.yellow('\n⚠️ 需要确认'));
            console.log(chalk.gray(decision.confirmMessage));
            // 这里可以添加确认逻辑
            break;

          case 'execute':
            // 执行任务
            if (decision.thoughtProcess) {
              console.log(chalk.gray('\n【思考过程】'));
              console.log(chalk.gray(`  理解: ${decision.thoughtProcess.understanding.coreNeed}`));

              if (decision.thoughtProcess.decomposition.tasks.length > 0) {
                console.log(chalk.gray(`  任务: ${decision.thoughtProcess.decomposition.tasks.map(t => `${t.description} [${t.skillName || 'LLM'}]`).join(' → ')}`));
              }

              // 执行任务（传入用户意图用于后处理）
              if (decision.thoughtProcess.decomposition.tasks.length > 0 && decision.thoughtProcess.scheduling) {
                const executor = getExecutor();
                const result = await executor.execute(
                  decision.thoughtProcess.decomposition.tasks,
                  decision.thoughtProcess.scheduling.parallelGroups,
                  {}, // context
                  undefined, // stepCallback
                  trimmed // userIntent - 传入用户原始意图
                );

                console.log(chalk.cyan('\n白泽:'), result.finalMessage);
                memory.recordEpisode('conversation', `白泽: ${result.finalMessage}`);
                // 记录任务结果到大脑历史
                brain.recordTaskResult(result.finalMessage);
              }
            }
            break;

          case 'clarify':
            // 需要澄清
            console.log(chalk.cyan('\n白泽:'), decision.response);
            break;
        }

        console.log(chalk.gray(`[耗时 ${duration.toFixed(2)}s]\n`));

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
  const spinner = ora('思考中...').start();

  try {
    const decision = await brain.process(message);
    spinner.succeed();

    if (decision.response) {
      console.log(decision.response);
    } else if (decision.thoughtProcess) {
      console.log(JSON.stringify(decision.thoughtProcess, null, 2));
    }

  } catch (error) {
    spinner.fail();
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
  console.log(chalk.cyan('           白泽3.0 功能测试'));
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
      name: 'LLM调用',
      run: async () => {
        const llm = getLLMManager();
        const response = await llm.chat([
          { role: 'user', content: '回复"测试成功"两个字' },
        ]);
        return `响应: ${response.content.substring(0, 20)}...`;
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
  
  const spinner = ora(`从 ClawHub 安装 ${slug}...`).start();
  
  try {
    const client = getClawHubClient();
    const result = await client.install(slug);
    
    if (result.success) {
      spinner.succeed(`技能 ${slug} 安装成功`);
      console.log(chalk.gray(`路径: ${result.path}`));
      console.log(chalk.gray('重启白泽后生效\n'));
    } else {
      spinner.fail(`安装失败: ${result.error}`);
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
  console.log(chalk.cyan('\n白泽3.0 命令行工具'));
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
