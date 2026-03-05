/**
 * CLI入口 - 引导文件
 * 
 * 首先加载环境变量，然后启动CLI
 */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// 尝试从多个位置加载.env文件
// 优先使用项目目录下的.env文件
const envPaths = [
  // 项目根目录（相对于dist/cli/bootstrap.js）
  path.resolve(__dirname, '..', '..', '.env'),
  // 当前工作目录
  path.resolve(process.cwd(), '.env'),
  // 用户主目录
  path.resolve(process.env.HOME || '', '.baize', '.env'),
];

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

// 加载主CLI模块
require('./index');
