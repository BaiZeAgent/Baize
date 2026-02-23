#!/usr/bin/env node
/**
 * Brave Search 技能 - JavaScript实现
 * 
 * 使用 Brave Search API 进行网络搜索
 */

const https = require('https');
const http = require('http');

// API 配置
const BRAVE_API_URL = 'https://api.search.brave.com/res/v1/web/search';

function main() {
  try {
    // 获取参数
    let input = { params: {} };
    
    if (process.env.BAIZE_PARAMS) {
      input = JSON.parse(process.env.BAIZE_PARAMS);
    }
    
    const { params = {} } = input;
    const { query, count = 5, offset = 0 } = params;
    
    // 验证参数
    if (!query) {
      outputError('请提供搜索关键词 (query)');
      return;
    }
    
    // 获取 API Key
    const apiKey = process.env.BRAVE_API_KEY;
    if (!apiKey) {
      outputError('未设置 BRAVE_API_KEY 环境变量，请在 .env 文件中添加: BRAVE_API_KEY=your_key');
      return;
    }
    
    // 执行搜索
    searchBrave(query, apiKey, count, offset)
      .then(results => {
        outputSuccess(results, `找到 ${results.length} 个结果`);
      })
      .catch(error => {
        outputError(`搜索失败: ${error.message}`);
      });
    
  } catch (error) {
    outputError(error.message);
    process.exit(1);
  }
}

/**
 * 调用 Brave Search API
 */
async function searchBrave(query, apiKey, count, offset) {
  const url = new URL(BRAVE_API_URL);
  url.searchParams.set('q', query);
  url.searchParams.set('count', count.toString());
  url.searchParams.set('offset', offset.toString());
  
  return new Promise((resolve, reject) => {
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            reject(new Error(`API返回错误: ${res.statusCode} - ${data}`));
            return;
          }
          
          const json = JSON.parse(data);
          const results = parseResults(json);
          resolve(results);
        } catch (error) {
          reject(error);
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.end();
  });
}

/**
 * 解析搜索结果
 */
function parseResults(json) {
  const results = [];
  
  // Brave Search API 返回格式
  const webResults = json?.web?.results || [];
  
  for (const item of webResults) {
    results.push({
      title: item.title || '',
      url: item.url || '',
      description: item.description || '',
    });
  }
  
  return results;
}

/**
 * 输出成功结果
 */
function outputSuccess(data, message) {
  console.log(JSON.stringify({
    success: true,
    data: { results: data },
    message
  }));
}

/**
 * 输出错误结果
 */
function outputError(error) {
  console.log(JSON.stringify({
    success: false,
    error
  }));
  process.exit(1);
}

// 执行主函数
main();
