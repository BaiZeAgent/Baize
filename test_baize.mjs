/**
 * Baize 功能测试脚本
 */

import YAML from 'yaml';
import fs from 'fs';
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

// 从环境变量读取API Key (请设置 ALIYUN_API_KEY 环境变量)
if (!process.env.ALIYUN_API_KEY) {
    console.error('错误: 请设置 ALIYUN_API_KEY 环境变量');
    process.exit(1);
}

console.log('═══════════════════════════════════════════════════════════════');
console.log('           白泽3.2 功能测试');
console.log('═══════════════════════════════════════════════════════════════\n');

async function main() {
    const testResults = [];
    
    // 测试1: 配置加载
    console.log('测试1: 配置加载...');
    try {
        const llmConfig = fs.readFileSync('./config/llm.yaml', 'utf-8');
        const config = YAML.parse(llmConfig);
        console.log(`  ✓ 配置加载成功`);
        console.log(`    - 默认提供商: ${config.default}`);
        console.log(`    - 可用提供商: ${Object.keys(config.providers).join(', ')}`);
        testResults.push({ name: '配置加载', success: true });
    } catch (error) {
        console.log(`  ✗ 配置加载失败: ${error.message}`);
        testResults.push({ name: '配置加载', success: false });
    }
    
    // 测试2: API连接测试
    console.log('\n测试2: API连接测试...');
    try {
        const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.ALIYUN_API_KEY}`
            },
            body: JSON.stringify({
                model: 'qwen-max',
                messages: [{ role: 'user', content: '你好' }],
                max_tokens: 50
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            console.log(`  ✓ API连接成功`);
            console.log(`    - 模型: ${data.model}`);
            console.log(`    - 响应: ${data.choices[0].message.content.substring(0, 50)}...`);
            testResults.push({ name: 'API连接', success: true });
        } else {
            const errorText = await response.text();
            console.log(`  ✗ API连接失败: ${response.status} - ${errorText}`);
            testResults.push({ name: 'API连接', success: false });
        }
    } catch (error) {
        console.log(`  ✗ API连接失败: ${error.message}`);
        testResults.push({ name: 'API连接', success: false });
    }
    
    // 测试3: 流式响应测试
    console.log('\n测试3: 流式响应测试...');
    try {
        const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.ALIYUN_API_KEY}`
            },
            body: JSON.stringify({
                model: 'qwen-max',
                messages: [{ role: 'user', content: '请用一句话介绍白泽' }],
                max_tokens: 100,
                stream: true
            })
        });
        
        if (response.ok) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullContent = '';
            let chunkCount = 0;
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value);
                const lines = chunk.split('\n').filter(line => line.startsWith('data: '));
                
                for (const line of lines) {
                    const data = line.slice(6);
                    if (data === '[DONE]') continue;
                    try {
                        const parsed = JSON.parse(data);
                        const content = parsed.choices[0]?.delta?.content || '';
                        fullContent += content;
                        chunkCount++;
                    } catch (e) {}
                }
            }
            
            console.log(`  ✓ 流式响应成功`);
            console.log(`    - 接收数据块: ${chunkCount}`);
            console.log(`    - 完整响应: ${fullContent.substring(0, 80)}...`);
            testResults.push({ name: '流式响应', success: true });
        } else {
            console.log(`  ✗ 流式响应失败: ${response.status}`);
            testResults.push({ name: '流式响应', success: false });
        }
    } catch (error) {
        console.log(`  ✗ 流式响应失败: ${error.message}`);
        testResults.push({ name: '流式响应', success: false });
    }
    
    // 测试4: 任务规划能力测试
    console.log('\n测试4: 任务规划能力测试...');
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
                        content: `你是一个任务规划助手。请将用户的请求分解为可执行的步骤。
输出JSON格式的任务列表：
{
  "tasks": [
    { "id": "task_1", "type": "skill", "skillName": "技能名", "description": "任务描述" }
  ]
}

可用技能：calculator, file_read, file_write, web_search, web_fetch`
                    },
                    { role: 'user', content: '帮我查询北京今天的天气，然后计算温度的华氏度值' }
                ],
                max_tokens: 500
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            const content = data.choices[0].message.content;
            console.log(`  ✓ 任务规划成功`);
            console.log(`    - 规划结果:\n${content.substring(0, 300)}`);
            testResults.push({ name: '任务规划', success: true });
        } else {
            console.log(`  ✗ 任务规划失败: ${response.status}`);
            testResults.push({ name: '任务规划', success: false });
        }
    } catch (error) {
        console.log(`  ✗ 任务规划失败: ${error.message}`);
        testResults.push({ name: '任务规划', success: false });
    }
    
    // 测试5: ReAct循环模拟测试
    console.log('\n测试5: ReAct循环模拟测试...');
    try {
        const messages = [
            {
                role: 'system',
                content: `你是一个ReAct执行器。按照Thought -> Action -> Observation的循环执行任务。
当前任务：计算 15 + 27 的结果。

请按照以下格式输出：
Thought: 思考过程
Action: 执行动作 {"skill": "calculator", "params": {"expression": "..."}}
Observation: 观察结果
Answer: 最终答案`
            },
            { role: 'user', content: '请执行计算任务' }
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
                max_tokens: 500
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            const content = data.choices[0].message.content;
            console.log(`  ✓ ReAct循环测试成功`);
            console.log(`    - 执行过程:\n${content.substring(0, 400)}`);
            testResults.push({ name: 'ReAct循环', success: true });
        } else {
            console.log(`  ✗ ReAct循环测试失败: ${response.status}`);
            testResults.push({ name: 'ReAct循环', success: false });
        }
    } catch (error) {
        console.log(`  ✗ ReAct循环测试失败: ${error.message}`);
        testResults.push({ name: 'ReAct循环', success: false });
    }
    
    // 输出测试结果汇总
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
}

main().catch(console.error);
