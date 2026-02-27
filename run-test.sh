#!/bin/bash
# 测试运行脚本
# 使用方法: ALIYUN_API_KEY=your_key ./run-test.sh

cd /home/z/my-project/baize-check

if [ -z "$ALIYUN_API_KEY" ]; then
  echo "请设置 ALIYUN_API_KEY 环境变量"
  exit 1
fi

./node_modules/.bin/ts-node test-openclaw-style.ts
