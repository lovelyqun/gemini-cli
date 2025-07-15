/**
 * Gemini CLI Web简化版 - WebSocket实时通信
 */

class GeminiWebSocketClient {
    constructor() {
        this.ws = null;
        this.connectionId = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.messageCount = 0;
        this.currentRequestStartTime = null;
        
        // DOM元素引用 - 在init中初始化
        this.elements = {};
    }
    
    init() {
        // 初始化DOM元素引用
        this.elements = {
            statusDot: document.getElementById('statusDot'),
            statusText: document.getElementById('statusText'),
            connectionType: document.getElementById('connectionType'),
            sessionId: document.getElementById('sessionId'),
            modelName: document.getElementById('modelName'),
            messages: document.getElementById('messages'),
            thinkingArea: document.getElementById('thinkingArea'),
            thinkingDetails: document.getElementById('thinkingDetails'),
            messageInput: document.getElementById('messageInput'),
            charCount: document.getElementById('charCount'),
            sendBtn: document.getElementById('sendBtn'),
            clearBtn: document.getElementById('clearBtn'),
            footerStatus: document.getElementById('footerStatus'),
            responseTime: document.getElementById('responseTime'),
            messageCountElement: document.getElementById('messageCount')
        };
        
        // 检查关键元素是否存在
        if (!this.elements.messageInput || !this.elements.sendBtn) {
            console.error('关键DOM元素未找到，请检查HTML结构');
            return;
        }
        
        this.setupEventListeners();
        this.updateCharCount();
        this.connect();
    }
    
    setupEventListeners() {
        // 发送按钮点击
        this.elements.sendBtn.addEventListener('click', () => this.sendMessage());
        
        // 清空按钮点击
        this.elements.clearBtn.addEventListener('click', () => this.clearInput());
        
        // 输入框事件
        this.elements.messageInput.addEventListener('input', () => this.updateCharCount());
        this.elements.messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        // 窗口事件
        window.addEventListener('beforeunload', () => this.disconnect());
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());
    }
    
    connect() {
        try {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}`;
            
            this.updateStatus('connecting', '连接中...');
            this.ws = new WebSocket(wsUrl);
            
            this.ws.onopen = () => this.handleOpen();
            this.ws.onmessage = (event) => this.handleMessage(event);
            this.ws.onclose = (event) => this.handleClose(event);
            this.ws.onerror = (error) => this.handleError(error);
            
        } catch (error) {
            console.error('WebSocket连接失败:', error);
            this.updateStatus('error', '连接失败');
            this.scheduleReconnect();
        }
    }
    
    disconnect() {
        if (this.ws) {
            this.ws.close(1000, '客户端主动断开');
        }
    }
    
    handleOpen() {
        console.log('WebSocket连接已建立');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.updateStatus('connected', '已连接');
        this.elements.footerStatus.textContent = '已连接';
        
        // 请求服务器状态
        this.sendWebSocketMessage('get_status', {});
    }
    
    handleMessage(event) {
        try {
            const data = JSON.parse(event.data);
            this.processMessage(data);
        } catch (error) {
            console.error('解析WebSocket消息失败:', error, event.data);
        }
    }
    
    handleClose(event) {
        console.log('WebSocket连接已关闭:', event.code, event.reason);
        this.isConnected = false;
        this.connectionId = null;
        
        if (event.code === 1000) {
            // 正常关闭
            this.updateStatus('disconnected', '已断开');
            this.elements.footerStatus.textContent = '已断开';
        } else {
            // 异常关闭，尝试重连
            this.updateStatus('error', '连接中断');
            this.elements.footerStatus.textContent = '连接中断';
            this.scheduleReconnect();
        }
    }
    
    handleError(error) {
        console.error('WebSocket错误:', error);
        this.updateStatus('error', '连接错误');
        this.elements.footerStatus.textContent = '连接错误';
    }
    
    handleOnline() {
        if (!this.isConnected) {
            console.log('网络恢复，尝试重连...');
            this.connect();
        }
    }
    
    handleOffline() {
        this.updateStatus('error', '网络离线');
        this.elements.footerStatus.textContent = '网络离线';
    }
    
    scheduleReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.updateStatus('error', '重连失败');
            this.elements.footerStatus.textContent = '重连失败';
            return;
        }
        
        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        
        this.updateStatus('connecting', `重连中... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        this.elements.footerStatus.textContent = `重连中... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`;
        
        setTimeout(() => this.connect(), delay);
    }
    
    updateStatus(status, text) {
        this.elements.statusText.textContent = text;
        
        // 更新状态点颜色
        this.elements.statusDot.className = 'status-dot';
        if (status === 'connected') {
            this.elements.statusDot.classList.add('connected');
        } else if (status === 'error' || status === 'disconnected') {
            this.elements.statusDot.classList.add('error');
        }
    }
    
    processMessage(data) {
        const { type, data: messageData, timestamp, error } = data;
        
        switch (type) {
            case 'connection_established':
                this.handleConnectionEstablished(messageData || data);
                break;
                
            case 'status':
                this.handleServerStatus(messageData);
                break;
                
            case 'chat_start':
                this.handleChatStart(messageData);
                break;
                
            case 'thought':
                this.handleThought(messageData);
                break;
                
            case 'content':
                this.handleContent(messageData);
                break;
                
            case 'chat_complete':
                this.handleChatComplete(messageData);
                break;
                
            case 'chat_error':
                this.handleChatError(error);
                break;
                
            case 'tool_call':
                this.handleToolCall(messageData);
                break;
                
            case 'system_event':
                this.handleSystemEvent(messageData);
                break;
                
            case 'error':
                this.handleError(error);
                break;
                
            case 'pong':
                // 心跳响应，无需处理
                break;
                
            default:
                console.log('未知消息类型:', type, data);
        }
    }
    
    handleConnectionEstablished(data) {
        this.connectionId = data.connectionId;
        console.log('连接已建立，ID:', this.connectionId);
        
        if (data.serverStatus === 'ready') {
            this.enableInput();
        }
    }
    
    handleServerStatus(data) {
        this.elements.sessionId.textContent = data.sessionId || '-';
        this.elements.modelName.textContent = data.model || '-';
        
        if (data.serverStatus === 'ready') {
            this.enableInput();
        }
    }
    
    handleChatStart(data) {
        this.currentRequestStartTime = Date.now();
        this.hideThinking();
        
        // 显示用户消息
        this.addMessage('user', data.message);
        this.updateMessageCount();
        
        // 禁用输入
        this.disableInput();
        this.elements.footerStatus.textContent = '处理中...';
    }
    
    handleThought(data) {
        this.showThinking(data.subject, data.description);
    }
    
    handleContent(data) {
        this.hideThinking();
        
        // 获取或创建AI消息元素
        let aiMessage = this.getCurrentAIMessage();
        if (!aiMessage) {
            aiMessage = this.addMessage('ai', '');
            // 存储原始文本内容用于累积
            aiMessage.dataset.rawContent = '';
        }
        
        // 累积原始内容
        aiMessage.dataset.rawContent += data.content;
        
        // 格式化并更新显示内容
        const contentElement = aiMessage.querySelector('.message-text');
        if (contentElement) {
            const formattedContent = this.formatMessageContent(aiMessage.dataset.rawContent);
            contentElement.innerHTML = formattedContent;
            
            // 添加打字效果
            contentElement.classList.add('typing-content');
            setTimeout(() => {
                contentElement.classList.remove('typing-content');
            }, 100);
        }
        
        // 滚动到底部
        this.scrollToBottom();
    }
    
    handleChatComplete(data) {
        this.hideThinking();
        
        // 确保AI消息存在并更新
        let aiMessage = this.getCurrentAIMessage();
        if (!aiMessage) {
            aiMessage = this.addMessage('ai', data.fullResponse);
        } else {
            const contentElement = aiMessage.querySelector('.message-text');
            if (contentElement) {
                contentElement.classList.remove('typing-content');
                // 使用格式化的完整响应
                const formattedContent = this.formatMessageContent(data.fullResponse);
                contentElement.innerHTML = formattedContent;
                // 更新原始内容
                aiMessage.dataset.rawContent = data.fullResponse;
            }
        }
        
        // 添加时间戳
        this.addTimestamp(aiMessage);
        
        // 计算响应时间
        if (this.currentRequestStartTime) {
            const responseTime = Date.now() - this.currentRequestStartTime;
            this.elements.responseTime.textContent = `${responseTime}ms`;
            this.currentRequestStartTime = null;
        }
        
        // 重新启用输入
        this.enableInput();
        this.elements.footerStatus.textContent = '准备就绪';
        
        // 滚动到底部
        this.scrollToBottom();
    }
    
    handleChatError(error) {
        this.hideThinking();
        
        // 显示错误消息
        this.addMessage('error', `错误: ${error}`);
        
        // 重新启用输入
        this.enableInput();
        this.elements.footerStatus.textContent = '发生错误';
        this.elements.responseTime.textContent = '-';
        
        // 滚动到底部
        this.scrollToBottom();
    }
    
    handleToolCall(data) {
        console.log('工具调用:', data);
        // 可以在这里显示工具调用信息
    }
    
    handleSystemEvent(data) {
        console.log('系统事件:', data);
        // 可以在这里处理系统事件
    }
    
    showThinking(subject, description) {
        this.elements.thinkingDetails.innerHTML = `
            <div class="thought-subject"><strong>${subject}</strong></div>
            <div class="thought-description">${description}</div>
        `;
        this.elements.thinkingArea.style.display = 'block';
        this.scrollToBottom();
    }
    
    hideThinking() {
        this.elements.thinkingArea.style.display = 'none';
    }
    
    getCurrentAIMessage() {
        const messages = this.elements.messages.children;
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].classList.contains('ai') && !messages[i].querySelector('.message-timestamp')) {
                return messages[i];
            }
        }
        return null;
    }
    
    addMessage(type, content) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        
        let messageContent;
        if (type === 'error') {
            messageContent = `
                <div class="message-content error">
                    <div class="message-text">${this.escapeHtml(content)}</div>
                </div>
            `;
        } else {
            const formattedContent = this.formatMessageContent(content);
            messageContent = `
                <div class="message-content">
                    <div class="message-text">${formattedContent}</div>
                </div>
            `;
        }
        
        messageDiv.innerHTML = messageContent;
        this.elements.messages.appendChild(messageDiv);
        this.scrollToBottom();
        
        return messageDiv;
    }

    formatMessageContent(content) {
        if (!content || typeof content !== 'string') {
            return '';
        }

        // 1. 处理工具调用标记
        content = this.formatToolCalls(content);
        
        // 2. 处理代码块
        content = this.formatCodeBlocks(content);
        
        // 3. 处理行内代码
        content = this.formatInlineCode(content);
        
        // 4. 处理换行
        content = this.formatLineBreaks(content);
        
        // 5. 处理基本Markdown
        content = this.formatBasicMarkdown(content);
        
        return content;
    }

    formatToolCalls(content) {
        // 处理工具调用标记 [tool_code]...[/tool_code]
        return content.replace(/\[tool_code\]([\s\S]*?)\[\/tool_code\]/g, (match, code) => {
            const cleanCode = code.trim();
            return `<div class="tool-call">
                <div class="tool-call-header">
                    <span class="tool-icon">🔧</span>
                    <span class="tool-label">工具调用</span>
                </div>
                <pre class="tool-code"><code>${this.escapeHtml(cleanCode)}</code></pre>
            </div>`;
        });
    }

    formatCodeBlocks(content) {
        // 处理多行代码块 ```语言\n代码\n```
        return content.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, language, code) => {
            const lang = language || 'text';
            const cleanCode = code.trim();
            return `<div class="code-block">
                <div class="code-header">
                    <span class="code-language">${lang}</span>
                    <button class="copy-btn" onclick="window.geminiClient.copyCode(this)" data-code="${this.escapeHtml(cleanCode).replace(/"/g, '&quot;')}">复制</button>
                </div>
                <pre class="code-content"><code class="language-${lang}">${this.escapeHtml(cleanCode)}</code></pre>
            </div>`;
        });
    }

    formatInlineCode(content) {
        // 处理行内代码 `代码`
        return content.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');
    }

    formatLineBreaks(content) {
        // 将换行符转换为HTML换行
        return content.replace(/\n/g, '<br>');
    }

    formatBasicMarkdown(content) {
        // 处理基本Markdown语法
        content = content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'); // 粗体
        content = content.replace(/\*(.*?)\*/g, '<em>$1</em>'); // 斜体
        content = content.replace(/~~(.*?)~~/g, '<del>$1</del>'); // 删除线
        
        // 处理链接
        content = content.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
        // 处理自动链接
        content = content.replace(/(https?:\/\/[^\s<>"]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
        
        // 处理标题
        content = content.replace(/^### (.+)$/gm, '<h3>$1</h3>');
        content = content.replace(/^## (.+)$/gm, '<h2>$1</h2>');
        content = content.replace(/^# (.+)$/gm, '<h1>$1</h1>');
        
        // 处理列表
        content = content.replace(/^[\s]*[-*+]\s(.+)$/gm, '<li>$1</li>');
        content = content.replace(/(<li>.*?<\/li>(?:\s*<li>.*?<\/li>)*)/gs, '<ul>$1</ul>');
        
        // 处理有序列表
        content = content.replace(/^[\s]*\d+\.\s(.+)$/gm, '<li>$1</li>');
        
        // 处理引用
        content = content.replace(/^>\s(.+)$/gm, '<blockquote>$1</blockquote>');
        
        return content;
    }

    copyCode(button) {
        const code = button.getAttribute('data-code');
        navigator.clipboard.writeText(code).then(() => {
            const originalText = button.textContent;
            button.textContent = '已复制!';
            button.classList.add('copied');
            setTimeout(() => {
                button.textContent = originalText;
                button.classList.remove('copied');
            }, 2000);
        }).catch(err => {
            console.error('复制失败:', err);
        });
    }
    
    addTimestamp(messageElement) {
        const timestamp = new Date().toLocaleTimeString();
        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        timestampDiv.textContent = timestamp;
        messageElement.querySelector('.message-content').appendChild(timestampDiv);
    }
    
    sendMessage() {
        console.log('sendMessage被调用');
        console.log('messageInput元素:', this.elements.messageInput);
        
        if (!this.elements.messageInput) {
            console.error('messageInput元素为null');
            this.showInputError('输入框元素未找到');
            return;
        }
        
        const message = this.elements.messageInput.value.trim();
        console.log('获取到的消息:', `"${message}"`, '长度:', message.length);
        
        if (!message) {
            console.log('消息为空，显示错误提示');
            this.showInputError('请输入消息内容');
            return;
        }
        
        if (!this.isConnected) {
            this.showInputError('WebSocket未连接，请等待连接恢复');
            return;
        }
        
        if (message.length > 10000) {
            this.showInputError('消息内容过长，请限制在10000字符以内');
            return;
        }
        
        // 发送聊天消息
        this.sendWebSocketMessage('chat', { message });
        
        // 清空输入框
        this.clearInput();
    }
    
    sendWebSocketMessage(type, data) {
        if (!this.isConnected || !this.ws) {
            console.error('WebSocket未连接');
            return;
        }
        
        const message = {
            type,
            data,
            timestamp: new Date().toISOString()
        };
        
        this.ws.send(JSON.stringify(message));
    }
    
    clearInput() {
        this.elements.messageInput.value = '';
        this.updateCharCount();
        this.elements.messageInput.focus();
    }
    
    updateCharCount() {
        const length = this.elements.messageInput.value.length;
        this.elements.charCount.textContent = `${length}/10000`;
        
        if (length > 8000) {
            this.elements.charCount.style.color = 'var(--error-color)';
        } else if (length > 5000) {
            this.elements.charCount.style.color = 'var(--warning-color)';
        } else {
            this.elements.charCount.style.color = 'var(--text-muted)';
        }
    }
    
    updateMessageCount() {
        this.messageCount++;
        this.elements.messageCountElement.textContent = this.messageCount;
    }
    
    enableInput() {
        this.elements.messageInput.disabled = false;
        this.elements.sendBtn.disabled = false;
        this.elements.messageInput.focus();
    }
    
    disableInput() {
        this.elements.messageInput.disabled = true;
        this.elements.sendBtn.disabled = true;
    }
    
    showInputError(message) {
        // 创建临时错误提示
        const errorDiv = document.createElement('div');
        errorDiv.className = 'input-error';
        errorDiv.textContent = message;
        errorDiv.style.cssText = `
            position: absolute;
            top: -2.5rem;
            left: 0;
            right: 0;
            background: var(--error-color);
            color: white;
            padding: 0.5rem;
            border-radius: var(--radius-sm);
            font-size: var(--font-size-sm);
            text-align: center;
            z-index: 10;
            animation: fadeInUp 0.3s ease-out;
        `;
        
        this.elements.messageInput.parentElement.style.position = 'relative';
        this.elements.messageInput.parentElement.appendChild(errorDiv);
        
        // 3秒后移除
        setTimeout(() => {
            if (errorDiv.parentElement) {
                errorDiv.parentElement.removeChild(errorDiv);
            }
        }, 3000);
    }
    
    scrollToBottom() {
        setTimeout(() => {
            this.elements.messages.scrollTop = this.elements.messages.scrollHeight;
        }, 100);
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
    window.geminiClient = new GeminiWebSocketClient();
});

// 添加一些全局样式
const style = document.createElement('style');
style.textContent = `
    .message-content.error {
        background: linear-gradient(135deg, #fef2f2, #fee2e2) !important;
        border: 1px solid var(--error-color) !important;
        color: var(--error-color) !important;
    }
    
    .thought-subject {
        font-weight: 600;
        margin-bottom: 0.25rem;
    }
    
    .thought-description {
        opacity: 0.8;
        font-size: var(--font-size-sm);
    }
    
    /* 工具调用样式 */
    .tool-call {
        background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
        border: 1px solid #dee2e6;
        border-radius: 8px;
        margin: 12px 0;
        overflow: hidden;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    
    .tool-call-header {
        background: linear-gradient(135deg, #6c757d 0%, #495057 100%);
        color: white;
        padding: 8px 12px;
        font-size: var(--font-size-sm);
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 6px;
    }
    
    .tool-icon {
        font-size: 14px;
    }
    
    .tool-code {
        margin: 0;
        padding: 12px;
        background: #f8f9fa;
        border: none;
        font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
        font-size: 13px;
        line-height: 1.4;
        overflow-x: auto;
    }
    
    /* 代码块样式 */
    .code-block {
        background: #f8f9fa;
        border: 1px solid #e9ecef;
        border-radius: 8px;
        margin: 12px 0;
        overflow: hidden;
        box-shadow: 0 2px 4px rgba(0,0,0,0.05);
    }
    
    .code-header {
        background: linear-gradient(135deg, #495057 0%, #343a40 100%);
        color: white;
        padding: 8px 12px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: var(--font-size-sm);
    }
    
    .code-language {
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }
    
    .copy-btn {
        background: rgba(255,255,255,0.2);
        color: white;
        border: 1px solid rgba(255,255,255,0.3);
        border-radius: 4px;
        padding: 4px 8px;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.2s ease;
    }
    
    .copy-btn:hover {
        background: rgba(255,255,255,0.3);
        border-color: rgba(255,255,255,0.5);
    }
    
    .copy-btn.copied {
        background: #28a745;
        border-color: #28a745;
    }
    
    .code-content {
        margin: 0;
        padding: 16px;
        background: #f8f9fa;
        border: none;
        font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
        font-size: 13px;
        line-height: 1.5;
        overflow-x: auto;
    }
    
    /* 行内代码样式 */
    .inline-code {
        background: #e9ecef;
        color: #495057;
        padding: 2px 6px;
        border-radius: 4px;
        font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
        font-size: 0.9em;
        border: 1px solid #dee2e6;
    }
    
    /* Markdown样式增强 */
    .message-text strong {
        font-weight: 700;
        color: #2c3e50;
    }
    
    .message-text em {
        font-style: italic;
        color: #6c757d;
    }
    
    .message-text del {
        text-decoration: line-through;
        opacity: 0.7;
    }
    
    .message-text ul {
        margin: 8px 0;
        padding-left: 20px;
    }
    
    .message-text li {
        margin: 4px 0;
        line-height: 1.5;
    }
    
    .message-text ol {
        margin: 8px 0;
        padding-left: 20px;
    }
    
    .message-text h1,
    .message-text h2,
    .message-text h3 {
        margin: 16px 0 8px 0;
        font-weight: 700;
        line-height: 1.3;
    }
    
    .message-text h1 {
        font-size: 1.5em;
        color: #2c3e50;
        border-bottom: 2px solid #e9ecef;
        padding-bottom: 8px;
    }
    
    .message-text h2 {
        font-size: 1.3em;
        color: #34495e;
    }
    
    .message-text h3 {
        font-size: 1.1em;
        color: #495057;
    }
    
    .message-text a {
        color: #007bff;
        text-decoration: underline;
        transition: color 0.2s ease;
    }
    
    .message-text a:hover {
        color: #0056b3;
        text-decoration: none;
    }
    
    .message-text blockquote {
        border-left: 4px solid #007bff;
        margin: 12px 0;
        padding: 8px 16px;
        background: #f8f9fa;
        font-style: italic;
        color: #6c757d;
        border-radius: 0 4px 4px 0;
    }
    
    /* 响应式设计 */
    @media (max-width: 768px) {
        .code-header {
            flex-direction: column;
            gap: 8px;
            align-items: flex-start;
        }
        
        .copy-btn {
            align-self: flex-end;
        }
        
        .code-content,
        .tool-code {
            font-size: 12px;
            padding: 12px;
        }
    }
`;
document.head.appendChild(style);

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    const client = new GeminiWebSocketClient();
    window.geminiClient = client; // 暴露到全局变量，用于onclick调用
    client.init();
}); 