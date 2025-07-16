/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// 加载环境变量
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { v4 as uuidv4 } from 'uuid';
import {
    Config,
    AuthType,
    ApprovalMode,
    DEFAULT_GEMINI_MODEL,
    DEFAULT_GEMINI_EMBEDDING_MODEL,
    FileDiscoveryService,
    GeminiEventType,
    DEFAULT_GEMINI_FLASH_MODEL
} from '@google/gemini-cli-core';

// 获取当前文件路径
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 创建Express应用
const app = express();
const PORT = process.env.PORT || 3000;

// 存储当前配置和客户端
let geminiConfig = null;
let currentSessionId = null;

// 中间件配置
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"],
        },
    },
}));

app.use(cors({
    origin: process.env.NODE_ENV === 'production'
        ? ['http://localhost:3000'] // 生产环境可以配置具体域名
        : ['http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 静态文件服务
app.use(express.static(path.join(__dirname, '../public')));

// 创建HTTP服务器
const server = createServer(app);

// 创建WebSocket服务器
const wss = new WebSocketServer({ server });

// WebSocket连接管理
const connections = new Map();

// WebSocket连接处理
wss.on('connection', (ws, request) => {
    const connectionId = uuidv4();
    const clientIP = request.socket.remoteAddress;

    console.log(`[${new Date().toISOString()}] WebSocket连接建立: ${connectionId} (${clientIP})`);

    // 存储连接信息
    connections.set(connectionId, {
        ws,
        connectionId,
        clientIP,
        connectedAt: new Date(),
        isAlive: true
    });

    // 发送连接确认
    ws.send(JSON.stringify({
        type: 'connection_established',
        connectionId,
        timestamp: new Date().toISOString(),
        serverStatus: geminiConfig ? 'ready' : 'initializing'
    }));

    // 处理消息
    ws.on('message', async (data) => {
        try {
            const message = JSON.parse(data.toString());
            await handleWebSocketMessage(ws, connectionId, message);
        } catch (error) {
            console.error(`[${connectionId}] 处理WebSocket消息错误:`, error);
            ws.send(JSON.stringify({
                type: 'error',
                error: '消息格式错误',
                timestamp: new Date().toISOString()
            }));
        }
    });

    // 处理连接关闭
    ws.on('close', (code, reason) => {
        console.log(`[${new Date().toISOString()}] WebSocket连接关闭: ${connectionId} (代码: ${code}, 原因: ${reason.toString()})`);
        connections.delete(connectionId);
    });

    // 处理连接错误
    ws.on('error', (error) => {
        console.error(`[${connectionId}] WebSocket错误:`, error);
        connections.delete(connectionId);
    });

    // 心跳检测
    ws.on('pong', () => {
        const connection = connections.get(connectionId);
        if (connection) {
            connection.isAlive = true;
        }
    });
});

// WebSocket消息处理函数
async function handleWebSocketMessage(ws, connectionId, message) {
    const { type, data } = message;

    switch (type) {
        case 'chat':
            await handleWebSocketChat(ws, connectionId, data);
            break;

        case 'ping':
            ws.send(JSON.stringify({
                type: 'pong',
                timestamp: new Date().toISOString()
            }));
            break;

        case 'get_status':
            ws.send(JSON.stringify({
                type: 'status',
                data: {
                    serverStatus: geminiConfig ? 'ready' : 'initializing',
                    sessionId: currentSessionId,
                    model: geminiConfig?.getModel(),
                    uptime: process.uptime(),
                    activeConnections: connections.size
                },
                timestamp: new Date().toISOString()
            }));
            break;

        default:
            ws.send(JSON.stringify({
                type: 'error',
                error: `未知消息类型: ${type}`,
                timestamp: new Date().toISOString()
            }));
    }
}

// WebSocket聊天处理函数
async function handleWebSocketChat(ws, connectionId, data) {
    const { message } = data;

    // 验证输入
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
        ws.send(JSON.stringify({
            type: 'error',
            error: '消息内容不能为空',
            timestamp: new Date().toISOString()
        }));
        return;
    }

    if (message.length > 100000) {
        ws.send(JSON.stringify({
            type: 'error',
            error: '消息内容过长，请限制在100000字符以内',
            timestamp: new Date().toISOString()
        }));
        return;
    }

    // 检查配置是否已初始化
    if (!geminiConfig) {
        ws.send(JSON.stringify({
            type: 'error',
            error: '服务暂时不可用，配置未初始化',
            timestamp: new Date().toISOString()
        }));
        return;
    }

    console.log(`[${connectionId}] 收到聊天消息:`, message.substring(0, 100) + (message.length > 100 ? '...' : ''));

    // 发送开始处理消息
    ws.send(JSON.stringify({
        type: 'chat_start',
        data: {
            message: message,
            sessionId: currentSessionId
        },
        timestamp: new Date().toISOString()
    }));

    try {
        // 获取Gemini客户端和工具注册表
        const client = geminiConfig.getGeminiClient();
        const toolRegistry = await geminiConfig.getToolRegistry();

        // 创建请求的控制器用于取消
        const abortController = new AbortController();

        // 设置请求超时 (3分钟)
        const timeoutId = setTimeout(() => {
            abortController.abort();
        }, 3 * 60000);

        try {
            // 创建消息内容
            const messageContent = [{ text: message }];

            // 生成唯一的prompt_id
            const prompt_id = `ws-${connectionId.slice(0, 8)}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            // 使用WebSocket实时推送事件
            const messageStream = client.sendMessageStream(
                messageContent,
                abortController.signal,
                prompt_id
            );

            let fullResponse = '';
            let hasError = false;
            let errorMessage = '';

            // 存储待处理的工具调用
            const pendingToolCalls = [];

            for await (const event of messageStream) {
                if (abortController.signal.aborted) {
                    throw new Error('请求已取消');
                }

                // 添加调试日志
                console.log(`[${connectionId}] 收到事件: ${event.type}`, event.value ? `(长度: ${JSON.stringify(event.value).length})` : '');

                // 实时推送不同类型的事件
                switch (event.type) {
                    case GeminiEventType.Content:
                        if (event.value) {
                            fullResponse += event.value;
                            // 实时推送内容
                            ws.send(JSON.stringify({
                                type: 'content',
                                data: {
                                    content: event.value,
                                    isComplete: false
                                },
                                timestamp: new Date().toISOString()
                            }));
                        }
                        break;

                    case GeminiEventType.Thought:
                        // 推送AI思考过程
                        ws.send(JSON.stringify({
                            type: 'thought',
                            data: {
                                subject: event.value.subject,
                                description: event.value.description
                            },
                            timestamp: new Date().toISOString()
                        }));
                        break;

                    case GeminiEventType.Error:
                        hasError = true;
                        // 使用与CLI相同的错误处理方式：event.value.error 是 StructuredError
                        errorMessage = formatApiError(event.value?.error) || '处理消息时发生错误';
                        console.error(`[${connectionId}] Gemini错误:`, event.value);
                        break;

                    case GeminiEventType.MaxSessionTurns:
                        hasError = true;
                        errorMessage = '已达到最大会话轮数限制';
                        break;

                    case GeminiEventType.UserCancelled:
                        hasError = true;
                        errorMessage = '请求被用户取消';
                        break;

                    case GeminiEventType.ToolCallRequest:
                        // 收集工具调用请求，等待流结束后统一处理（参考CLI逻辑）
                        const toolCallRequest = event.value;
                        pendingToolCalls.push(toolCallRequest);

                        // 推送工具调用开始事件
                        ws.send(JSON.stringify({
                            type: 'tool_call',
                            data: {
                                eventType: event.type,
                                toolInfo: toolCallRequest,
                                status: 'pending'
                            },
                            timestamp: new Date().toISOString()
                        }));
                        break;

                    case GeminiEventType.ToolCallResponse:
                   
                    case GeminiEventType.ToolCallConfirmation:
                        // 推送工具调用信息
                        ws.send(JSON.stringify({
                            type: 'tool_call',
                            data: {
                                eventType: event.type,
                                toolInfo: event.value
                            },
                            timestamp: new Date().toISOString()
                        }));
                        break;

                    default:
                        // 推送其他事件类型
                        ws.send(JSON.stringify({
                            type: 'system_event',
                            data: {
                                eventType: event.type,
                                value: event.value
                            },
                            timestamp: new Date().toISOString()
                        }));
                        break;
                }
            }

            clearTimeout(timeoutId);

            // 如果有工具调用，执行工具并继续对话（参考CLI逻辑）
            if (pendingToolCalls.length > 0 && !hasError && !abortController.signal.aborted) {
                console.log(`[${connectionId}] 处理 ${pendingToolCalls.length} 个工具调用...`);

                const toolResponseParts = [];

                // 执行所有待处理的工具调用
                for (const toolCallRequest of pendingToolCalls) {
                    try {
                        console.log(`[${connectionId}] 执行工具调用: ${toolCallRequest.name}`);

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

                        console.log(`[${connectionId}] 工具执行完成: ${toolCallRequest.name}`);

                        // 推送工具调用结果
                        ws.send(JSON.stringify({
                            type: 'tool_call',
                            data: {
                                eventType: 'tool_call_response',
                                toolInfo: toolCallRequest,
                                toolResult: toolResult,
                                status: 'completed'
                            },
                            timestamp: new Date().toISOString()
                        }));

                        // 构建工具响应部分（参考CLI逻辑）
                        const toolResponsePart = {
                            functionResponse: {
                                name: toolCallRequest.name,
                                response: { output: typeof toolResult.llmContent === 'string' ? toolResult.llmContent : JSON.stringify(toolResult.llmContent) }
                            }
                        };

                        toolResponseParts.push(toolResponsePart);

                    } catch (toolError) {
                        console.error(`[${connectionId}] 工具调用失败: ${toolCallRequest.name}`, toolError);

                        // 推送工具调用错误
                        ws.send(JSON.stringify({
                            type: 'tool_call',
                            data: {
                                eventType: 'tool_call_error',
                                toolInfo: toolCallRequest,
                                error: toolError.message,
                                status: 'error'
                            },
                            timestamp: new Date().toISOString()
                        }));

                        // 构建错误响应部分
                        const errorResponsePart = {
                            functionResponse: {
                                name: toolCallRequest.name,
                                response: {
                                    output: `Error: ${toolError.message}`
                                }
                            }
                        };

                        toolResponseParts.push(errorResponsePart);
                    }
                }

                // 如果有工具响应，发送给AI继续对话（参考CLI的submitQuery逻辑）
                if (toolResponseParts.length > 0) {
                    console.log(`[${connectionId}] 发送工具响应给AI继续对话...`);

                    const continueStream = client.sendMessageStream(
                        toolResponseParts,
                        abortController.signal,
                        prompt_id
                    );

                    for await (const continueEvent of continueStream) {
                        if (abortController.signal.aborted) {
                            break;
                        }

                        if (continueEvent.type === GeminiEventType.Content && continueEvent.value) {
                            fullResponse += continueEvent.value;
                            // 实时推送继续的内容
                            ws.send(JSON.stringify({
                                type: 'content',
                                data: {
                                    content: continueEvent.value,
                                    isComplete: false
                                },
                                timestamp: new Date().toISOString()
                            }));
                        } else if (continueEvent.type === GeminiEventType.Error) {
                            hasError = true;
                            errorMessage = formatApiError(continueEvent.value?.error) || '生成后续响应时发生错误';
                            break;
                        }
                    }
                }
            }

            // 添加流结束调试信息
            console.log(`[${connectionId}] 消息流结束 - 响应长度: ${fullResponse.length}, 有错误: ${hasError}, 错误信息: ${errorMessage}`);

            if (hasError) {
                ws.send(JSON.stringify({
                    type: 'chat_error',
                    error: errorMessage || '处理消息时发生未知错误',
                    timestamp: new Date().toISOString()
                }));
                return;
            }

            if (!fullResponse || fullResponse.trim().length === 0) {
                ws.send(JSON.stringify({
                    type: 'chat_error',
                    error: 'AI未返回有效响应',
                    timestamp: new Date().toISOString()
                }));
                return;
            }

            console.log(`[${connectionId}] 响应完成，总长度: ${fullResponse.length}字符`);

            // 发送完成消息
            ws.send(JSON.stringify({
                type: 'chat_complete',
                data: {
                    fullResponse: fullResponse.trim(),
                    sessionId: currentSessionId,
                    responseLength: fullResponse.length,
                    toolCallsExecuted: pendingToolCalls.length
                },
                timestamp: new Date().toISOString()
            }));

        } catch (streamError) {
            clearTimeout(timeoutId);

            if (abortController.signal.aborted) {
                console.log(`[${connectionId}] 请求被取消`);
                ws.send(JSON.stringify({
                    type: 'chat_error',
                    error: '请求超时或被取消',
                    timestamp: new Date().toISOString()
                }));
                return;
            }

            throw streamError;
        }

    } catch (error) {
        console.error(`[${connectionId}] 聊天处理错误:`, error);

        // 处理特定错误类型
        let errorMessage = '服务器内部错误';

        if (error.message?.includes('quota') || error.message?.includes('QUOTA_EXCEEDED')) {
            errorMessage = 'API配额已用完，请稍后重试';
        } else if (error.message?.includes('authentication') || error.message?.includes('auth')) {
            errorMessage = 'API认证失败，请检查API密钥';
        } else if (error.message?.includes('timeout') || error.message?.includes('取消')) {
            errorMessage = '请求超时，请重试';
        } else if (error.message) {
            errorMessage = formatApiError(error.message);
        }

        ws.send(JSON.stringify({
            type: 'chat_error',
            error: errorMessage,
            timestamp: new Date().toISOString()
        }));
    }
}

// 生成唯一的会话ID
function generateSessionId() {
    return `web-session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// 格式化API错误信息，参考CLI的parseAndFormatApiError
function formatApiError(error) {
    // 如果是StructuredError结构 (从GeminiErrorEventValue中来)
    if (error && typeof error === 'object' && 'message' in error) {
        let text = `[API Error: ${error.message}]`;
        if (error.status === 429) {
            text += '\n可能的原因：API配额已用完或请求过于频繁，请稍后重试。';
        }
        return text;
    }

    // 如果是字符串形式的错误
    if (typeof error === 'string') {
        const jsonStart = error.indexOf('{');
        if (jsonStart === -1) {
            return `[API Error: ${error}]`;
        }

        const jsonString = error.substring(jsonStart);
        try {
            const parsedError = JSON.parse(jsonString);
            if (parsedError.error && parsedError.error.message) {
                let text = `[API Error: ${parsedError.error.message}]`;
                if (parsedError.error.code === 429) {
                    text += '\n可能的原因：API配额已用完或请求过于频繁，请稍后重试。';
                }
                return text;
            }
        } catch (e) {
            // 忽略JSON解析错误
        }
        return `[API Error: ${error}]`;
    }

    return '[API Error: 发生未知错误]';
}

// 初始化Gemini配置
async function initializeGeminiConfig() {
    try {
        const cwdDir = process.env.CWD || process.cwd();
        console.log('正在初始化Gemini配置...');

        // 检查环境变量
        if (!process.env.GEMINI_API_KEY) {
            throw new Error('GEMINI_API_KEY 环境变量未设置');
        }

        // 创建会话ID
        currentSessionId = generateSessionId();
        console.log(`会话ID: ${currentSessionId}`);

        // 创建文件发现服务
        const fileService = new FileDiscoveryService(cwdDir);

        // 创建配置对象
        const configParams = {
            sessionId: currentSessionId,
            embeddingModel: DEFAULT_GEMINI_EMBEDDING_MODEL,
            sandbox: undefined, // 不使用沙箱
            targetDir: cwdDir,
            debugMode: process.env.DEBUG === 'true',
            question: undefined,
            fullContext: false,
            coreTools: ['LSTool','ReadFileTool','ReadManyFilesTool', 'WriteFileTool', 'EditTool', 'GrepTool','GlobTool', 'ShellTool','WebFetchTool','WebSearchTool','MemoryTool'], // 启用核心文件操作工具
            excludeTools: [],
            toolDiscoveryCommand: undefined,
            toolCallCommand: undefined,
            mcpServerCommand: undefined,
            mcpServers: undefined,
            userMemory: '',
            geminiMdFileCount: 0,
            approvalMode: ApprovalMode.YOLO, // 自动执行，适合Web环境
            showMemoryUsage: false,
            accessibility: {},
            telemetry: {
                enabled: false
            },
            usageStatisticsEnabled: false,
            fileFiltering: {
                respectGitIgnore: true,
                enableRecursiveFileSearch: true
            },
            checkpointing: false,
            proxy: undefined,
            cwd: cwdDir,
            fileDiscoveryService: fileService,
            bugCommand: undefined,
            model: process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
            extensionContextFilePaths: [],
            maxSessionTurns: 100, // 限制会话轮数
            listExtensions: false,
            activeExtensions: [],
            noBrowser: true
        };

        // 创建配置实例
        geminiConfig = new Config(configParams);

        // 初始化配置
        await geminiConfig.initialize();

        // 设置认证
        await geminiConfig.refreshAuth(AuthType.USE_GEMINI);

        console.log('✅ Gemini配置初始化完成');
        console.log(`模型: ${geminiConfig.getModel()}`);
        console.log(`目标目录: ${geminiConfig.getTargetDir()}`);

        return true;
    } catch (error) {
        console.error('❌ 初始化Gemini配置失败:', error.message);
        if (error.stack) {
            console.error(error.stack);
        }
        return false;
    }
}

// 健康检查接口
app.get('/api/health', (req, res) => {
    const isHealthy = geminiConfig !== null;
    res.status(isHealthy ? 200 : 503).json({
        status: isHealthy ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        sessionId: currentSessionId,
        model: geminiConfig?.getModel(),
        uptime: process.uptime()
    });
});

// 聊天接口
app.post('/api/chat', async (req, res) => {
    try {
        const { message } = req.body;

        // 验证输入
        if (!message || typeof message !== 'string' || message.trim().length === 0) {
            return res.status(400).json({
                error: '消息内容不能为空',
                response: null
            });
        }

        if (message.length > 10000) {
            return res.status(400).json({
                error: '消息内容过长，请限制在10000字符以内',
                response: null
            });
        }

        // 检查配置是否已初始化
        if (!geminiConfig) {
            console.error('Gemini配置未初始化');
            return res.status(503).json({
                error: '服务暂时不可用，配置未初始化',
                response: null
            });
        }

        console.log(`[${new Date().toISOString()}] 收到消息:`, message.substring(0, 100) + (message.length > 100 ? '...' : ''));

        // 获取Gemini客户端和工具注册表
        const client = geminiConfig.getGeminiClient();
        const toolRegistry = await geminiConfig.getToolRegistry();

        // 创建请求的控制器用于取消
        const abortController = new AbortController();

        // 设置请求超时 (3分钟)
        const timeoutId = setTimeout(() => {
            abortController.abort();
        }, 3 * 60000);

        try {
            // 创建消息内容 - 修正为正确的PartListUnion格式
            const messageContent = [{ text: message }];

            // 生成唯一的prompt_id
            const prompt_id = `rest-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            // 发送消息并收集响应
            let fullResponse = '';
            let hasError = false;
            let errorMessage = '';

            // 存储待处理的工具调用
            const pendingToolCalls = [];

            // 使用正确的API调用方式
            const messageStream = client.sendMessageStream(
                messageContent,
                abortController.signal,
                prompt_id
            );

            for await (const event of messageStream) {
                if (abortController.signal.aborted) {
                    throw new Error('请求已取消');
                }

                // 正确处理不同类型的事件
                switch (event.type) {
                    case GeminiEventType.Content:
                        // 累积内容响应
                        if (event.value) {
                            fullResponse += event.value;
                        }
                        break;

                    case GeminiEventType.Thought:
                        // 思考事件，可以选择性地包含在响应中或忽略
                        // 这里我们选择忽略，因为用户主要关心最终答案
                        break;

                    case GeminiEventType.Error:
                        hasError = true;
                        errorMessage = formatApiError(event.value?.error) || '处理消息时发生错误';
                        console.error('Gemini错误:', event.value);
                        break;

                    case GeminiEventType.MaxSessionTurns:
                        hasError = true;
                        errorMessage = '已达到最大会话轮数限制';
                        break;

                    case GeminiEventType.UserCancelled:
                        hasError = true;
                        errorMessage = '请求被用户取消';
                        break;

                    case GeminiEventType.ToolCallRequest:
                        // 收集工具调用请求，等待流结束后统一处理（参考CLI逻辑）
                        const toolCallRequest = event.value;
                        pendingToolCalls.push(toolCallRequest);
                        console.log(`[REST] 收到工具调用请求: ${toolCallRequest.name}`);
                        break;

                    case GeminiEventType.ToolCallResponse:
                    case GeminiEventType.ToolCallConfirmation:
                        // REST API中忽略这些事件，因为我们已经在tool_call_request中处理了
                        console.log('收到工具调用事件:', event.type);
                        break;

                    default:
                        // 忽略其他事件类型
                        console.log('收到未处理的事件类型:', event.type);
                        break;
                }
            }

            // 如果有工具调用，执行工具并继续对话（参考CLI逻辑）
            if (pendingToolCalls.length > 0 && !hasError && !abortController.signal.aborted) {
                console.log(`[REST] 处理 ${pendingToolCalls.length} 个工具调用...`);

                const toolResponseParts = [];

                // 执行所有待处理的工具调用
                for (const toolCallRequest of pendingToolCalls) {
                    try {
                        console.log(`[REST] 执行工具调用: ${toolCallRequest.name}`);

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

                        console.log(`[REST] 工具执行完成: ${toolCallRequest.name}`);

                        // 构建工具响应部分（参考CLI逻辑）
                        const toolResponsePart = {
                            functionResponse: {
                                name: toolCallRequest.name,
                                response: { output: typeof toolResult.llmContent === 'string' ? toolResult.llmContent : JSON.stringify(toolResult.llmContent) }
                            }
                        };

                        toolResponseParts.push(toolResponsePart);

                    } catch (toolError) {
                        console.error(`[REST] 工具调用失败: ${toolCallRequest.name}`, toolError);

                        // 构建错误响应部分
                        const errorResponsePart = {
                            functionResponse: {
                                name: toolCallRequest.name,
                                response: {
                                    output: `Error: ${toolError.message}`
                                }
                            }
                        };

                        toolResponseParts.push(errorResponsePart);
                    }
                }

                // 如果有工具响应，发送给AI继续对话（参考CLI的submitQuery逻辑）
                if (toolResponseParts.length > 0) {
                    console.log(`[REST] 发送工具响应给AI继续对话...`);

                    const continueStream = client.sendMessageStream(
                        toolResponseParts,
                        abortController.signal,
                        prompt_id
                    );

                    for await (const continueEvent of continueStream) {
                        if (abortController.signal.aborted) {
                            break;
                        }

                        if (continueEvent.type === GeminiEventType.Content && continueEvent.value) {
                            fullResponse += continueEvent.value;
                        } else if (continueEvent.type === GeminiEventType.Error) {
                            hasError = true;
                            errorMessage = formatApiError(continueEvent.value?.error) || '生成后续响应时发生错误';
                            break;
                        }
                    }
                }
            }

            clearTimeout(timeoutId);

            if (hasError) {
                return res.status(500).json({
                    error: errorMessage || '处理消息时发生未知错误',
                    response: null
                });
            }

            if (!fullResponse || fullResponse.trim().length === 0) {
                return res.status(500).json({
                    error: 'AI未返回有效响应',
                    response: null
                });
            }

            console.log(`[${new Date().toISOString()}] 响应长度: ${fullResponse.length}字符`);

            // 返回成功响应
            res.json({
                response: fullResponse.trim(),
                error: null,
                sessionId: currentSessionId,
                timestamp: new Date().toISOString(),
                toolCallsExecuted: pendingToolCalls.length
            });

        } catch (streamError) {
            clearTimeout(timeoutId);

            if (abortController.signal.aborted) {
                console.log('请求被取消');
                return res.status(408).json({
                    error: '请求超时或被取消',
                    response: null
                });
            }

            throw streamError;
        }

    } catch (error) {
        console.error('聊天接口错误:', error);

        // 处理特定错误类型
        let statusCode = 500;
        let errorMessage = '服务器内部错误';

        if (error.message?.includes('quota') || error.message?.includes('QUOTA_EXCEEDED')) {
            statusCode = 429;
            errorMessage = 'API配额已用完，请稍后重试';
        } else if (error.message?.includes('authentication') || error.message?.includes('auth')) {
            statusCode = 401;
            errorMessage = 'API认证失败，请检查API密钥';
        } else if (error.message?.includes('timeout') || error.message?.includes('取消')) {
            statusCode = 408;
            errorMessage = '请求超时，请重试';
        } else if (error.message) {
            errorMessage = formatApiError(error.message);
        }

        res.status(statusCode).json({
            error: errorMessage,
            response: null,
            timestamp: new Date().toISOString()
        });
    }
});

// 重置会话接口
app.post('/api/reset', async (req, res) => {
    try {
        if (geminiConfig) {
            const client = geminiConfig.getGeminiClient();
            // 重置聊天会话
            await client.resetChat();
            console.log('会话已重置');
        }

        res.json({
            success: true,
            message: '会话已重置',
            sessionId: currentSessionId,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('重置会话失败:', error);
        res.status(500).json({
            success: false,
            error: '重置会话失败',
            timestamp: new Date().toISOString()
        });
    }
});

// 心跳检测机制
setInterval(() => {
    wss.clients.forEach((ws) => {
        const connection = [...connections.values()].find(conn => conn.ws === ws);
        if (connection) {
            if (!connection.isAlive) {
                console.log(`[${connection.connectionId}] 心跳检测失败，断开连接`);
                ws.terminate();
                connections.delete(connection.connectionId);
                return;
            }
            connection.isAlive = false;
            ws.ping();
        }
    });
}, 30000); // 每30秒检测一次

// 获取配置信息接口
app.get('/api/config', (req, res) => {
    try {
        if (!geminiConfig) {
            return res.status(503).json({
                error: '配置未初始化'
            });
        }

        res.json({
            model: geminiConfig.getModel(),
            sessionId: currentSessionId,
            targetDir: geminiConfig.getTargetDir(),
            debugMode: geminiConfig.getDebugMode(),
            maxSessionTurns: geminiConfig.getMaxSessionTurns(),
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('获取配置失败:', error);
        res.status(500).json({
            error: '获取配置失败'
        });
    }
});

// 404处理 - 对于API路径返回JSON，其他返回主页
app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
        res.status(404).json({
            error: '接口不存在',
            path: req.path,
            timestamp: new Date().toISOString()
        });
    } else {
        // 对于非API路径，返回主页面（SPA支持）
        res.sendFile(path.join(__dirname, '../public/index.html'));
    }
});

// 全局错误处理
app.use((error, req, res, next) => {
    console.error('全局错误处理:', error);

    if (res.headersSent) {
        return next(error);
    }

    res.status(500).json({
        error: '服务器内部错误',
        timestamp: new Date().toISOString()
    });
});

// 启动服务器
async function startServer() {
    try {
        console.log('🚀 启动Gemini Web Simple服务器...');
        console.log(`Node.js版本: ${process.version}`);
        console.log(`工作目录: ${process.cwd()}`);

        // 检查环境变量
        if (!process.env.GEMINI_API_KEY) {
            console.error('❌ 错误: GEMINI_API_KEY 环境变量未设置');
            console.log('请设置GEMINI_API_KEY环境变量后重试');
            process.exit(1);
        }

        // 初始化Gemini配置
        const initSuccess = await initializeGeminiConfig();
        if (!initSuccess) {
            console.error('❌ 初始化失败，服务器退出');
            process.exit(1);
        }

        // 启动服务器
        const serverInstance = server.listen(PORT, () => {
            console.log('');
            console.log('✅ 服务器启动成功!');
            console.log(`🌐 HTTP地址: http://localhost:${PORT}`);
            console.log(`🔌 WebSocket地址: ws://localhost:${PORT}`);
            console.log(`📡 REST API: http://localhost:${PORT}/api/chat`);
            console.log(`💊 健康检查: http://localhost:${PORT}/api/health`);
            console.log('');
            console.log('支持的通信方式:');
            console.log('  - HTTP REST API (传统方式)');
            console.log('  - WebSocket实时通信 (推荐)');
            console.log('');
            console.log('按 Ctrl+C 停止服务器');
        });

        // 优雅关闭
        process.on('SIGTERM', () => {
            console.log('\n收到SIGTERM信号，正在关闭服务器...');

            // 关闭所有WebSocket连接
            wss.clients.forEach((ws) => {
                ws.close(1001, '服务器关闭');
            });

            serverInstance.close(() => {
                console.log('服务器已关闭');
                process.exit(0);
            });
        });

        process.on('SIGINT', () => {
            console.log('\n收到SIGINT信号，正在关闭服务器...');

            // 关闭所有WebSocket连接
            wss.clients.forEach((ws) => {
                ws.close(1001, '服务器关闭');
            });

            serverInstance.close(() => {
                console.log('服务器已关闭');
                process.exit(0);
            });
        });

    } catch (error) {
        console.error('❌ 启动服务器失败:', error);
        process.exit(1);
    }
}

// 启动应用
startServer().catch(error => {
    console.error('❌ 应用启动失败:', error);
    process.exit(1);
}); 