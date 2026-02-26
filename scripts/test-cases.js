/**
 * 白泽3.2 全面功能测试方案
 * 
 * 覆盖场景：
 * 1. 基础聊天 - 问候、闲聊、情感交流
 * 2. 工具调用 - 天气、时间、文件、搜索
 * 3. 上下文记忆 - 追问、多轮对话、实体记忆
 * 4. 复杂任务 - 多步骤、条件判断、错误恢复
 * 5. 边界情况 - 空输入、超长输入、敏感内容
 * 6. 错误处理 - 无能力、缺参数、工具失败
 */

const testSuites = {
  // ═══════════════════════════════════════════════════════════════
  // 1. 基础聊天测试
  // ═══════════════════════════════════════════════════════════════
  basicChat: {
    name: '基础聊天',
    cases: [
      // 问候语
      { input: '你好', expect: '问候回复', category: '问候' },
      { input: '早上好', expect: '问候回复', category: '问候' },
      { input: '晚安', expect: '问候回复', category: '问候' },
      { input: '再见', expect: '告别回复', category: '告别' },
      { input: '拜拜', expect: '告别回复', category: '告别' },
      
      // 感谢
      { input: '谢谢', expect: '不客气', category: '感谢' },
      { input: '感谢你的帮助', expect: '不客气', category: '感谢' },
      
      // 闲聊
      { input: '你是谁', expect: '自我介绍', category: '身份' },
      { input: '你叫什么名字', expect: '自我介绍', category: '身份' },
      { input: '你会做什么', expect: '能力介绍', category: '身份' },
      { input: '今天心情怎么样', expect: '闲聊回复', category: '闲聊' },
      { input: '讲个笑话', expect: '笑话', category: '闲聊' },
      
      // 情感
      { input: '我今天很开心', expect: '情感共鸣', category: '情感' },
      { input: '我好难过', expect: '安慰', category: '情感' },
      { input: '我很生气', expect: '理解', category: '情感' },
    ]
  },

  // ═══════════════════════════════════════════════════════════════
  // 2. 工具调用测试
  // ═══════════════════════════════════════════════════════════════
  toolCall: {
    name: '工具调用',
    cases: [
      // 天气查询 - 完整参数
      { input: '北京天气', expect: '调用weather工具', category: '天气-完整' },
      { input: '上海今天天气怎么样', expect: '调用weather工具', category: '天气-完整' },
      { input: '广州的天气', expect: '调用weather工具', category: '天气-完整' },
      { input: 'London weather', expect: '调用weather工具', category: '天气-完整' },
      
      // 天气查询 - 缺参数
      { input: '今天天气怎么样', expect: '询问城市', category: '天气-缺参数' },
      { input: '明天天气呢', expect: '询问城市', category: '天气-缺参数' },
      { input: '天气如何', expect: '询问城市', category: '天气-缺参数' },
      
      // 时间查询
      { input: '现在几点了', expect: '调用time工具或直接回答', category: '时间' },
      { input: '今天星期几', expect: '调用time工具或直接回答', category: '时间' },
      { input: '今天日期', expect: '调用time工具或直接回答', category: '时间' },
      
      // 文件操作
      { input: '读取/etc/hosts文件', expect: '调用file工具', category: '文件-读' },
      { input: '创建一个test.txt文件', expect: '调用file工具', category: '文件-创建' },
      { input: '列出当前目录的文件', expect: '调用fs工具', category: '文件-列表' },
      
      // 搜索
      { input: '搜索Python教程', expect: '调用brave-search工具', category: '搜索' },
      { input: '帮我查一下Vue3文档', expect: '调用brave-search工具', category: '搜索' },
    ]
  },

  // ═══════════════════════════════════════════════════════════════
  // 3. 上下文记忆测试
  // ═══════════════════════════════════════════════════════════════
  memory: {
    name: '上下文记忆',
    sessions: [
      // 会话1: 天气追问
      {
        name: '天气追问',
        turns: [
          { input: '北京天气', expect: '返回北京天气' },
          { input: '那上海呢', expect: '返回上海天气（识别追问）' },
          { input: '明天呢', expect: '返回明天天气或询问城市' },
        ]
      },
      // 会话2: 实体记忆
      {
        name: '实体记忆',
        turns: [
          { input: '我叫张三', expect: '记住名字' },
          { input: '我叫什么', expect: '回答张三' },
          { input: '我住在北京', expect: '记住位置' },
          { input: '我住在哪里', expect: '回答北京' },
        ]
      },
      // 会话3: 多轮任务
      {
        name: '多轮任务',
        turns: [
          { input: '帮我查天气', expect: '询问城市' },
          { input: '杭州', expect: '返回杭州天气' },
          { input: '谢谢', expect: '不客气' },
        ]
      },
    ]
  },

  // ═══════════════════════════════════════════════════════════════
  // 4. 错误处理测试
  // ═══════════════════════════════════════════════════════════════
  errorHandling: {
    name: '错误处理',
    cases: [
      // 无能力
      { input: '帮我买股票', expect: '说明无能力+提供替代方案', category: '无能力' },
      { input: '帮我订机票', expect: '说明无能力+提供替代方案', category: '无能力' },
      { input: '帮我转账', expect: '说明无能力+提供替代方案', category: '无能力' },
      { input: '帮我打游戏', expect: '说明无能力+提供替代方案', category: '无能力' },
      { input: '帮我叫外卖', expect: '说明无能力+提供替代方案', category: '无能力' },
      
      // 缺参数
      { input: '帮我查天气', expect: '询问城市', category: '缺参数' },
      { input: '帮我搜索', expect: '询问搜索内容', category: '缺参数' },
      { input: '帮我读取文件', expect: '询问文件路径', category: '缺参数' },
      
      // 意图不明
      { input: '那个', expect: '询问具体需求', category: '意图不明' },
      { input: '嗯', expect: '询问具体需求', category: '意图不明' },
    ]
  },

  // ═══════════════════════════════════════════════════════════════
  // 5. 边界情况测试
  // ═══════════════════════════════════════════════════════════════
  edgeCase: {
    name: '边界情况',
    cases: [
      // 空输入
      { input: '', expect: '错误提示', category: '空输入' },
      { input: '   ', expect: '错误提示', category: '空输入' },
      
      // 特殊字符
      { input: '```code```', expect: '正常处理', category: '特殊字符' },
      { input: '<script>alert(1)</script>', expect: '安全处理', category: '安全' },
      
      // 多语言
      { input: 'Hello, how are you?', expect: '英文回复', category: '多语言' },
      { input: '今日の天気は？', expect: '处理日文', category: '多语言' },
    ]
  },
};

module.exports = testSuites;
