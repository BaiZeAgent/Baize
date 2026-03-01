#!/usr/bin/env node
/**
 * 白泽 V3 实际运行测试 (JavaScript 版本)
 * 
 * 使用阿里百炼 API 进行实际测试
 */

require('dotenv').config();
const chalk = require('chalk');
const readline = require('readline');

// ═══════════════════════════════════════════════════════════════
// 配置
// ═══════════════════════════════════════════════════════════════

const TEST_SCENARIOS = [
  {
    category: '基础对话',
    tests: [
      '你好，请介绍一下你自己',
      '今天天气怎么样',
      '你能做什么',
    ]
  },
  {
    category: '浏览器自动化',
    tests: [
      '打开百度首页',
      '在百度搜索 人工智能',
      '打开掘金网站',
    ]
  },
  {
    category: '文员办公',
    tests: [
      '帮我总结这段话：人工智能是计算机科学的一个分支，它企图了解智能的实质，并生产出一种新的能以人类智能相似的方式做出反应的智能机器。',
      '把这些数据做成表格：张三 90分，李四 85分，王五 92分',
      '帮我写一份简单的工作周报',
    ]
  },
];

// ═══════════════════════════════════════════════════════════════
// 初始化
// ═══════════════════════════════════════════════════════════════

async function initialize() {
  console.log(chalk.cyan('\n═══════════════════════════════════════════════════════════════'));
  console.log(chalk.cyan('           白泽 V3 实际运行测试'));
  console.log(chalk.cyan('═══════════════════════════════════════════════════════════════\n'));
  
  // 检查 API Key
  const apiKey = process.env.ALIYUN_API_KEY;
  if (!apiKey) {
    console.log(chalk.red('错误: 未设置 ALIYUN_API_KEY 环境变量'));
    console.log(chalk.gray('请在 .env 文件中设置: ALIYUN_API_KEY=your_api_key'));
    process.exit(1);
  }
  console.log(chalk.green('✓ API Key 已配置'));
  console.log(chalk.gray(`  Key: ${apiKey.substring(0, 10)}...${apiKey.substring(apiKey.length - 4)}`));
  
  // 初始化数据库
  const { initDatabase } = require('./dist/memory/database');
  await initDatabase();
  console.log(chalk.green('✓ 数据库初始化完成'));
  
  // 初始化 LLM
  const { getLLMManager } = require('./dist/llm');
  const llm = getLLMManager();
  const providers = llm.getAvailableProviders();
  console.log(chalk.green('✓ LLM 初始化完成'));
  console.log(chalk.gray(`  可用提供商: ${providers.join(', ')}`));
  
  // 注册内置技能
  const { registerBuiltinSkills } = require('./dist/skills/builtins');
  registerBuiltinSkills();
  console.log(chalk.green('✓ 内置技能注册完成'));
  
  // 加载外部技能
  const { SkillLoader } = require('./dist/skills/loader');
  const { getSkillRegistry } = require('./dist/skills/registry');
  const loader = new SkillLoader();
  const skills = await loader.loadAll();
  const registry = getSkillRegistry();
  for (const skill of skills) {
    registry.register(skill);
  }
  console.log(chalk.green(`✓ 已加载 ${registry.size} 个技能`));
  
  // 列出技能
  const allSkills = registry.getAll();
  console.log(chalk.cyan('\n已加载技能:'));
  for (const skill of allSkills.slice(0, 10)) {
    console.log(chalk.white(`  - ${skill.name}: ${skill.description}`));
  }
  if (allSkills.length > 10) {
    console.log(chalk.gray(`  ... 还有 ${allSkills.length - 10} 个技能`));
  }
  
  return { llm, registry };
}

// ═══════════════════════════════════════════════════════════════
// 自动化测试
// ═══════════════════════════════════════════════════════════════

async function runAutoTests() {
  console.log(chalk.cyan('\n【自动化测试开始】\n'));
  
  const { getBrainV3 } = require('./dist/core/brain-v3');
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
          const response = result.response || '';
          console.log(chalk.white(`响应: ${response.substring(0, 300)}${response.length > 300 ? '...' : ''}`));
        } else {
          console.log(chalk.red(`✗ 失败: ${result.response}`));
        }
      } catch (error) {
        console.log(chalk.red(`✗ 错误: ${error.message || error}`));
      }
      
      console.log();
      
      // 避免请求过快
      await new Promise(resolve => setTimeout(resolve, 1500));
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

async function startInteractive() {
  console.log(chalk.cyan('\n【交互式测试模式】'));
  console.log(chalk.gray('输入消息进行测试，输入 "exit" 退出，输入 "report" 查看自我评估报告\n'));
  
  const { getBrainV3 } = require('./dist/core/brain-v3');
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
        try {
          const report = await brain.getSelfAssessment();
          console.log(report);
        } catch (e) {
          console.log(chalk.red(`生成报告失败: ${e.message}`));
        }
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
              const thinkingData = event.data;
              console.log(chalk.gray(`  [思考] ${thinkingData.message}`));
              break;
              
            case 'tool_call':
              const toolCallData = event.data;
              console.log(chalk.blue(`  [工具] 调用: ${toolCallData.tool}`));
              break;
              
            case 'tool_result':
              const toolResultData = event.data;
              const icon = toolResultData.success ? '✓' : '✗';
              const color = toolResultData.success ? chalk.green : chalk.red;
              console.log(color(`  [结果] ${icon} ${toolResultData.duration}ms`));
              break;
              
            case 'content':
              const contentData = event.data;
              process.stdout.write(chalk.white(contentData.text));
              break;
              
            case 'done':
              console.log();
              break;
              
            case 'error':
              const errorData = event.data;
              console.log(chalk.red(`  [错误] ${errorData.message}`));
              break;
          }
        }
        
        console.log();
        
      } catch (error) {
        console.log(chalk.red(`错误: ${error.message || error}`));
      }
      
      askQuestion();
    });
  };
  
  askQuestion();
}

// ═══════════════════════════════════════════════════════════════
// 主函数
// ═══════════════════════════════════════════════════════════════

async function main() {
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
    console.error(chalk.red(`\n执行错误: ${error.message || error}`));
    console.error(error.stack);
    process.exit(1);
  }
}

main();
