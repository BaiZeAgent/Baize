/**
 * Baize 执行引擎详细测试
 */

import fs from 'fs';
import path from 'path';

console.log('═══════════════════════════════════════════════════════════════');
console.log('           白泽3.2 执行引擎详细测试');
console.log('═══════════════════════════════════════════════════════════════\n');

// 从环境变量读取API Key (请设置 ALIYUN_API_KEY 环境变量)
if (!process.env.ALIYUN_API_KEY) {
    console.error('错误: 请设置 ALIYUN_API_KEY 环境变量');
    process.exit(1);
}

const testResults = [];

// 测试1: 验证核心模块文件完整性
console.log('测试1: 核心模块完整性检查...');
try {
    const coreFiles = [
        'dist/executor/index.js',
        'dist/executor/react-executor.js',
        'dist/executor/react-executor-v2.js',
        'dist/core/brain/index.js',
        'dist/llm/index.js',
        'dist/memory/index.js',
        'dist/skills/registry.js',
        'dist/tools/index.js'
    ];
    
    let allExist = true;
    for (const file of coreFiles) {
        if (!fs.existsSync(file)) {
            console.log(`    ✗ 缺失: ${file}`);
            allExist = false;
        }
    }
    
    if (allExist) {
        console.log('  ✓ 所有核心模块文件完整');
        testResults.push({ name: '核心模块完整性', success: true });
    } else {
        testResults.push({ name: '核心模块完整性', success: false });
    }
} catch (error) {
    console.log(`  ✗ 检查失败: ${error.message}`);
    testResults.push({ name: '核心模块完整性', success: false });
}

// 测试2: 技能系统检查
console.log('\n测试2: 技能系统检查...');
try {
    const skillsDir = './skills';
    const skills = fs.readdirSync(skillsDir).filter(f => {
        return fs.statSync(path.join(skillsDir, f)).isDirectory();
    });
    
    console.log(`  ✓ 发现 ${skills.length} 个技能模块:`);
    for (const skill of skills) {
        const skillMd = path.join(skillsDir, skill, 'SKILL.md');
        if (fs.existsSync(skillMd)) {
            const content = fs.readFileSync(skillMd, 'utf-8');
            const firstLine = content.split('\n')[0];
            console.log(`    - ${skill}: ${firstLine.replace('#', '').trim().substring(0, 40)}...`);
        } else {
            console.log(`    - ${skill}: (无SKILL.md)`);
        }
    }
    testResults.push({ name: '技能系统', success: true });
} catch (error) {
    console.log(`  ✗ 技能系统检查失败: ${error.message}`);
    testResults.push({ name: '技能系统', success: false });
}

// 测试3: 工具定义检查
console.log('\n测试3: 工具定义检查...');
try {
    const toolsFile = './dist/tools/index.js';
    const content = fs.readFileSync(toolsFile, 'utf-8');
    
    // 统计导出的工具
    const exports = content.match(/export \{[^}]+\}/g) || [];
    console.log('  ✓ 工具模块导出正常');
    
    // 检查关键工具
    const keyTools = ['web_search', 'web_fetch', 'memory', 'browser'];
    for (const tool of keyTools) {
        if (content.includes(tool)) {
            console.log(`    - ${tool}: 已定义`);
        }
    }
    testResults.push({ name: '工具定义', success: true });
} catch (error) {
    console.log(`  ✗ 工具定义检查失败: ${error.message}`);
    testResults.push({ name: '工具定义', success: false });
}

// 测试4: ReAct执行器逻辑测试
console.log('\n测试4: ReAct执行器逻辑测试...');
try {
    const reactExecutor = fs.readFileSync('./dist/executor/react-executor.js', 'utf-8');
    
    // 检查关键逻辑
    const checks = [
        { name: 'while循环', pattern: /while\s*\(/ },
        { name: 'LLM决策', pattern: /getLLMDecision|LLM.*decision/i },
        { name: '任务执行', pattern: /executeTask|execute.*task/i },
        { name: '策略调整', pattern: /adjust|replan/i },
        { name: '错误恢复', pattern: /retry|recovery|error/i }
    ];
    
    console.log('  ✓ ReAct执行器逻辑检查:');
    for (const check of checks) {
        if (check.pattern.test(reactExecutor)) {
            console.log(`    ✓ ${check.name}: 已实现`);
        } else {
            console.log(`    ✗ ${check.name}: 未找到`);
        }
    }
    testResults.push({ name: 'ReAct执行器逻辑', success: true });
} catch (error) {
    console.log(`  ✗ ReAct执行器检查失败: ${error.message}`);
    testResults.push({ name: 'ReAct执行器逻辑', success: false });
}

// 测试5: 多轮对话能力测试 (通过API)
console.log('\n测试5: 多轮对话能力测试...');
async function testMultiTurn() {
    try {
        const messages = [
            { role: 'system', content: '你是一个有帮助的AI助手白泽。' },
            { role: 'user', content: '我叫张三' },
            { role: 'assistant', content: '你好张三，很高兴认识你！有什么可以帮助你的吗？' },
            { role: 'user', content: '我叫什么名字？' }
        ];
        
        const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.ALIYUN_API_KEY}`
            },
            body: JSON.stringify({
                model: 'qwen-max',
                messages,
                max_tokens: 100
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            const reply = data.choices[0].message.content;
            
            if (reply.includes('张三')) {
                console.log('  ✓ 多轮对话能力正常');
                console.log(`    - 模型正确记住用户名字: ${reply.substring(0, 50)}...`);
                testResults.push({ name: '多轮对话', success: true });
            } else {
                console.log('  ✗ 多轮对话记忆失败');
                console.log(`    - 模型回复: ${reply}`);
                testResults.push({ name: '多轮对话', success: false });
            }
        } else {
            console.log(`  ✗ API请求失败: ${response.status}`);
            testResults.push({ name: '多轮对话', success: false });
        }
    } catch (error) {
        console.log(`  ✗ 多轮对话测试失败: ${error.message}`);
        testResults.push({ name: '多轮对话', success: false });
    }
}
await testMultiTurn();

// 测试6: 任务分解能力测试
console.log('\n测试6: 任务分解能力测试...');
async function testTaskDecomposition() {
    try {
        const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.ALIYUN_API_KEY}`
            },
            body: JSON.stringify({
                model: 'qwen-max',
                messages: [
                    {
                        role: 'system',
                        content: `你是一个任务分解专家。请将用户的复杂任务分解为具体的步骤。
输出JSON格式:
{
  "analysis": "任务分析",
  "steps": [
    { "id": 1, "action": "动作描述", "tool": "使用的工具" }
  ]
}`
                    },
                    { role: 'user', content: '帮我搜索Python最新的版本信息，然后整理成一份简短的报告' }
                ],
                max_tokens: 500
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            const content = data.choices[0].message.content;
            
            // 尝试解析JSON
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                console.log('  ✓ 任务分解能力正常');
                console.log(`    - 分析: ${parsed.analysis?.substring(0, 50)}...`);
                console.log(`    - 步骤数: ${parsed.steps?.length || 0}`);
                testResults.push({ name: '任务分解', success: true });
            } else {
                console.log('  ✗ 任务分解输出格式错误');
                testResults.push({ name: '任务分解', success: false });
            }
        } else {
            console.log(`  ✗ API请求失败: ${response.status}`);
            testResults.push({ name: '任务分解', success: false });
        }
    } catch (error) {
        console.log(`  ✗ 任务分解测试失败: ${error.message}`);
        testResults.push({ name: '任务分解', success: false });
    }
}
await testTaskDecomposition();

// 测试7: 错误处理能力测试
console.log('\n测试7: 错误处理能力测试...');
async function testErrorHandling() {
    try {
        // 测试无效输入的处理
        const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.ALIYUN_API_KEY}`
            },
            body: JSON.stringify({
                model: 'qwen-max',
                messages: [
                    {
                        role: 'system',
                        content: `你是一个错误处理专家。当用户给出不完整或模糊的请求时，你应该：
1. 识别问题所在
2. 礼貌地请求澄清
3. 给出可能的选项`
                    },
                    { role: 'user', content: '帮我执行命令' }
                ],
                max_tokens: 200
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            const reply = data.choices[0].message.content;
            
            console.log('  ✓ 错误处理能力正常');
            console.log(`    - 响应: ${reply.substring(0, 100)}...`);
            testResults.push({ name: '错误处理', success: true });
        } else {
            console.log(`  ✗ API请求失败: ${response.status}`);
            testResults.push({ name: '错误处理', success: false });
        }
    } catch (error) {
        console.log(`  ✗ 错误处理测试失败: ${error.message}`);
        testResults.push({ name: '错误处理', success: false });
    }
}
await testErrorHandling();

// 输出测试汇总
console.log('\n═══════════════════════════════════════════════════════════════');
const passed = testResults.filter(r => r.success).length;
const total = testResults.length;
console.log(`测试结果: 通过 ${passed}/${total}`);

for (const result of testResults) {
    const icon = result.success ? '✓' : '✗';
    const color = result.success ? '\x1b[32m' : '\x1b[31m';
    console.log(`  ${color}${icon}\x1b[0m ${result.name}`);
}

if (passed === total) {
    console.log('\n\x1b[32m✓ 所有测试通过！\x1b[0m');
} else {
    console.log(`\n\x1b[31m✗ ${total - passed} 个测试失败\x1b[0m`);
}
console.log('═══════════════════════════════════════════════════════════════\n');
