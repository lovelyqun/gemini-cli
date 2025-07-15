#!/bin/bash

# Gemini Web Simple 启动脚本

echo "🚀 启动 Gemini Web Simple 服务器"
echo ""

# 检查Node.js版本
NODE_VERSION=$(node --version)
echo "Node.js版本: $NODE_VERSION"

# 检查GEMINI_API_KEY环境变量
if [ -z "$GEMINI_API_KEY" ]; then
    echo "❌ 错误: GEMINI_API_KEY 环境变量未设置"
    echo ""
    echo "请设置您的Gemini API Key:"
    echo "export GEMINI_API_KEY='your_api_key_here'"
    echo ""
    echo "API Key获取地址: https://makersuite.google.com/app/apikey"
    echo ""
    exit 1
fi

echo "✅ GEMINI_API_KEY 已设置"

# 设置默认端口
if [ -z "$PORT" ]; then
    export PORT=3000
fi

echo "🌐 服务器端口: $PORT"

# 进入服务器目录
cd "$(dirname "$0")"

# 安装依赖 (如果需要)
if [ ! -d "node_modules" ]; then
    echo "📦 安装依赖..."
    npm install
fi

echo ""
echo "🎯 启动服务器..."
echo ""

# 启动服务器
npm start 