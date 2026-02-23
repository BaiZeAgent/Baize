#!/usr/bin/env node
/**
 * 时间技能 - JavaScript实现
 */

function main() {
  try {
    // 获取参数
    let input = { params: {} };
    
    if (process.env.BAIZE_PARAMS) {
      input = JSON.parse(process.env.BAIZE_PARAMS);
    } else {
      let stdinData = '';
      const buffer = [];
      let chunk;
      while ((chunk = process.stdin.read()) !== null) {
        buffer.push(chunk);
      }
      if (buffer.length > 0) {
        stdinData = buffer.join('');
        input = JSON.parse(stdinData);
      }
    }

    const { params = {} } = input;
    const format = params.format || 'full';
    
    const now = new Date();
    
    // 星期映射
    const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    
    // 构建基础数据
    const data = {
      timestamp: now.toISOString(),
      unix: Math.floor(now.getTime() / 1000),
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate(),
      hour: now.getHours(),
      minute: now.getMinutes(),
      second: now.getSeconds(),
      weekday: weekdays[now.getDay()],
    };
    
    // 根据格式生成输出
    let formatted;
    switch (format) {
      case 'date':
        formatted = `${data.year}/${data.month}/${data.day}`;
        break;
      case 'time':
        formatted = `${String(data.hour).padStart(2, '0')}:${String(data.minute).padStart(2, '0')}:${String(data.second).padStart(2, '0')}`;
        break;
      case 'timestamp':
        formatted = now.toISOString();
        break;
      case 'iso':
        formatted = now.toISOString();
        break;
      case 'unix':
        formatted = data.unix;
        break;
      default:
        formatted = `${data.year}/${data.month}/${data.day} ${String(data.hour).padStart(2, '0')}:${String(data.minute).padStart(2, '0')}:${String(data.second).padStart(2, '0')}`;
    }
    
    data.formatted = formatted;

    const result = {
      success: true,
      data,
      message: `现在是 ${formatted}`,
    };

    console.log(JSON.stringify(result));
    
  } catch (error) {
    console.log(JSON.stringify({
      success: false,
      error: error.message,
    }));
    process.exit(1);
  }
}

main();
