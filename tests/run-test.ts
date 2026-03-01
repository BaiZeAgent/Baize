/**
 * 白泽 V3 实际运行测试
 * 
 * 测试场景：
 * 1. 基础对话
 * 2. 浏览器自动化
 * 3. 文员办公
 * 4. 多场景综合
 */

import chalk from 'chalk';
import * as readline from 'readline';
import { getBrainV3 } from '../src/core/brain-v3';
import { initDatabase } from '../src/memory/database';
import { getLLMManager } from '../src/llm';
import { registerBuiltinSkills } from '../src/skills/builtins';
import { SkillLoader } from '../src/skills/loader';
import { getSkillRegistry } from '../src/skills/registry';

// ═══════════════════════════════════════════════════════════════
// 配置
// ═══════════════════════════════════════════════════════════════

const TEST_SCENARIOS = [
  // 基础对话
  {
    category: '基础对话',
    tests: [
      '你好，请介绍一下你自己',
      '今天天气怎么样',
      '你能做什么',
    ]
  },
  
  // 浏览器自动化
  {
    category: '浏览器自动化',
    tests: [
      '打开百度首页',
      '在百度搜索 人工智能',
      '打开掘金网站 https://juejin.cn',
    ]
  },
  
  // 文员办公
  {
    category: '文员办公',
    tests: [
      '帮我总结这段话：人工智能是计算机科学的一个分支，它企图了解智能的实质，并生产出一种新的能以人类智能相似的方式做出反应的智能机器。',
      '把这些数据做成表格：张三 90分，李四 85分，王五 92分',
      '帮我写一份简单的工作周报',
    ]
  },
  
  // 综合场景
  {
    category: '综合场景',
    tests: [
      '帮我查一下杭州今天的天气',
      '读取这个网页的内容：https://www.baidu.com',
      '整理一下我的待办事项：开会、写报告、回复邮件',
    ]
  }
];

// ═══════════════════════════════════════════════════════════════
// 初始化
// ═══════════════════════════════════════════════════════════════

async function initialize(): Promise<void> {
  console.log(chalk.cyan('\n═══════════════════════════════════════════════════════════════'));
  console.log(chalk.cyan('           白泽 V3 实际运行测试'));
  console.log(chalk.cyan('═══════════════════════════════════════════════════════════════\n'));
  
  // 初始化数据库
  await initDatabase();
  
  // 初始化 LLM
  const llm = getLLMManager();
  const providers = llm.getAvailableProviders();
  console.log(chalk.gray(`可用 LLM 提供商: ${providers.join(', ')}`));
  
  // 注册内置技能
  registerBuiltinSkills();
  
  // 加载外部技能
  const loader = new SkillLoader();
  const skills = await loader.loadAll();
  const registry = getSkillRegistry();
  for (const skill of skills) {
    registry.register(skill);
  }
  
  console.log(chalk.gray(`已加载 ${registry.size} 个技能\n`));
  
  // 列出已加载的技能
  const allSkills = registry.getAll();
  console.log(chalk.cyan('已加载技能:'));
  for (const skill of allSkills) {
    console.log(chalk.white(`  - ${skill.name}: ${skill.description}`));
  }
  console.log();
}

// ═══════════════════════════════════════════════════════════════
// 自动化测试
// ═══════════════════════════════════════════════════════════════

async function runAutoTests(): Promise<void> {
  console.log(chalk.cyan('\n【自动化测试开始】\n'));
  
  const brain = getBrainV3();
  let totalTests = 0;
  let passedTests = 0;
  
  for (const scenario of TEST_SCENARIOS) {
    console.log(chalk.cyan(`\n━━━ ${scenario.category} ━━━\n`));
    
    for (const test of scenario.tests) {
      totalTests++;
      console.log(chalk.white(`测试: ${test}`));
      console.log(chalk.gray('─'.repeat(50)));
      
      const startTime = Date.now();
      
      try {
        const result = await brain.process(test, 'auto-test');
        const duration = Date.now() - startTime;
        
        if (result.success) {
          passedTests++;
          console.log(chalk.green(`✓ 成功 (${duration}ms)`));
          console.log(chalk.white(`响应: ${result.response.substring(0, 200)}${result.response.length > 200 ? '...' : ''}`));
        } else {
          console.log(chalk.red(`✗ 失败: ${result.response}`));
        }
      } catch (error) {
        console.log(chalk.red(`✗ 错误: ${error}`));
      }
      
      console.log();
      
      // 避免请求过快
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  // 测试报告
  console.log(chalk.cyan('\n═══════════════════════════════════════════════════════════════'));
  console.log(chalk.cyan('                    测试报告'));
  console.log(chalk.cyan('═══════════════════════════════════════════════════════════════\n'));
  
  console.log(`总计: ${totalTests} 个测试`);
  console.log(chalk.green(`通过: ${passedTests}`));
  console.log(chalk.red(`失败: ${totalTests - passedTests}`));
  console.log(chalk.gray(`成功率: ${(passedTests / totalTests * 100).toFixed(1)}%\n`));
}

// ═══════════════════════════════════════════════════════════════
// 交互式测试
// ═══════════════════════════════════════════════════════════════

async function startInteractive(): Promise<void> {
  console.log(chalk.cyan('\n【交互式测试模式】'));
  console.log(chalk.gray('输入消息进行测试，输入 "exit" 退出，输入 "report" 查看自我评估报告\n'));
  
  const brain = getBrainV3();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  const askQuestion = () => {
    rl.question(chalk.cyan('你: '), async (input) => {
      const trimmed = input.trim();
      
      if (trimmed.toLowerCase() === 'exit') {
        console.log(chalk.gray('\n再见！'));
        rl.close();
        return;
      }
      
      if (trimmed.toLowerCase() === 'report') {
        console.log(chalk.cyan('\n生成自我评估报告...\n'));
        const report = await brain.getSelfAssessment();
        console.log(report);
        askQuestion();
        return;
      }
      
      if (!trimmed) {
        askQuestion();
        return;
      }
      
      try {
        console.log();
        
        // 流式输出
        for await (const event of brain.processStream(trimmed, 'interactive-test')) {
          switch (event.type) {
            case 'thinking':
              const thinkingData = event.data as any;
              console.log(chalk.gray(`  [思考] ${thinkingData.message}`));
              break;
              
            case 'tool_call':
              const toolCallData = event.data as any;
              console.log(chalk.blue(`  [工具] 调用: ${toolCallData.tool}`));
              break;
              
            case 'tool_result':
              const toolResultData = event.data as any;
              const icon = toolResultData.success ? '✓' : '✗';
              const color = toolResultData.success ? chalk.green : chalk.red;
              console.log(color(`  [结果] ${icon} ${toolResultData.duration}ms`));
              break;
              
            case 'content':
              const contentData = event.data as any;
              process.stdout.write(chalk.white(contentData.text));
              break;
              
            case 'done':
              console.log();
              break;
              
            case 'error':
              const errorData = event.data as any;
              console.log(chalk.red(`  [错误] ${errorData.message}`));
              break;
          }
        }
        
        console.log();
        
      } catch (error) {
        console.log(chalk.red(`错误: ${error}`));
      }
      
      askQuestion();
    });
  };
  
  askQuestion();
}

// ═══════════════════════════════════════════════════════════════
// 主函数
// ═══════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = args[0] || 'interactive';
  
  try {
    await initialize();
    
    if (mode === 'auto') {
      await runAutoTests();
    } else {
      await startInteractive();
    }
    
  } catch (error) {
    console.error(chalk.red(`\n执行错误: ${error}`));
    process.exit(1);
  }
}

main();
