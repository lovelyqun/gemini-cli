# Gemini CLI 简化版网页改造计划

## 项目概述

将现有的命令行Gemini AI助手转换为简单的网页版本，保持核心对话功能，使用最简单的技术栈快速实现。

## 项目目标

### 主要目标
- 🌐 提供简单的网页聊天界面
- 🔄 保持基本的AI对话功能
- 🛠️ 复用现有的Core包逻辑
- ⚡ 快速开发和部署

### 非目标（简化掉的功能）
- ❌ 实时流式响应
- ❌ 复杂的状态管理
- ❌ 多会话支持
- ❌ 用户认证系统
- ❌ 响应式设计

## 技术选型（极简版）

### 前端技术栈
- **纯HTML** - 单个HTML文件
- **原生JavaScript** - 无框架依赖
- **基础CSS** - 简单样式
- **Fetch API** - HTTP请求

### 后端技术栈
- **Node.js + Express** - 轻量级Web服务器
- **现有Core包** - 直接复用核心逻辑
- **无数据库** - 内存存储

## 架构设计（超简单）

### 系统架构图
```
┌─────────────────┐
│   HTML Page     │
│   ├── Input     │
│   ├── Display   │
│   └── Button    │
└─────────────────┘
         │
    HTTP Request
         │
┌─────────────────┐
│  Express Server │
│  └── /chat API  │
└─────────────────┘
         │
┌─────────────────┐
│   Core Package  │
│   (不变)        │
└─────────────────┘
```

### 目录结构
```
packages/web-simple/
├── public/
│   ├── index.html     # 单个HTML页面
│   ├── style.css      # 基础样式
│   └── script.js      # 前端逻辑
├── server/
│   ├── app.js         # Express服务器
│   └── package.json   # 依赖配置
└── README.md          # 使用说明
```

## 开发计划（3天完成）

### 第1天 - 后端API开发
- ✅ 创建Express服务器
- ✅ 集成现有Core包
- ✅ 实现`/chat`接口
- ✅ 静态文件服务

### 第2天 - 前端页面开发
- ✅ HTML页面结构
- ✅ CSS基础样式
- ✅ JavaScript交互逻辑
- ✅ 前后端联调

### 第3天 - 测试和部署
- ✅ 功能测试
- ✅ 错误处理
- ✅ 简单部署
- ✅ 文档编写

## 功能范围（MVP）

### 包含功能
- 📝 文本输入框
- 💬 AI对话功能
- 📋 消息历史显示
- 🔧 基础工具调用（如文件读写）
- ❌ 取消按钮

### 不包含功能
- ❌ 用户登录
- ❌ 多会话
- ❌ 实时响应
- ❌ 复杂工具
- ❌ 配置界面

## 实现细节

### 前端功能
1. **输入区域** - 简单的textarea
2. **发送按钮** - 触发API调用
3. **消息区域** - 展示对话历史
4. **加载状态** - 简单的loading提示

### 后端功能
1. **静态文件服务** - 托管HTML/CSS/JS
2. **聊天接口** - 处理用户消息
3. **Core包集成** - 调用现有Gemini功能
4. **错误处理** - 基础错误返回

### API设计
```
POST /api/chat
Body: { "message": "用户输入" }
Response: { "response": "AI回复", "error": null }
```

## 部署方案

### 开发环境
```bash
cd packages/web-simple/server
npm install
npm start
# 访问 http://localhost:3000
```



## 成功标准

### 功能标准
- ✅ 能够发送消息给AI
- ✅ 能够接收AI回复
- ✅ 基本的错误处理
- ✅ 简单易用的界面


## 后续扩展方向

如果简单版本验证成功，可以考虑：
1. 添加流式响应
2. 支持多用户
3. 添加会话管理
4. 改进用户界面
5. 添加更多工具

## 下一步行动

1. 创建项目目录结构
2. 开发Express后端服务
3. 创建HTML前端页面
4. 测试基本功能
5. 简单部署验证 