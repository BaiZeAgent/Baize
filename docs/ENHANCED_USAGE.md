# 白泽增强模块使用指南

## 概述

增强模块为白泽添加了四大核心能力：

1. **元认知层** - 让白泽"知道自己能做什么"
2. **思考层** - 让白泽"能分解复杂任务"
3. **执行层** - 让白泽"能智能执行和重试"
4. **恢复层** - 让白泽"能从错误中恢复和学习"

## 快速开始

### 基本使用

```typescript
import { getEnhancedCore } from './core/enhanced';

async function main() {
  const core = getEnhancedCore();
  
  // 处理用户输入
  const result = await core.process('帮我分析当前目录下的所有JSON文件');
  
  if (result.success) {
    console.log('执行成功:', result.finalMessage);
  } else if (result.needClarification) {
    console.log('需要澄清:', result.questions);
  } else {
    console.log('执行失败:', result.taskResults);
  }
}
```

### 能力评估

```typescript
import { getMetacognition } from './core/enhanced';

async function assessCapability() {
  const metacognition = getMetacognition();
  
  // 评估任务可行性
  const assessment = await metacognition.assessCapability('帮我编译这个Rust项目');
  
  console.log('能否完成:', assessment.canComplete);
  console.log('置信度:', assessment.confidence);
  console.log('缺失能力:', assessment.missingCapabilities);
  console.log('建议技能:', assessment.suggestedSkills);
  
  if (assessment.needUserHelp) {
    console.log('需要用户帮助:', assessment.helpQuestions);
  }
}
```

### 任务分解

```typescript
import { getThinkingEngine } from './core/enhanced';

async function decomposeTask() {
  const thinking = getThinkingEngine();
  
  // 分解复杂任务
  const decomposition = await thinking.decomposeTask(
    '帮我备份所有重要文件到云存储',
    { score: 7, subtaskCount: 5, dependencies: 2, uncertainty: 3, timeEstimate: 120, riskLevel: 'medium', reasoning: '' }
  );
  
  console.log('分解成功:', decomposition.success);
  console.log('子任务:', decomposition.subtasks);
  console.log('执行顺序:', decomposition.executionOrder);
}
```

### 错误恢复

```typescript
import { getRecoveryEngine } from './core/enhanced';

async function handleRecovery() {
  const recovery = getRecoveryEngine();
  
  try {
    // 执行某些操作...
  } catch (error) {
    // 分析错误并获取恢复策略
    const result = await recovery.recover(error, {
      task: { skillName: 'file_operation', params: { path: '/some/path' } },
      userInput: '删除临时文件',
      previousAttempts: 1,
    });
    
    console.log('是否可重试:', result.shouldRetry);
    console.log('恢复策略:', result.strategy);
    console.log('根因分析:', result.rootCause);
    
    if (result.correctedParams) {
      console.log('修正后的参数:', result.correctedParams);
    }
    
    if (result.alternativeTool) {
      console.log('替代工具:', result.alternativeTool);
    }
  }
}
```

## 与现有系统集成

### 替换现有大脑模块

```typescript
// src/core/brain/index.ts

import { getEnhancedCore } from '../enhanced';

export class Brain {
  private enhancedCore = getEnhancedCore();
  
  async process(userInput: string): Promise<Decision> {
    // 使用增强核心处理
    const result = await this.enhancedCore.process(userInput, {
      sessionId: this.sessionId,
      history: this.history,
    });
    
    if (result.needClarification) {
      return {
        intent: 'clarification',
        action: 'reply',
        response: result.questions?.join('\n'),
        confidence: 0.9,
        reason: '需要用户澄清',
      };
    }
    
    return {
      intent: 'task',
      action: result.success ? 'execute' : 'reply',
      response: result.finalMessage,
      confidence: result.success ? 0.9 : 0.5,
      reason: result.success ? '任务完成' : '任务失败',
    };
  }
}
```

### 增强现有执行器

```typescript
// src/executor/index.ts

import { getRecoveryEngine } from '../core/enhanced';

export class Executor {
  private recoveryEngine = getRecoveryEngine();
  
  async executeSkill(name: string, params: Record<string, unknown>): Promise<ExecutionResult> {
    let attempts = 0;
    const maxAttempts = 5;
    
    while (attempts < maxAttempts) {
      attempts++;
      
      try {
        const result = await this.executeDirect(name, params);
        
        if (result.success) {
          return result;
        }
        
        // 使用增强恢复引擎
        const recovery = await this.recoveryEngine.recover(
          new Error(result.error || '执行失败'),
          { task: { skillName: name, params }, previousAttempts: attempts }
        );
        
        if (!recovery.shouldRetry) {
          return result;
        }
        
        // 应用恢复策略
        if (recovery.correctedParams) {
          params = { ...params, ...recovery.correctedParams };
        }
        if (recovery.alternativeTool) {
          name = recovery.alternativeTool;
        }
        
      } catch (error) {
        const recovery = await this.recoveryEngine.recover(error as Error, {
          task: { skillName: name, params },
          previousAttempts: attempts,
        });
        
        if (!recovery.shouldRetry) {
          throw error;
        }
      }
    }
    
    throw new Error('超过最大重试次数');
  }
}
```

## 核心改进点

### 1. 元认知能力

**之前**：白泽不知道自己能做什么，盲目尝试。

**现在**：
- 执行前评估能力边界
- 识别缺失的能力
- 主动寻求用户帮助

### 2. 任务分解

**之前**：复杂任务直接交给LLM，没有结构化处理。

**现在**：
- 自动分解为子任务
- 分析任务依赖关系
- 生成最优执行顺序

### 3. 错误恢复

**之前**：出错后简单重试或放弃。

**现在**：
- 深度根因分析
- 多种恢复策略
- 从失败中学习

### 4. 执行可靠性

**之前**：ReAct循环脆弱，容易失败。

**现在**：
- 智能重试机制
- 动态参数修正
- 替代方案自动切换

## 配置选项

```typescript
// config/enhanced.yaml

metacognition:
  enabled: true
  cache_ttl: 60000  # 能力缓存时间
  
thinking:
  max_subtasks: 20  # 最大子任务数
  complexity_threshold: 7  # 复杂度阈值
  
execution:
  max_iterations: 100  # 最大迭代次数
  max_task_retries: 5  # 单任务最大重试次数
  task_timeout: 60000  # 任务超时时间
  
recovery:
  enabled: true
  max_experiences: 1000  # 最大经验存储数
  learning_enabled: true  # 是否启用学习
```

## 最佳实践

### 1. 始终先评估能力

```typescript
// 好的做法
const assessment = await metacognition.assessCapability(userInput);
if (!assessment.canComplete) {
  return { needHelp: true, questions: assessment.helpQuestions };
}

// 不好的做法
const result = await executor.execute(userInput);  // 可能失败
```

### 2. 利用恢复经验

```typescript
// 记录恢复经验
recoveryEngine.recordExperience(error, rootCause, strategy, success);

// 下次遇到相同错误时，会自动使用成功的策略
```

### 3. 监控执行进度

```typescript
const result = await executor.execute(userInput, {
  ...context,
  hooks: {
    onProgress: async (progress) => {
      console.log(`进度: ${progress.percentage}%`);
    },
    onRecovery: async (recovery) => {
      console.log(`恢复策略: ${recovery.strategy}`);
    },
  },
});
```

## 性能考虑

1. **能力缓存**：能力边界结果会缓存1分钟，避免重复计算
2. **经验存储**：恢复经验最多存储1000条，自动淘汰旧记录
3. **并行执行**：独立任务会并行执行，提高效率

## 下一步

1. 集成到现有CLI入口
2. 添加Web界面支持
3. 实现技能市场自动安装缺失能力
4. 添加更多错误恢复策略
