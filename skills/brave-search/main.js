/**
 * brave-search skill - 自动生成的入口文件
 */

// 导入原始实现
const impl = require('./content');

/**
 * 执行技能
 */
async function main(params) {
  if (typeof impl.main === 'function') {
    return impl.main(params);
  }
  if (typeof impl === 'function') {
    return impl(params);
  }
  return { success: false, error: '未找到入口函数' };
}

module.exports = { main };
