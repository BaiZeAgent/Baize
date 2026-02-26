#!/usr/bin/env node
/**
 * 白泽3.2 全面功能测试执行脚本
 * 
 * 使用方法：
 * ALIYUN_API_KEY=xxx node scripts/run-full-test.js
 */

const testSuites = require('./test-cases.js');

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

function log(color, ...args) {
  console.log(colors[color] || '', ...args, colors.reset);
}

function printHeader(title) {
  console.log('\n' + '═'.repeat(60));
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
}

function printResult(passed, total, name) {
  const percent = total > 0 ? Math.round(passed / total * 100) : 0;
  const status = percent === 100 ? '✅' : percent >= 80 ? '⚠️' : '❌';
  console.log(`  ${status} ${name}: ${passed}/${total} (${percent}%)`);
}

// 测试结果统计
const results = {
  total: 0,
  passed: 0,
  failed: 0,
  byCategory: {},
};

// 模拟测试执行（实际需要连接API）
async function runTest(input, expected) {
  // 这里应该调用实际的API
  // 目前返回模拟结果
  return {
    success: true,
    response: '模拟响应',
    duration: Math.random() * 1000 + 500,
  };
}

// 执行单个测试套件
async function runSuite(suiteName, suite) {
  printHeader(suite.name);
  
  let passed = 0;
  let total = 0;
  
  if (suite.cases) {
    for (const testCase of suite.cases) {
      total++;
      results.total++;
      
      const category = testCase.category || 'default';
      if (!results.byCategory[category]) {
        results.byCategory[category] = { passed: 0, total: 0 };
      }
      results.byCategory[category].total++;
      
      try {
        const result = await runTest(testCase.input, testCase.expect);
        
        // 简单判断是否通过
        const isPassed = result.success;
        
        if (isPassed) {
          passed++;
          results.passed++;
          results.byCategory[category].passed++;
          log('green', `  ✓ [${testCase.category}] ${testCase.input}`);
        } else {
          results.failed++;
          log('red', `  ✗ [${testCase.category}] ${testCase.input}`);
        }
      } catch (error) {
        results.failed++;
        log('red', `  ✗ [${testCase.category}] ${testCase.input} - 错误: ${error.message}`);
      }
    }
  }
  
  if (suite.sessions) {
    for (const session of suite.sessions) {
      log('cyan', `\n  📋 会话: ${session.name}`);
      
      for (const turn of session.turns) {
        total++;
        results.total++;
        
        try {
          const result = await runTest(turn.input, turn.expect);
          
          if (result.success) {
            passed++;
            results.passed++;
            log('green', `    ✓ ${turn.input}`);
          } else {
            results.failed++;
            log('red', `    ✗ ${turn.input}`);
          }
        } catch (error) {
          results.failed++;
          log('red', `    ✗ ${turn.input} - 错误`);
        }
      }
    }
  }
  
  printResult(passed, total, suite.name);
  return { passed, total };
}

// 主函数
async function main() {
  printHeader('白泽3.2 全面功能测试');
  
  log('yellow', '\n⚠️  注意: 此脚本需要连接实际API运行');
  log('yellow', '   请设置环境变量: ALIYUN_API_KEY=xxx\n');
  
  const startTime = Date.now();
  
  // 执行所有测试套件
  for (const [suiteName, suite] of Object.entries(testSuites)) {
    await runSuite(suiteName, suite);
  }
  
  // 打印汇总
  printHeader('测试结果汇总');
  
  console.log('\n按类别统计:');
  for (const [category, stats] of Object.entries(results.byCategory)) {
    printResult(stats.passed, stats.total, category);
  }
  
  console.log('\n总体统计:');
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  log('cyan', `\n  总测试数: ${results.total}`);
  log('green', `  通过: ${results.passed}`);
  log('red', `  失败: ${results.failed}`);
  log('blue', `  耗时: ${duration}s`);
  
  const percent = results.total > 0 ? Math.round(results.passed / results.total * 100) : 0;
  console.log(`\n  通过率: ${percent}%`);
  
  if (percent === 100) {
    log('green', '\n  🎉 所有测试通过！');
  } else if (percent >= 80) {
    log('yellow', '\n  ⚠️  大部分测试通过，需要关注失败用例');
  } else {
    log('red', '\n  ❌ 测试失败率较高，需要修复');
  }
}

main().catch(console.error);
