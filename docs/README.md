# 白泽3.0 文档中心

**版本**: 3.0.2  
**最后更新**: 2025年2月

---

## 文档导航

### 📖 核心文档

| 文档 | 说明 | 适用对象 |
|-----|------|---------|
| [架构设计文档](./architecture.md) | 完整的技术架构设计 | 架构师、开发者 |
| [开发文档](./DEVELOPMENT.md) | 二次开发指南 | 开发者 |
| [API文档](./API.md) | 接口对接文档 | 第三方开发者 |
| [部署文档](./DEPLOYMENT.md) | 安装部署指南 | 运维人员 |

### 🚀 用户文档

| 文档 | 说明 | 适用对象 |
|-----|------|---------|
| [快速入门](./QUICK_START.md) | 5分钟上手教程 | 新用户 |
| [使用手册](./USER_GUIDE.md) | 完整使用指南 | 所有用户 |
| [配置指南](./CONFIG_GUIDE.md) | 详细配置说明 | 运维人员 |

### 🔧 技能开发

| 文档 | 说明 | 适用对象 |
|-----|------|---------|
| [技能开发文档](./SKILL_DEVELOPMENT.md) | 技能开发完整指南 | 技能开发者 |

### 🌐 Web 开发

| 文档 | 说明 | 适用对象 |
|-----|------|---------|
| [Web 前端指南](./WEB_GUIDE.md) | Web 前端开发指南 | Web 开发者 |

### 📋 辅助文档

| 文档 | 说明 | 适用对象 |
|-----|------|---------|
| [贡献指南](./CONTRIBUTING.md) | 如何参与贡献 | 贡献者 |
| [更新日志](./CHANGELOG.md) | 版本更新记录 | 所有用户 |
| [FAQ](./FAQ.md) | 常见问题解答 | 所有用户 |

---

## 快速开始

### 1. 安装

```bash
git clone https://github.com/your-repo/baize-nodejs.git
cd baize-nodejs
npm install
```

### 2. 配置

```bash
cp .env.example .env
# 编辑 .env，填入 API Key
```

### 3. 运行

```bash
npm run build
npm start
```

---

## 启动 API 服务

```bash
# 启动 REST API 服务（端口 3000）
node dist/interaction/api.js

# 测试
curl http://localhost:3000/health
```

---

## 文档格式

所有文档提供以下格式：

| 格式 | 文件 | 说明 |
|-----|------|------|
| Markdown | `*.md` | 源文件，适合开发者 |
| HTML | `*.html` | 网页格式，适合在线阅读 |
| Word | `*.docx` | 文档格式，适合打印 |

---

## 获取帮助

- 📖 查阅 [FAQ](./FAQ.md)
- 💬 提交 [Issue](https://github.com/your-repo/baize-nodejs/issues)
- 📧 联系维护团队

---

*白泽3.0 - 让AI真正成为你的智能助手*
