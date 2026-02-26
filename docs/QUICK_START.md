# 白泽3.0 快速入门

**5分钟上手白泽3.0**

---

## 第一步：安装

```bash
# 克隆项目
git clone https://github.com/your-repo/baize-nodejs.git
cd baize-nodejs

# 安装依赖
npm install

# 编译项目
npm run build
```

## 第二步：配置

创建 `.env` 文件：

```bash
# 复制示例配置
cp .env.example .env
```

编辑 `.env`，填入你的 API Key：

```bash
# 必填：阿里云百炼 API Key
ALIYUN_API_KEY=your_api_key_here
```

> 获取 API Key: https://bailian.console.aliyun.com/

## 第三步：启动

```bash
npm start
```

## 第四步：对话

```
🦌 白泽3.0 已启动

你: 你好
白泽: 早上好！有什么我可以帮助你的吗？

你: 现在几点了
白泽: 现在是 2026/2/23 10:30:00

你: 帮我在D盘创建一个test.txt
白泽: 文件已创建: D:\test.txt

你: exit
再见！
```

---

## 常用命令

```bash
# 启动交互模式
npm start

# 单次对话
node dist/cli/index.js chat "你好"

# 运行测试
npm test

# 查看技能
node dist/cli/index.js skill list
```

---

## 下一步

- 📖 阅读 [使用手册](./USER_GUIDE.md)
- 🔧 查看 [配置指南](./CONFIG_GUIDE.md)
- 🌐 使用 [Web界面](./WEB_GUIDE.md)
- 🛠️ 开发 [自定义技能](./SKILL_DEVELOPMENT.md)

---

## 遇到问题？

1. 检查 API Key 是否正确
2. 运行 `npm test` 检查系统状态
3. 查看 [FAQ](./FAQ.md)
