#!/usr/bin/env python3
"""
Brave Search 技能 - Python实现

使用 Brave Search API 进行网络搜索
"""

import os
import sys
import json
import urllib.request
import urllib.error

# API 配置
BRAVE_API_URL = "https://api.search.brave.com/res/v1/web/search"

def main():
    try:
        # 获取参数
        input_data = {'params': {}}
        
        if 'BAIZE_PARAMS' in os.environ:
            input_data = json.loads(os.environ['BAIZE_PARAMS'])
        
        params = input_data.get('params', {})
        query = params.get('query')
        count = params.get('count', 5)
        offset = params.get('offset', 0)
        
        # 验证参数
        if not query:
            output_error('请提供搜索关键词 (query)')
            return
        
        # 获取 API Key
        api_key = os.environ.get('BRAVE_API_KEY')
        if not api_key:
            output_error('未设置 BRAVE_API_KEY 环境变量，请在 .env 文件中添加: BRAVE_API_KEY=your_key')
            return
        
        # 执行搜索
        results = search_brave(query, api_key, count, offset)
        output_success(results, f'找到 {len(results)} 个结果')
        
    except Exception as e:
        output_error(str(e))
        sys.exit(1)

def search_brave(query, api_key, count, offset):
    """调用 Brave Search API"""
    
    # 构建URL
    url = f"{BRAVE_API_URL}?q={urllib.parse.quote(query)}&count={count}&offset={offset}"
    
    # 创建请求
    req = urllib.request.Request(url)
    req.add_header('Accept', 'application/json')
    req.add_header('Accept-Encoding', 'gzip')
    req.add_header('X-Subscription-Token', api_key)
    
    try:
        # 发送请求
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode('utf-8'))
            return parse_results(data)
    except urllib.error.HTTPError as e:
        error_body = e.read().decode('utf-8')
        raise Exception(f"API返回错误: {e.code} - {error_body}")

def parse_results(json_data):
    """解析搜索结果"""
    results = []
    
    # Brave Search API 返回格式
    web_results = json_data.get('web', {}).get('results', [])
    
    for item in web_results:
        results.append({
            'title': item.get('title', ''),
            'url': item.get('url', ''),
            'description': item.get('description', ''),
        })
    
    return results

def output_success(data, message):
    """输出成功结果"""
    print(json.dumps({
        'success': True,
        'data': {'results': data},
        'message': message
    }, ensure_ascii=False))

def output_error(error):
    """输出错误结果"""
    print(json.dumps({
        'success': False,
        'error': error
    }, ensure_ascii=False))

if __name__ == '__main__':
    main()
