#!/usr/bin/env python3
"""
文件操作技能 - Python实现

输入：从环境变量 BAIZE_PARAMS 或 stdin 获取 JSON 参数
输出：输出 JSON 结果到 stdout
"""

import os
import sys
import json
from pathlib import Path


def main():
    """主函数"""
    try:
        # 获取参数
        if 'BAIZE_PARAMS' in os.environ:
            input_data = json.loads(os.environ['BAIZE_PARAMS'])
        else:
            stdin_data = sys.stdin.read()
            if stdin_data:
                input_data = json.loads(stdin_data)
            else:
                output_error('没有输入参数')
                return
        
        params = input_data.get('params', {})
        action = params.get('action')
        file_path = params.get('path')
        content = params.get('content', '')
        encoding = params.get('encoding', 'utf-8')
        
        # 验证必要参数
        if not action:
            output_error('缺少 action 参数')
            return
        if not file_path:
            output_error('缺少 path 参数')
            return
        
        # 执行操作
        if action == 'read':
            result = read_file(file_path, encoding)
        elif action == 'write':
            result = write_file(file_path, content, encoding)
        elif action == 'create':
            result = create_file(file_path, content, encoding)
        elif action == 'delete':
            result = delete_file(file_path)
        elif action == 'exists':
            result = exists_file(file_path)
        else:
            result = {'success': False, 'error': f'未知操作: {action}'}
        
        # 输出结果
        print(json.dumps(result, ensure_ascii=False))
        
    except Exception as e:
        output_error(str(e))


def output_error(message):
    """输出错误结果"""
    print(json.dumps({
        'success': False,
        'error': message
    }, ensure_ascii=False))
    sys.exit(1)


def read_file(file_path, encoding='utf-8'):
    """读取文件"""
    try:
        path = Path(file_path)
        if not path.exists():
            return {'success': False, 'error': f'文件不存在: {file_path}'}
        
        content = path.read_text(encoding=encoding)
        size = path.stat().st_size
        
        return {
            'success': True,
            'data': {'content': content, 'path': file_path, 'size': size},
            'message': content
        }
    except Exception as e:
        return {'success': False, 'error': f'读取文件失败: {str(e)}'}


def write_file(file_path, content, encoding='utf-8'):
    """写入文件"""
    try:
        path = Path(file_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding=encoding)
        
        return {
            'success': True,
            'data': {'path': file_path, 'size': len(content.encode(encoding))},
            'message': f'文件已写入: {file_path}'
        }
    except Exception as e:
        return {'success': False, 'error': f'写入文件失败: {str(e)}'}


def create_file(file_path, content, encoding='utf-8'):
    """创建文件"""
    try:
        path = Path(file_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding=encoding)
        
        return {
            'success': True,
            'data': {'path': file_path, 'size': len(content.encode(encoding))},
            'message': f'文件已创建: {file_path}'
        }
    except Exception as e:
        return {'success': False, 'error': f'创建文件失败: {str(e)}'}


def delete_file(file_path):
    """删除文件"""
    try:
        path = Path(file_path)
        if not path.exists():
            return {'success': False, 'error': f'文件不存在: {file_path}'}
        
        path.unlink()
        
        return {
            'success': True,
            'message': f'文件已删除: {file_path}'
        }
    except Exception as e:
        return {'success': False, 'error': f'删除文件失败: {str(e)}'}


def exists_file(file_path):
    """检查文件是否存在"""
    try:
        path = Path(file_path)
        exists = path.exists()
        
        return {
            'success': True,
            'data': {'exists': exists},
            'message': f'文件{"存在" if exists else "不存在"}: {file_path}'
        }
    except Exception as e:
        return {'success': False, 'error': f'检查文件失败: {str(e)}'}


if __name__ == '__main__':
    main()
