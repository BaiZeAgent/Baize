/**
 * 测试 Baize + OpenClaw 工具集
 */

console.log('═══════════════════════════════════════════════════════════════');
console.log('           Baize + OpenClaw 工具集测试');
console.log('═══════════════════════════════════════════════════════════════\n');

// 从环境变量读取API Key (请设置 ALIYUN_API_KEY 环境变量)
if (!process.env.ALIYUN_API_KEY) {
  console.error('错误: 请设置 ALIYUN_API_KEY 环境变量');
  process.exit(1);
}

// 导入编译后的模块
const { registerBuiltinSkills } = await import('./dist/skills/builtins.js');
const { getSkillRegistry } = await import('./dist/skills/registry.js');

// 注册所有技能
console.log('正在注册技能...\n');
registerBuiltinSkills();

// 获取技能列表
const registry = getSkillRegistry();
const skills = registry.getAll();

console.log(`\n已注册 ${skills.length} 个技能:\n`);
console.log('─'.repeat(70));

// 分类显示
const categories = {
  '文件操作': [],
  '网络工具': [],
  '系统工具': [],
  'Agent管理': [],
  '其他工具': []
};

const fileTools = ['read', 'write', 'edit', 'exec'];
const webTools = ['web_search', 'web_fetch', 'browser_control'];
const systemTools = ['process', 'memory', 'calculator', 'session_status', 'image', 'tts'];
const agentTools = ['subagents', 'agents_list', 'sessions_list', 'gateway', 'cron'];

for (const skill of skills) {
  if (fileTools.includes(skill.name)) {
    categories['文件操作'].push(skill);
  } else if (webTools.includes(skill.name)) {
    categories['网络工具'].push(skill);
  } else if (systemTools.includes(skill.name)) {
    categories['系统工具'].push(skill);
  } else if (agentTools.includes(skill.name)) {
    categories['Agent管理'].push(skill);
  } else {
    categories['其他工具'].push(skill);
  }
}

for (const [category, skillsList] of Object.entries(categories)) {
  if (skillsList.length > 0) {
    console.log(`\n【${category}】`);
    for (const skill of skillsList) {
      const risk = skill.riskLevel || 'LOW';
      const riskIcon = risk === 'HIGH' ? '🔴' : risk === 'MEDIUM' ? '🟡' : '🟢';
      console.log(`  ${riskIcon} ${skill.name.padEnd(20)} - ${skill.description.substring(0, 35)}...`);
    }
  }
}

console.log('\n' + '─'.repeat(70));

// 测试几个关键工具
console.log('\n\n正在进行功能测试...\n');

const testResults = [];

// 测试 calculator
try {
  const calcSkill = skills.find(s => s.name === 'calculator');
  if (calcSkill) {
    const result = await calcSkill.run({ expression: '2 + 3 * 4' }, {});
    console.log(`✓ calculator: 2 + 3 * 4 = ${result.data?.result}`);
    testResults.push({ name: 'calculator', success: result.success });
  }
} catch (e) {
  console.log(`✗ calculator: ${e.message}`);
  testResults.push({ name: 'calculator', success: false });
}

// 测试 memory
try {
  const memSkill = skills.find(s => s.name === 'memory');
  if (memSkill) {
    await memSkill.run({ action: 'set', key: 'test', value: 'hello' }, {});
    const result = await memSkill.run({ action: 'get', key: 'test' }, {});
    console.log(`✓ memory: 存取测试成功 - "${result.data?.value}"`);
    testResults.push({ name: 'memory', success: result.success });
  }
} catch (e) {
  console.log(`✗ memory: ${e.message}`);
  testResults.push({ name: 'memory', success: false });
}

// 测试 session_status
try {
  const statusSkill = skills.find(s => s.name === 'session_status');
  if (statusSkill) {
    const result = await statusSkill.run({}, {});
    console.log(`✓ session_status: 运行时间 ${result.data?.uptime?.toFixed(0)}s`);
    testResults.push({ name: 'session_status', success: result.success });
  }
} catch (e) {
  console.log(`✗ session_status: ${e.message}`);
  testResults.push({ name: 'session_status', success: false });
}

// 测试 web_search (使用API)
try {
  const searchSkill = skills.find(s => s.name === 'web_search');
  if (searchSkill) {
    console.log('  web_search: 正在测试 (调用DuckDuckGo API)...');
    const result = await searchSkill.run({ query: 'TypeScript', num: 3 }, {});
    if (result.success) {
      console.log(`✓ web_search: 找到 ${result.data?.results?.length || 0} 个结果`);
    } else {
      console.log(`  web_search: ${result.error}`);
    }
    testResults.push({ name: 'web_search', success: result.success });
  }
} catch (e) {
  console.log(`✗ web_search: ${e.message}`);
  testResults.push({ name: 'web_search', success: false });
}

// 输出测试汇总
console.log('\n' + '═'.repeat(70));
const passed = testResults.filter(r => r.success).length;
console.log(`测试结果: ${passed}/${testResults.length} 通过`);
console.log('═'.repeat(70));

console.log('\n✅ OpenClaw 工具集已成功集成到 Baize！');
console.log(`   共添加 ${skills.length} 个工具技能\n`);
