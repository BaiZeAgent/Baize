/**
 * 插件系统测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PluginManager, PluginStatus } from '../plugins/manager';
import { HookManager, HookType, HookResult } from '../plugins/hooks';

describe('PluginManager', () => {
  let manager: PluginManager;

  beforeEach(() => {
    manager = new PluginManager();
  });

  afterEach(() => {
    manager.getAllPlugins().forEach((p) => {
      manager.unload(p.manifest.id);
    });
  });

  describe('插件发现', () => {
    it('应该能添加插件目录', () => {
      manager.addPluginDir('/tmp/plugins');
      // 无错误即成功
      expect(true).toBe(true);
    });
  });

  describe('插件管理', () => {
    it('应该能获取空插件列表', () => {
      const plugins = manager.getAllPlugins();
      expect(plugins).toEqual([]);
    });

    it('应该能获取空启用插件列表', () => {
      const plugins = manager.getEnabledPlugins();
      expect(plugins).toEqual([]);
    });

    it('加载不存在的插件应该返回false', async () => {
      const result = await manager.load('nonexistent-plugin');
      expect(result).toBe(false);
    });
  });

  describe('工具注册', () => {
    it('应该能注册工具', () => {
      manager.registerTool('test-tool', () => 'result');
      const tool = manager.getTool('test-tool');
      expect(tool).toBeDefined();
    });

    it('应该能获取注册的工具', () => {
      const handler = () => 'test';
      manager.registerTool('test-tool', handler);
      const tool = manager.getTool('test-tool');
      expect(tool).toBe(handler);
    });
  });

  describe('服务注册', () => {
    it('应该能注册服务', () => {
      const service = { name: 'test' };
      manager.registerService('test-service', service);
      const retrieved = manager.getService('test-service');
      expect(retrieved).toBe(service);
    });
  });
});

describe('HookManager', () => {
  let manager: HookManager;

  beforeEach(() => {
    manager = new HookManager();
  });

  afterEach(() => {
    manager.clear();
  });

  describe('Hook注册', () => {
    it('应该能注册Hook', () => {
      const id = manager.register(HookType.ON_MESSAGE, () => {});
      expect(id).toBeDefined();
    });

    it('应该能注销Hook', () => {
      const id = manager.register(HookType.ON_MESSAGE, () => {});
      const result = manager.unregister(id);
      expect(result).toBe(true);
    });

    it('注销不存在的Hook应该返回false', () => {
      const result = manager.unregister('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('Hook触发', () => {
    it('应该能触发Hook', async () => {
      let called = false;
      manager.register(HookType.ON_MESSAGE, () => {
        called = true;
      });

      await manager.emit(HookType.ON_MESSAGE, { text: 'test' });
      expect(called).toBe(true);
    });

    it('应该能传递数据', async () => {
      let receivedData: Record<string, unknown> | undefined;
      manager.register(HookType.ON_MESSAGE, (ctx) => {
        receivedData = ctx.data;
      });

      await manager.emit(HookType.ON_MESSAGE, { text: 'hello' });
      expect(receivedData?.text).toBe('hello');
    });

    it('应该能修改数据', async () => {
      manager.register(HookType.ON_MESSAGE, (): HookResult => ({
        proceed: true,
        modifiedData: { modified: true },
      }));

      const context = await manager.emit(HookType.ON_MESSAGE, { text: 'test' });
      expect(context.data?.modified).toBe(true);
    });

    it('proceed为false时应该停止执行后续Hook', async () => {
      const executionOrder: string[] = [];
      
      // 第一个Hook返回proceed: false
      manager.register(HookType.ON_MESSAGE, (): HookResult => {
        executionOrder.push('first');
        return { proceed: false };
      }, { priority: 10 });
      
      // 第二个Hook不应该执行
      manager.register(HookType.ON_MESSAGE, () => {
        executionOrder.push('second');
      }, { priority: 5 });

      await manager.emit(HookType.ON_MESSAGE);
      
      // 只有第一个Hook应该执行
      expect(executionOrder).toEqual(['first']);
    });
  });

  describe('优先级', () => {
    it('高优先级Hook应该先执行', async () => {
      const order: number[] = [];
      manager.register(HookType.ON_MESSAGE, () => { order.push(1); }, { priority: 1 });
      manager.register(HookType.ON_MESSAGE, () => { order.push(2); }, { priority: 2 });
      manager.register(HookType.ON_MESSAGE, () => { order.push(3); }, { priority: 0 });

      await manager.emit(HookType.ON_MESSAGE);
      expect(order).toEqual([2, 1, 3]);
    });
  });

  describe('一次性Hook', () => {
    it('一次性Hook应该只执行一次', async () => {
      let count = 0;
      manager.register(HookType.ON_MESSAGE, () => { count++; }, { once: true });

      await manager.emit(HookType.ON_MESSAGE);
      await manager.emit(HookType.ON_MESSAGE);
      expect(count).toBe(1);
    });
  });

  describe('统计', () => {
    it('应该能获取Hook数量', () => {
      manager.register(HookType.ON_MESSAGE, () => {});
      manager.register(HookType.ON_MESSAGE, () => {});
      manager.register(HookType.ON_ERROR, () => {});

      expect(manager.getHookCount(HookType.ON_MESSAGE)).toBe(2);
      expect(manager.getHookCount(HookType.ON_ERROR)).toBe(1);
      expect(manager.getTotalHookCount()).toBe(3);
    });
  });

  describe('清理', () => {
    it('应该能清除所有Hook', () => {
      manager.register(HookType.ON_MESSAGE, () => {});
      manager.register(HookType.ON_ERROR, () => {});
      
      manager.clear();
      
      expect(manager.getTotalHookCount()).toBe(0);
    });

    it('应该能清除指定类型的Hook', () => {
      manager.register(HookType.ON_MESSAGE, () => {});
      manager.register(HookType.ON_ERROR, () => {});
      
      manager.clearType(HookType.ON_MESSAGE);
      
      expect(manager.getHookCount(HookType.ON_MESSAGE)).toBe(0);
      expect(manager.getHookCount(HookType.ON_ERROR)).toBe(1);
    });
  });
});
