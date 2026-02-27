/**
 * ProcessTool 功能测试
 */

import { initDatabase } from './src/memory/database';
import { getSkillRegistry } from './src/skills/registry';
import { registerBuiltinSkills } from './src/skills/builtins';

async function main(): Promise<void> {
  await initDatabase();
  registerBuiltinSkills();
  
  const registry = getSkillRegistry();
  const processSkill = registry.get('process');
  
  if (!processSkill) {
    console.log('ProcessTool not found!');
    process.exit(1);
  }

  console.log('=== ProcessTool 功能测试 ===\n');

  // 测试 1: 列出进程
  console.log('[测试 1] 列出进程');
  const listResult = await processSkill.run({ action: 'list' }, {});
  console.log(`成功: ${listResult.success}`);
  console.log(`消息: ${listResult.message?.slice(0, 200)}...\n`);

  // 测试 2: 启动进程
  console.log('[测试 2] 启动进程 (echo hello)');
  const spawnResult = await processSkill.run({
    action: 'spawn',
    command: 'echo',
    args: ['hello', 'world'],
  }, {});
  console.log(`成功: ${spawnResult.success}`);
  console.log(`消息: ${spawnResult.message}`);
  const sessionId = (spawnResult.data as any)?.sessionId;
  console.log(`Session ID: ${sessionId}\n`);

  if (sessionId) {
    // 测试 3: 轮询进程
    console.log('[测试 3] 轮询进程');
    await new Promise(r => setTimeout(r, 500)); // 等待进程完成
    const pollResult = await processSkill.run({
      action: 'poll',
      sessionId,
    }, {});
    console.log(`成功: ${pollResult.success}`);
    console.log(`消息: ${pollResult.message?.slice(0, 200)}...\n`);
  }

  // 测试 4: 启动长时间运行的进程
  console.log('[测试 4] 启动长时间进程 (sleep 5)');
  const longSpawnResult = await processSkill.run({
    action: 'spawn',
    command: 'sleep',
    args: ['5'],
  }, {});
  console.log(`成功: ${longSpawnResult.success}`);
  const longSessionId = (longSpawnResult.data as any)?.sessionId;
  console.log(`Session ID: ${longSessionId}\n`);

  if (longSessionId) {
    // 测试 5: 轮询运行中的进程
    console.log('[测试 5] 轮询运行中的进程');
    const pollResult = await processSkill.run({
      action: 'poll',
      sessionId: longSessionId,
    }, {});
    console.log(`成功: ${pollResult.success}`);
    console.log(`消息: ${pollResult.message?.slice(0, 100)}...\n`);

    // 测试 6: 终止进程
    console.log('[测试 6] 终止进程');
    const killResult = await processSkill.run({
      action: 'kill',
      sessionId: longSessionId,
    }, {});
    console.log(`成功: ${killResult.success}`);
    console.log(`消息: ${killResult.message}\n`);
  }

  console.log('=== 测试完成 ===');
  process.exit(0);
}

main().catch(console.error);
