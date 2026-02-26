/**
 * 快速多场景测试
 */

import { initDatabase } from './src/memory/database';
import { getLLMManager } from './src/llm';
import { getSkillRegistry } from './src/skills/registry';
import { registerBuiltinSkills } from './src/skills/builtins';
import { SkillLoader } from './src/skills/loader';
import { getBrainV2 } from './src/core/brain/brain-v2';

async function main(): Promise<void> {
  await initDatabase();
  getLLMManager();
  registerBuiltinSkills();
  const loader = new SkillLoader();
  const skills = await loader.loadAll();
  const registry = getSkillRegistry();
  for (const skill of skills) {
    registry.register(skill);
  }

  const brain = getBrainV2();
  const results: { scenario: string; success: boolean; duration: number }[] = [];

  // 测试场景
  const scenarios = [
    { name: '问候', input: '你好' },
    { name: '问答', input: '什么是AI' },
    { name: '任务', input: '列出文件' },
    { name: '技能', input: '有什么技能' },
    { name: '情感', input: '心情不好' },
  ];

  for (const s of scenarios) {
    const start = Date.now();
    try {
      const d = await brain.process(s.input);
      results.push({ scenario: s.name, success: true, duration: Date.now() - start });
      console.log(`[${s.name}] OK ${Date.now() - start}ms`);
    } catch (e) {
      results.push({ scenario: s.name, success: false, duration: Date.now() - start });
      console.log(`[${s.name}] FAIL ${Date.now() - start}ms`);
    }
  }

  const passed = results.filter(r => r.success).length;
  console.log(`\nTotal: ${results.length}, Passed: ${passed}, Failed: ${results.length - passed}`);
  
  process.exit(0);
}

main().catch(console.error);
