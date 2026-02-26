#!/usr/bin/env node
/**
 * 文件系统操作技能 - JavaScript实现
 * 
 * 支持：mkdir, touch, ls, rm, write, read
 */

const fs = require('fs');
const path = require('path');

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
    const { action, path: targetPath, content = '' } = params;

    // 验证参数
    if (!action) {
      outputError('缺少 action 参数');
      return;
    }
    if (!targetPath) {
      outputError('缺少 path 参数');
      return;
    }

    // 执行操作
    let result;
    
    switch (action) {
      case 'mkdir':
        result = mkdir(targetPath);
        break;
      case 'touch':
        result = touch(targetPath);
        break;
      case 'ls':
        result = ls(targetPath);
        break;
      case 'rm':
        result = rm(targetPath);
        break;
      case 'write':
        result = write(targetPath, content);
        break;
      case 'read':
        result = read(targetPath);
        break;
      default:
        result = { success: false, error: `未知操作: ${action}` };
    }

    console.log(JSON.stringify(result));
    
  } catch (error) {
    outputError(error.message);
  }
}

function outputError(message) {
  console.log(JSON.stringify({
    success: false,
    error: message
  }));
  process.exit(1);
}

/**
 * 创建目录
 */
function mkdir(dirPath) {
  try {
    if (fs.existsSync(dirPath)) {
      return {
        success: true,
        message: `目录已存在: ${dirPath}`,
        data: { path: dirPath, existed: true }
      };
    }
    
    fs.mkdirSync(dirPath, { recursive: true });
    
    return {
      success: true,
      message: `目录已创建: ${dirPath}`,
      data: { path: dirPath }
    };
  } catch (error) {
    return { success: false, error: `创建目录失败: ${error.message}` };
  }
}

/**
 * 创建空文件
 */
function touch(filePath) {
  try {
    // 确保父目录存在
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // 创建空文件
    fs.writeFileSync(filePath, '', 'utf-8');
    
    return {
      success: true,
      message: `文件已创建: ${filePath}`,
      data: { path: filePath }
    };
  } catch (error) {
    return { success: false, error: `创建文件失败: ${error.message}` };
  }
}

/**
 * 列出目录内容
 */
function ls(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      return { success: false, error: `目录不存在: ${dirPath}` };
    }
    
    const items = fs.readdirSync(dirPath);
    const details = items.map(name => {
      const fullPath = path.join(dirPath, name);
      const stat = fs.statSync(fullPath);
      return {
        name,
        type: stat.isDirectory() ? 'directory' : 'file',
        size: stat.size,
        modified: stat.mtime.toISOString()
      };
    });
    
    return {
      success: true,
      message: `目录 ${dirPath} 包含 ${items.length} 个项目`,
      data: { 
        path: dirPath,
        count: items.length,
        items: details
      }
    };
  } catch (error) {
    return { success: false, error: `列出目录失败: ${error.message}` };
  }
}

/**
 * 删除文件或目录
 */
function rm(targetPath) {
  try {
    if (!fs.existsSync(targetPath)) {
      return { success: false, error: `路径不存在: ${targetPath}` };
    }
    
    const stat = fs.statSync(targetPath);
    
    if (stat.isDirectory()) {
      // 递归删除目录
      fs.rmSync(targetPath, { recursive: true });
      return {
        success: true,
        message: `目录已删除: ${targetPath}`
      };
    } else {
      // 删除文件
      fs.unlinkSync(targetPath);
      return {
        success: true,
        message: `文件已删除: ${targetPath}`
      };
    }
  } catch (error) {
    return { success: false, error: `删除失败: ${error.message}` };
  }
}

/**
 * 写入文件
 */
function write(filePath, content) {
  try {
    // 确保父目录存在
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(filePath, content, 'utf-8');
    
    return {
      success: true,
      message: `文件已写入: ${filePath}`,
      data: { 
        path: filePath, 
        size: Buffer.byteLength(content, 'utf-8')
      }
    };
  } catch (error) {
    return { success: false, error: `写入失败: ${error.message}` };
  }
}

/**
 * 读取文件
 */
function read(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return { success: false, error: `文件不存在: ${filePath}` };
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
    const stat = fs.statSync(filePath);
    
    return {
      success: true,
      message: content,
      data: { 
        path: filePath,
        content,
        size: stat.size
      }
    };
  } catch (error) {
    return { success: false, error: `读取失败: ${error.message}` };
  }
}

// 执行
main();
