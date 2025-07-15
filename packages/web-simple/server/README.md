# Gemini Web Simple - 服务器端

这是Gemini AI助手网页版的Express服务器，负责处理前端请求并与Gemini AI进行通信。

## 功能特性

### ✅ 核心功能
- **🤖 AI聊天服务** - 通过`/api/chat`接口提供AI对话功能
- **📁 静态文件服务** - 托管前端页面和资源
- **🔄 会话管理** - 自动管理AI聊天会话
- **⚡ 健康检查** - 提供`/api/health`接口监控服务状态
- **🛡️ 安全防护** - 集成Helmet和CORS安全中间件

### 🔧 技术特性
- **Express.js框架** - 轻量级Web服务器
- **Core包集成** - 直接复用现有Gemini CLI核心逻辑
- **流式处理** - 支持AI响应的流式处理
- **错误处理** - 完善的错误处理和状态码管理
- **优雅关闭** - 支持SIGTERM/SIGINT信号处理

## 快速开始

### 1. 环境要求
- Node.js 20+ 
- npm 或 yarn
- Gemini API Key

### 2. 安装依赖
```bash
cd packages/web-simple/server
npm install
```

### 3. 配置环境变量
设置必需的环境变量：
```bash
export GEMINI_API_KEY="your_gemini_api_key_here"
```

获取API Key: https://makersuite.google.com/app/apikey

### 4. 启动服务器

#### 方式1: 使用启动脚本（推荐）
```bash
./start.sh
```

#### 方式2: 直接运行
```bash
npm start
```

#### 方式3: 开发模式（文件监听）
```bash
npm run dev
```

### 5. 访问应用
启动成功后访问: http://localhost:3000

## 配置选项

### 环境变量

| 变量名 | 说明 | 默认值 | 必需 |
|--------|------|--------|------|
| `GEMINI_API_KEY` | Gemini API密钥 | - | ✅ |
| `PORT` | 服务器端口 | 3000 | ❌ |
| `NODE_ENV` | 运行环境 | development | ❌ |
| `GEMINI_MODEL` | 使用的AI模型 | gemini-2.0-flash-exp | ❌ |
| `DEBUG` | 调试模式 | false | ❌ |
| `HTTPS_PROXY` | HTTPS代理 | - | ❌ |

### 配置示例
```bash
# 基础配置
export GEMINI_API_KEY="your_api_key"
export PORT=8080

# 高级配置
export GEMINI_MODEL="gemini-pro"
export DEBUG=true
export NODE_ENV=production
```

## API接口

### 聊天接口
**POST** `/api/chat`

发送消息给AI并获取响应。

**请求体:**
```json
{
  "message": "你好，请介绍一下自己"
}
```

**响应:**
```json
{
  "response": "你好！我是Gemini AI助手...",
  "error": null,
  "sessionId": "web-session-xxx",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

**错误响应:**
```json
{
  "error": "错误描述",
  "response": null,
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

### 健康检查
**GET** `/api/health`

检查服务器状态。

**响应:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "sessionId": "web-session-xxx",
  "model": "gemini-2.0-flash-exp",
  "uptime": 123.456
}
```

### 重置会话
**POST** `/api/reset`

重置当前AI聊天会话。

**响应:**
```json
{
  "success": true,
  "message": "会话已重置",
  "sessionId": "web-session-xxx",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

### 获取配置
**GET** `/api/config`

获取当前服务器配置信息。

**响应:**
```json
{
  "model": "gemini-2.0-flash-exp",
  "sessionId": "web-session-xxx",
  "targetDir": "/path/to/project",
  "debugMode": false,
  "maxSessionTurns": 100,
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

## 错误处理

### HTTP状态码

| 状态码 | 说明 | 场景 |
|--------|------|------|
| 200 | 成功 | 正常响应 |
| 400 | 请求错误 | 消息为空或过长 |
| 401 | 认证失败 | API密钥无效 |
| 408 | 请求超时 | 处理时间超过60秒 |
| 429 | 配额超限 | API调用次数超限 |
| 500 | 服务器错误 | 内部处理错误 |
| 503 | 服务不可用 | 配置未初始化 |

### 常见错误

#### API密钥错误
```
❌ 错误: GEMINI_API_KEY 环境变量未设置
```
**解决:** 设置正确的API密钥环境变量

#### 配额超限
```json
{
  "error": "API配额已用完，请稍后重试"
}
```
**解决:** 等待配额重置或升级API计划

#### 请求超时
```json
{
  "error": "请求超时，请重试"
}
```
**解决:** 重新发送请求或缩短消息长度

## 安全考虑

### 内置安全措施
- **Helmet** - 设置安全HTTP头
- **CORS** - 跨域请求控制
- **输入验证** - 消息长度和格式检查
- **工具限制** - 禁用Shell工具，仅启用安全工具
- **请求超时** - 防止长时间占用资源

### 生产环境建议
1. **HTTPS** - 使用反向代理启用SSL/TLS
2. **防火墙** - 限制访问来源
3. **API限流** - 添加速率限制中间件
4. **监控** - 添加日志和监控系统
5. **环境隔离** - 不要在生产环境使用调试模式

## 故障排除

### 服务器启动失败
1. 检查Node.js版本 (需要18+)
2. 确认GEMINI_API_KEY已设置
3. 检查端口是否被占用
4. 查看错误日志

### AI响应异常
1. 验证API密钥有效性
2. 检查网络连接
3. 确认API配额充足
4. 查看服务器日志

### 前端连接失败
1. 确认服务器正在运行
2. 检查端口配置
3. 验证CORS设置
4. 查看浏览器控制台错误

## 开发说明

### 项目结构
```
server/
├── app.js           # 主服务器文件
├── package.json     # 依赖配置
├── start.sh         # 启动脚本
└── README.md        # 文档
```

### 关键组件
- **Express应用** - Web服务器框架
- **Gemini配置** - Core包配置和初始化
- **中间件** - 安全、解析、静态文件服务
- **API路由** - 聊天、健康检查等接口
- **错误处理** - 全局错误捕获和处理

### 扩展开发
如需添加新功能：

1. **新API接口** - 在app.js中添加路由
2. **中间件** - 添加认证、限流等功能
3. **配置选项** - 扩展环境变量和配置
4. **工具集成** - 启用更多Core包工具

## 性能优化

### 建议设置
- **会话轮数限制** - 防止会话过长
- **消息长度限制** - 控制请求大小
- **请求超时** - 避免长时间等待
- **内存管理** - 定期重置会话

### 监控指标
- CPU和内存使用率
- API响应时间
- 错误率和状态码分布
- 并发连接数

---

*此服务器是Gemini CLI网页版的后端实现，专注于提供稳定、安全的AI聊天服务。* 