# 具体实现步骤

## 项目结构创建

### 第一步：创建目录结构
```bash
mkdir packages/web-simple
cd packages/web-simple

# 创建目录
mkdir public server

# 创建文件
touch public/index.html
touch public/style.css
touch public/script.js
touch server/app.js
touch server/package.json
touch README.md
```

## 后端实现

### 第二步：Express服务器开发

#### `server/package.json`
```json
{
  "name": "gemini-web-simple",
  "version": "1.0.0",
  "description": "Simple web interface for Gemini CLI",
  "main": "app.js",
  "scripts": {
    "start": "node app.js",
    "dev": "nodemon app.js"
  },
  "dependencies": {
    "express": "^4.18.0",
    "cors": "^2.8.5",
    "@google/gemini-cli-core": "file:../core"
  },
  "devDependencies": {
    "nodemon": "^3.0.0"
  }
}
```

#### `server/app.js`
```javascript
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Config } = require('@google/gemini-cli-core');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// 初始化Gemini配置
let geminiConfig = null;

async function initializeGemini() {
  try {
    geminiConfig = new Config({
      sessionId: 'web-session',
      targetDir: process.cwd(),
      debugMode: false,
      question: '',
      fullContext: false,
      approvalMode: 'DEFAULT'
    });
    await geminiConfig.initialize();
    console.log('Gemini initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Gemini:', error);
  }
}

// 聊天接口
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ 
        error: 'Message is required and must be a string' 
      });
    }

    if (!geminiConfig) {
      return res.status(500).json({ 
        error: 'Gemini not initialized' 
      });
    }

    // 获取Gemini客户端
    const geminiClient = geminiConfig.getGeminiClient();
    const chat = await geminiClient.getChat();

    // 发送消息到Gemini
    const response = await chat.sendMessage({
      message: [{ text: message }],
      config: {
        tools: [{ 
          functionDeclarations: geminiConfig.getToolRegistry().getFunctionDeclarations() 
        }]
      }
    });

    // 提取响应文本
    let responseText = '';
    if (response.candidates && response.candidates[0]) {
      const content = response.candidates[0].content;
      if (content && content.parts) {
        responseText = content.parts
          .filter(part => part.text)
          .map(part => part.text)
          .join('');
      }
    }

    res.json({ 
      response: responseText || 'No response generated',
      error: null 
    });

  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ 
      response: null,
      error: error.message || 'Internal server error' 
    });
  }
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    geminiInitialized: !!geminiConfig 
  });
});

// 启动服务器
app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  await initializeGemini();
});
```

## 前端实现

### 第三步：HTML页面开发

#### `public/index.html`
```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Gemini Web Chat</title>
    <link rel="stylesheet" href="style.css">
</head>
<body>
    <div class="container">
        <header>
            <h1>🤖 Gemini AI 助手</h1>
            <div class="status" id="status">连接中...</div>
        </header>
        
        <main>
            <div class="chat-container">
                <div class="messages" id="messages">
                    <div class="message system">
                        <div class="content">
                            欢迎使用Gemini AI助手！请输入您的问题。
                        </div>
                    </div>
                </div>
                
                <div class="input-container">
                    <textarea 
                        id="messageInput" 
                        placeholder="请输入您的问题..."
                        rows="3"
                    ></textarea>
                    <button id="sendButton" disabled>发送</button>
                </div>
            </div>
        </main>
    </div>
    
    <script src="script.js"></script>
</body>
</html>
```

#### `public/style.css`
```css
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background-color: #f5f5f5;
    color: #333;
    line-height: 1.6;
}

.container {
    max-width: 800px;
    margin: 0 auto;
    height: 100vh;
    background: white;
    box-shadow: 0 0 20px rgba(0,0,0,0.1);
    display: flex;
    flex-direction: column;
}

header {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 20px;
    text-align: center;
}

header h1 {
    margin-bottom: 10px;
    font-size: 24px;
}

.status {
    font-size: 14px;
    opacity: 0.9;
}

.status.connected {
    color: #4CAF50;
}

.status.error {
    color: #f44336;
}

main {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.chat-container {
    flex: 1;
    display: flex;
    flex-direction: column;
    padding: 20px;
}

.messages {
    flex: 1;
    overflow-y: auto;
    margin-bottom: 20px;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    padding: 15px;
    background: #fafafa;
}

.message {
    margin-bottom: 15px;
    padding: 10px 15px;
    border-radius: 8px;
    max-width: 80%;
}

.message.user {
    background: #e3f2fd;
    border-left: 4px solid #2196f3;
    margin-left: auto;
    text-align: right;
}

.message.ai {
    background: #f3e5f5;
    border-left: 4px solid #9c27b0;
}

.message.system {
    background: #fff3e0;
    border-left: 4px solid #ff9800;
    text-align: center;
    max-width: 100%;
}

.message.error {
    background: #ffebee;
    border-left: 4px solid #f44336;
    max-width: 100%;
}

.content {
    white-space: pre-wrap;
    word-break: break-word;
}

.input-container {
    display: flex;
    gap: 10px;
    align-items: flex-end;
}

#messageInput {
    flex: 1;
    padding: 12px;
    border: 2px solid #e0e0e0;
    border-radius: 8px;
    font-size: 14px;
    resize: vertical;
    min-height: 50px;
}

#messageInput:focus {
    outline: none;
    border-color: #2196f3;
}

#sendButton {
    padding: 12px 24px;
    background: #2196f3;
    color: white;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    transition: background 0.3s ease;
}

#sendButton:hover:not(:disabled) {
    background: #1976d2;
}

#sendButton:disabled {
    background: #bdbdbd;
    cursor: not-allowed;
}

.loading {
    display: inline-block;
    width: 20px;
    height: 20px;
    border: 3px solid #f3f3f3;
    border-top: 3px solid #2196f3;
    border-radius: 50%;
    animation: spin 1s linear infinite;
}

@keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}

/* 响应式设计 */
@media (max-width: 600px) {
    .container {
        height: 100vh;
        margin: 0;
    }
    
    .chat-container {
        padding: 10px;
    }
    
    .message {
        max-width: 95%;
    }
    
    .input-container {
        flex-direction: column;
    }
    
    #sendButton {
        width: 100%;
        padding: 15px;
    }
}
```

#### `public/script.js`
```javascript
class GeminiChat {
    constructor() {
        this.messagesContainer = document.getElementById('messages');
        this.messageInput = document.getElementById('messageInput');
        this.sendButton = document.getElementById('sendButton');
        this.statusElement = document.getElementById('status');
        
        this.init();
    }
    
    init() {
        // 绑定事件
        this.sendButton.addEventListener('click', () => this.sendMessage());
        this.messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        // 检查服务器状态
        this.checkServerHealth();
        
        // 启用输入
        this.messageInput.addEventListener('input', () => {
            this.sendButton.disabled = !this.messageInput.value.trim();
        });
    }
    
    async checkServerHealth() {
        try {
            const response = await fetch('/api/health');
            const data = await response.json();
            
            if (data.status === 'ok' && data.geminiInitialized) {
                this.setStatus('已连接', 'connected');
                this.sendButton.disabled = false;
            } else {
                this.setStatus('服务未就绪', 'error');
            }
        } catch (error) {
            this.setStatus('连接失败', 'error');
            console.error('Health check failed:', error);
        }
    }
    
    setStatus(text, type = '') {
        this.statusElement.textContent = text;
        this.statusElement.className = `status ${type}`;
    }
    
    addMessage(content, type = 'user') {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'content';
        contentDiv.textContent = content;
        
        messageDiv.appendChild(contentDiv);
        this.messagesContainer.appendChild(messageDiv);
        
        // 滚动到底部
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
        
        return messageDiv;
    }
    
    addLoadingMessage() {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message ai';
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'content';
        contentDiv.innerHTML = '<span class="loading"></span> AI正在思考...';
        
        messageDiv.appendChild(contentDiv);
        this.messagesContainer.appendChild(messageDiv);
        
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
        
        return messageDiv;
    }
    
    async sendMessage() {
        const message = this.messageInput.value.trim();
        if (!message) return;
        
        // 显示用户消息
        this.addMessage(message, 'user');
        
        // 清空输入框
        this.messageInput.value = '';
        this.sendButton.disabled = true;
        
        // 显示加载消息
        const loadingMessage = this.addLoadingMessage();
        
        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ message }),
            });
            
            const data = await response.json();
            
            // 移除加载消息
            loadingMessage.remove();
            
            if (response.ok && data.response) {
                // 显示AI回复
                this.addMessage(data.response, 'ai');
            } else {
                // 显示错误
                this.addMessage(
                    `错误: ${data.error || '服务器响应异常'}`, 
                    'error'
                );
            }
            
        } catch (error) {
            // 移除加载消息
            loadingMessage.remove();
            
            // 显示网络错误
            this.addMessage(
                `网络错误: ${error.message}`, 
                'error'
            );
            
            console.error('Send message failed:', error);
        }
        
        // 重新启用发送按钮
        this.sendButton.disabled = false;
        this.messageInput.focus();
    }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    new GeminiChat();
});
```

## 测试和运行

### 第四步：测试运行

#### 安装依赖
```bash
cd server
npm install
```

#### 启动服务器
```bash
# 开发模式
npm run dev

# 或生产模式
npm start
```

#### 访问测试
1. 打开浏览器访问：`http://localhost:3000`
2. 在输入框中输入消息
3. 点击发送按钮测试对话

### 第五步：基础测试清单

#### 功能测试
- [ ] 页面正常加载
- [ ] 服务器状态检查正常
- [ ] 能够发送消息
- [ ] 能够接收AI回复
- [ ] 错误处理正常显示
- [ ] 页面响应式正常

#### 错误场景测试
- [ ] 服务器未启动时的错误处理
- [ ] 网络错误时的错误处理
- [ ] 空消息发送的验证
- [ ] 长消息的处理

## 部署说明

### 第六步：简单部署

#### 使用PM2部署
```bash
# 安装PM2
npm install -g pm2

# 启动应用
pm2 start server/app.js --name gemini-web

# 设置开机自启
pm2 startup
pm2 save
```

#### 使用Docker部署
```dockerfile
# Dockerfile
FROM node:18-alpine

WORKDIR /app

COPY server/package*.json ./
RUN npm install --production

COPY server/ ./
COPY public/ ./public/

EXPOSE 3000

CMD ["node", "app.js"]
```

```bash
# 构建和运行
docker build -t gemini-web .
docker run -p 3000:3000 gemini-web
```

## 故障排除

### 常见问题

1. **Gemini初始化失败**
   - 检查API密钥配置
   - 检查网络连接
   - 查看服务器日志

2. **前端无法连接后端**
   - 检查端口是否被占用
   - 检查CORS配置
   - 确认服务器正在运行

3. **AI回复为空**
   - 检查Gemini API配置
   - 检查请求参数格式
   - 查看详细错误日志

### 调试方法

1. **后端调试**
   ```bash
   # 启用详细日志
   DEBUG=* npm start
   ```

2. **前端调试**
   - 打开浏览器开发者工具
   - 查看Console和Network标签
   - 检查API请求和响应

## 下一步改进

完成基础版本后，可以考虑：

1. **添加工具支持** - 集成文件操作等工具
2. **改进UI** - 添加更好的样式和动画
3. **错误处理** - 更完善的错误提示
4. **配置管理** - 添加配置页面
5. **会话持久化** - 保存对话历史 