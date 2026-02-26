#!/usr/bin/env node
/**
 * 文件操作技能 - JavaScript实现
 * 
 * 输入：从环境变量 BAIZE_PARAMS 或 stdin 获取 JSON 参数
 * 输出：输出 JSON 结果到 stdout
 */

const fs = require('fs');
const path = require('path');

/**
 * 主函数
 */
async function main() {
  try {
    // 获取参数
    let input;
    
    // 优先从环境变量获取
    if (process.env.BAIZE_PARAMS) {
      input = JSON.parse(process.env.BAIZE_PARAMS);
    } else {
      // 从 stdin 获取
      let stdinData = '';
      process.stdin.setEncoding('utf8');
      
      // 同步读取所有stdin
      const buffer = [];
      let chunk;
      while ((chunk = process.stdin.read()) !== null) {
        buffer.push(chunk);
      }
      
      if (buffer.length > 0) {
        stdinData = buffer.join('');
        input = JSON.parse(stdinData);
      } else {
        // 没有输入，返回错误
        outputError('没有输入参数');
        return;
      }
    }

    const { params } = input;
    const { action, path: filePath, content, encoding = 'utf-8' } = params;

    // 验证必要参数
    if (!action) {
      outputError('缺少 action 参数');
      return;
    }
    if (!filePath) {
      outputError('缺少 path 参数');
      return;
    }

    // 执行操作
    let result;
    
    switch (action) {
      case 'read':
        result = readFile(filePath, encoding);
        break;
      case 'write':
        result = writeFile(filePath, content || '', encoding);
        break;
      case 'create':
        result = createFile(filePath, content || '', encoding);
        break;
      case 'delete':
        result = deleteFile(filePath);
        break;
      case 'exists':
        result = existsFile(filePath);
        break;
      default:
        result = { success: false, error: `未知操作: ${action}` };
    }

    // 输出结果
    console.log(JSON.stringify(result));
    
  } catch (error) {
    outputError(error.message);
  }
}

/**
 * 输出错误结果
 */
function outputError(message) {
  console.log(JSON.stringify({
    success: false,
    error: message
  }));
  process.exit(1);
}

/**
 * 读取文件
 */
function readFile(filePath, encoding) {
  try {
    if (!fs.existsSync(filePath)) {
      return {
        success: false,
        error: `文件不存在: ${filePath}`,
      };
    }
    
    const content = fs.readFileSync(filePath, encoding);
    const stats = fs.statSync(filePath);
    
    return {
      success: true,
      data: { 
        content,
        path: filePath,
        size: stats.size
      },
      message: content,
    };
  } catch (error) {
    return {
      success: false,
      error: `读取文件失败: ${error.message}`,
    };
  }
}

/**
 * 写入文件
 */
function writeFile(filePath, content, encoding) {
  try {
    // 确保目录存在
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(filePath, content, encoding);
    
    return {
      success: true,
      data: { 
        path: filePath, 
        size: Buffer.byteLength(content, encoding)
      },
      message: `文件已写入: ${filePath}`,
    };
  } catch (error) {
    return {
      success: false,
      error: `写入文件失败: ${error.message}`,
    };
  }
}

/**
 * 创建文件
 */
function createFile(filePath, content, encoding) {
  try {
    // 确保目录存在
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(filePath, content, encoding);
    
    return {
      success: true,
      data: { 
        path: filePath, 
        size: Buffer.byteLength(content, encoding)
      },
      message: `文件已创建: ${filePath}`,
    };
  } catch (error) {
    return {
      success: false,
      error: `创建文件失败: ${error.message}`,
    };
  }
}

/**
 * 删除文件
 */
function deleteFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return {
        success: false,
        error: `文件不存在: ${filePath}`,
      };
    }
    
    fs.unlinkSync(filePath);
    
    return {
      success: true,
      message: `文件已删除: ${filePath}`,
    };
  } catch (error) {
    return {
      success: false,
      error: `删除文件失败: ${error.message}`,
    };
  }
}

/**
 * 检查文件是否存在
 */
function existsFile(filePath) {
  try {
    const exists = fs.existsSync(filePath);
    
    return {
      success: true,
      data: { exists },
      message: exists ? `文件存在: ${filePath}` : `文件不存在: ${filePath}`,
    };
  } catch (error) {
    return {
      success: false,
      error: `检查文件失败: ${error.message}`,
    };
  }
}

// 执行主函数
main();
