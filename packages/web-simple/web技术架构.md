# Gemini CLI Web简化版：基于Core包的智能Web扩展架构详解

项目地址：https://github.com/lovelyqun/gemini-cli-web.git

## 前言

在AI应用开发领域，如何将强大的命令行工具转化为易用的Web应用是一个常见挑战。本文将深入分析 `packages/web-simple` 的实现，这是一个基于 Gemini CLI Core 包构建的Web扩展，展示了如何优雅地复用现有核心逻辑，快速构建功能完整的Web AI助手。

## 整体架构设计

### 核心设计理念

`web-simple` 采用了"薄Web层 + 重核心复用"的架构设计：

```
┌─────────────────────────────────────────┐
│                前端层                    │
│  ┌─────────────┐  ┌─────────────────┐   │
│  │  HTML/CSS   │  │  WebSocket客户端 │   │
│  └─────────────┘  └─────────────────┘   │
└─────────────────────────────────────────┘
                    │
                    │ WebSocket/HTTP
                    ▼
┌─────────────────────────────────────────┐
│              Express服务层               │
│  ┌─────────────┐  ┌─────────────────┐   │
│  │  REST API   │  │  WebSocket服务   │   │
│  └─────────────┘  └─────────────────┘   │
└─────────────────────────────────────────┘
                    │
                    │ 直接调用
                    ▼
┌─────────────────────────────────────────┐
│          @google/gemini-cli-core        │
│  ┌─────────────┐  ┌─────────────────┐   │
│  │   Config    │  │  GeminiClient   │   │
│  │ ToolRegistry│  │  工具执行引擎    │   │
│  └─────────────┘  └─────────────────┘   │
└─────────────────────────────────────────┘
```

这种设计的优势在于：
- **最大化代码复用**：Web层仅负责协议转换，所有AI逻辑都复用CLI的core包
- **功能一致性**：Web版本与CLI版本具有完全相同的AI能力
- **易于维护**：核心功能更新自动惠及Web版本

## 核心代码实现

### 1. 服务器初始化与配置集成

服务器启动时，最关键的步骤是初始化Gemini配置：

```javascript
async function initializeGeminiConfig() {
    try {
        const cwdDir = process.env.CWD || process.cwd();
        
        // 检查环境变量
        if (!process.env.GEMINI_API_KEY) {
            throw new Error('GEMINI_API_KEY 环境变量未设置');
        }

        // 创建会话ID
        currentSessionId = generateSessionId();
        
        // 创建文件发现服务
        const fileService = new FileDiscoveryService(cwdDir);

        // 核心配置参数
        const configParams = {
            sessionId: currentSessionId,
            embeddingModel: DEFAULT_GEMINI_EMBEDDING_MODEL,
            targetDir: cwdDir,
            debugMode: process.env.DEBUG === 'true',
            // 启用核心工具集合
            coreTools: ['LSTool','ReadFileTool','ReadManyFilesTool', 
                       'WriteFileTool', 'EditTool', 'GrepTool','GlobTool', 
                       'ShellTool','WebFetchTool','WebSearchTool','MemoryTool'],
            approvalMode: ApprovalMode.YOLO, // Web环境自动执行
            fileDiscoveryService: fileService,
            model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
            maxSessionTurns: 100,
            noBrowser: true
        };

        // 创建并初始化配置实例
        geminiConfig = new Config(configParams);
        await geminiConfig.initialize();
        await geminiConfig.refreshAuth(AuthType.USE_GEMINI);

        return true;
    } catch (error) {
        console.error('❌ 初始化Gemini配置失败:', error.message);
        return false;
    }
}
```

**核心要点分析：**

1. **直接复用Config类**：通过 `@google/gemini-cli-core` 的 `Config` 类，Web应用获得了与CLI完全相同的配置能力
2. **工具集成**：通过 `coreTools` 参数启用文件操作、Shell执行、Web搜索等工具
3. **适配Web环境**：设置 `approvalMode: ApprovalMode.YOLO` 实现自动执行，避免Web环境中的交互提示

### 2. 实时流式响应处理

Web版本的核心亮点是支持实时流式响应，让用户能看到AI的思考过程：

```javascript
async function handleWebSocketChat(ws, connectionId, data) {
    const { message } = data;
    
    // 获取核心组件
    const client = geminiConfig.getGeminiClient();
    const toolRegistry = await geminiConfig.getToolRegistry();
    
    try {
        const messageContent = [{ text: message }];
        const prompt_id = `ws-${connectionId.slice(0, 8)}-${Date.now()}`;
        
        // 创建流式响应
        const messageStream = client.sendMessageStream(
            messageContent,
            abortController.signal,
            prompt_id
        );

        let fullResponse = '';
        const pendingToolCalls = [];

        // 实时处理事件流
        for await (const event of messageStream) {
            switch (event.type) {
                case GeminiEventType.Content:
                    fullResponse += event.value;
                    // 实时推送内容片段
                    ws.send(JSON.stringify({
                        type: 'content',
                        data: { content: event.value, isComplete: false }
                    }));
                    break;

                case GeminiEventType.Thought:
                    // 推送AI思考过程
                    ws.send(JSON.stringify({
                        type: 'thought',
                        data: {
                            subject: event.value.subject,
                            description: event.value.description
                        }
                    }));
                    break;

                case GeminiEventType.ToolCallRequest:
                    // 收集工具调用请求
                    pendingToolCalls.push(event.value);
                    ws.send(JSON.stringify({
                        type: 'tool_call',
                        data: { toolInfo: event.value, status: 'pending' }
                    }));
                    break;
            }
        }

        // 处理工具调用
        if (pendingToolCalls.length > 0) {
            await executeToolCalls(pendingToolCalls, client, toolRegistry, ws, prompt_id);
        }
    } catch (error) {
        // 错误处理
        ws.send(JSON.stringify({
            type: 'chat_error',
            error: formatApiError(error.message)
        }));
    }
}
```

**技术创新点：**

1. **完整事件流处理**：支持 `Content`、`Thought`、`ToolCallRequest` 等多种事件类型
2. **实时推送**：每个内容片段都立即推送给前端，实现打字机效果
3. **透明工具调用**：用户可以实时看到AI调用的工具和执行结果

### 3. 工具调用执行引擎

工具调用是Gemini CLI最强大的功能之一，Web版本完全复用了这一能力：

```javascript
// 执行工具调用的核心逻辑
for (const toolCallRequest of pendingToolCalls) {
    try {
        // 获取工具实例
        const tool = toolRegistry.getTool(toolCallRequest.name);
        if (!tool) {
            throw new Error(`工具 "${toolCallRequest.name}" 未找到`);
        }

        // 执行工具
        const toolResult = await tool.execute(
            toolCallRequest.args,
            abortController.signal
        );

        // 推送执行结果
        ws.send(JSON.stringify({
            type: 'tool_call',
            data: {
                toolInfo: toolCallRequest,
                toolResult: toolResult,
                status: 'completed'
            }
        }));

        // 构建工具响应给AI
        const toolResponsePart = {
            functionResponse: {
                name: toolCallRequest.name,
                response: { 
                    output: typeof toolResult.llmContent === 'string' 
                        ? toolResult.llmContent 
                        : JSON.stringify(toolResult.llmContent) 
                }
            }
        };

        toolResponseParts.push(toolResponsePart);
    } catch (toolError) {
        // 工具执行错误处理
        console.error(`工具调用失败: ${toolCallRequest.name}`, toolError);
    }
}

// 将工具结果发送给AI继续对话
if (toolResponseParts.length > 0) {
    const continueStream = client.sendMessageStream(
        toolResponseParts,
        abortController.signal,
        prompt_id
    );
    
    // 处理AI的后续响应
    for await (const continueEvent of continueStream) {
        if (continueEvent.type === GeminiEventType.Content) {
            fullResponse += continueEvent.value;
            ws.send(JSON.stringify({
                type: 'content',
                data: { content: continueEvent.value, isComplete: false }
            }));
        }
    }
}
```

**关键特性：**

1. **工具透明执行**：Web环境下工具自动执行，无需用户确认
2. **多轮对话支持**：工具执行完毕后，AI可以基于结果继续回复
3. **错误恢复**：单个工具失败不影响整体对话流程

## 前端交互设计

### WebSocket客户端架构

前端采用现代WebSocket架构，支持实时双向通信：

```javascript
class GeminiWebSocketClient {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
    }
    
    // 建立连接
    connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}`;
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            this.processMessage(data);
        };
    }
    
    // 处理服务器消息
    processMessage(data) {
        switch (data.type) {
            case 'content':
                this.handleContent(data.data);
                break;
            case 'thought':
                this.showThinking(data.data.subject, data.data.description);
                break;
            case 'tool_call':
                this.handleToolCall(data.data);
                break;
        }
    }
    
    // 实时内容更新
    handleContent(data) {
        let aiMessage = this.getCurrentAIMessage();
        if (!aiMessage) {
            aiMessage = this.addMessage('ai', '');
            aiMessage.dataset.rawContent = '';
        }
        
        // 累积内容并格式化显示
        aiMessage.dataset.rawContent += data.content;
        const contentElement = aiMessage.querySelector('.message-text');
        const formattedContent = this.formatMessageContent(aiMessage.dataset.rawContent);
        contentElement.innerHTML = formattedContent;
        
        // 添加打字机效果
        contentElement.classList.add('typing-content');
        this.scrollToBottom();
    }
}
```

### 实时格式化渲染

前端支持丰富的Markdown渲染和代码高亮：

```javascript
formatMessageContent(content) {
    // 1. 处理工具调用标记
    content = this.formatToolCalls(content);
    
    // 2. 处理代码块
    content = this.formatCodeBlocks(content);
    
    // 3. 处理行内代码
    content = this.formatInlineCode(content);
    
    // 4. 处理基本Markdown
    content = this.formatBasicMarkdown(content);
    
    return content;
}

formatCodeBlocks(content) {
    return content.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, language, code) => {
        const lang = language || 'text';
        const cleanCode = code.trim();
        return `<div class="code-block">
            <div class="code-header">
                <span class="code-language">${lang}</span>
                <button class="copy-btn" onclick="window.geminiClient.copyCode(this)">复制</button>
            </div>
            <pre class="code-content"><code class="language-${lang}">${this.escapeHtml(cleanCode)}</code></pre>
        </div>`;
    });
}
```

## 双协议支持策略

### WebSocket vs REST API

`web-simple` 巧妙地支持两种通信协议：

1. **WebSocket协议**（推荐）：
   - 实时流式响应
   - 支持AI思考过程展示
   - 双向通信，支持取消操作
   - 自动重连机制

2. **REST API协议**（兼容性）：
   - 传统HTTP请求响应模式
   - 适合简单集成场景
   - 返回完整响应结果

```javascript
// REST API实现
app.post('/api/chat', async (req, res) => {
    const { message } = req.body;
    
    // 复用相同的core逻辑
    const client = geminiConfig.getGeminiClient();
    const messageContent = [{ text: message }];
    
    let fullResponse = '';
    const messageStream = client.sendMessageStream(messageContent, signal, prompt_id);
    
    // 收集完整响应
    for await (const event of messageStream) {
        if (event.type === GeminiEventType.Content) {
            fullResponse += event.value;
        }
    }
    
    // 返回完整结果
    res.json({
        response: fullResponse.trim(),
        sessionId: currentSessionId
    });
});
```

## 错误处理与用户体验

### 智能错误处理

```javascript
function formatApiError(error) {
    // 结构化错误处理
    if (error && typeof error === 'object' && 'message' in error) {
        let text = `[API Error: ${error.message}]`;
        if (error.status === 429) {
            text += '\n可能的原因：API配额已用完或请求过于频繁，请稍后重试。';
        }
        return text;
    }
    
    // 解析JSON错误
    const jsonStart = error.indexOf('{');
    if (jsonStart !== -1) {
        try {
            const parsedError = JSON.parse(error.substring(jsonStart));
            if (parsedError.error && parsedError.error.message) {
                return `[API Error: ${parsedError.error.message}]`;
            }
        } catch (e) {
            // 忽略解析错误
        }
    }
    
    return `[API Error: ${error}]`;
}
```

### 连接管理

```javascript
// 心跳检测机制
setInterval(() => {
    wss.clients.forEach((ws) => {
        const connection = [...connections.values()].find(conn => conn.ws === ws);
        if (connection) {
            if (!connection.isAlive) {
                ws.terminate();
                connections.delete(connection.connectionId);
                return;
            }
            connection.isAlive = false;
            ws.ping();
        }
    });
}, 30000);
```

## 配置

### 环境配置

```bash
# 必需环境变量
GEMINI_API_KEY=your_gemini_api_key

# 可选配置
GEMINI_MODEL=gemini-pro
DEBUG=true
CWD=/path/to/working/directory
PORT=3000
```


- 请求频率限制

## 最后

1. **最大化复用现有代码**：通过直接集成 `@google/gemini-cli-core`，Web版本获得了与CLI相同的强大功能
2. **优雅的协议转换**：将命令行交互转换为Web友好的实时流式体验
3. **现代Web技术栈**：结合WebSocket、Express.js等技术提供流畅的用户体验
4. **渐进式增强**：同时支持WebSocket和REST API，适应不同使用场景
通过薄Web层和重核心复用的策略，开发者可以快速将命令行AI工具转化为功能丰富的Web应用。 
