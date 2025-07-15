# 为 Gemini CLI 添加 DeepSeek 模型支持

## 🎯 总体方案

基于现有架构，添加DeepSeek模型支持需要以下几个步骤：

### 1. 扩展认证类型

```typescript
// packages/core/src/core/contentGenerator.ts
export enum AuthType {
  LOGIN_WITH_GOOGLE = 'oauth-personal',
  USE_GEMINI = 'gemini-api-key',
  USE_VERTEX_AI = 'vertex-ai',
  CLOUD_SHELL = 'cloud-shell',
  USE_DEEPSEEK = 'deepseek-api-key',  // 新增
  USE_OPENAI = 'openai-api-key',      // 可选：支持OpenAI兼容的模型
}
```

### 2. 创建 DeepSeek ContentGenerator

```typescript
// packages/core/src/deepseek/deepseekContentGenerator.ts
import { ContentGenerator } from '../core/contentGenerator.js';
import { 
  GenerateContentParameters, 
  GenerateContentResponse,
  CountTokensParameters,
  CountTokensResponse,
  EmbedContentParameters,
  EmbedContentResponse 
} from '@google/genai';

export class DeepSeekContentGenerator implements ContentGenerator {
  constructor(
    private apiKey: string,
    private baseUrl: string = 'https://api.deepseek.com/v1'
  ) {}

  async generateContent(request: GenerateContentParameters): Promise<GenerateContentResponse> {
    // 1. 转换Gemini格式到DeepSeek格式
    const deepseekRequest = this.convertToDeepSeekFormat(request);
    
    // 2. 调用DeepSeek API
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(deepseekRequest),
    });

    const deepseekResponse = await response.json();
    
    // 3. 转换DeepSeek响应到Gemini格式
    return this.convertFromDeepSeekFormat(deepseekResponse);
  }

  async *generateContentStream(request: GenerateContentParameters): Promise<AsyncGenerator<GenerateContentResponse>> {
    // 流式响应实现
    const deepseekRequest = {
      ...this.convertToDeepSeekFormat(request),
      stream: true
    };

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(deepseekRequest),
    });

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') return;
            
            try {
              const chunk = JSON.parse(data);
              yield this.convertStreamChunkFromDeepSeekFormat(chunk);
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async countTokens(request: CountTokensParameters): Promise<CountTokensResponse> {
    // DeepSeek可能没有专门的token计数API，可以使用估算
    const text = this.extractTextFromRequest(request);
    const estimatedTokens = Math.ceil(text.length / 4); // 粗略估算
    return { totalTokens: estimatedTokens };
  }

  async embedContent(request: EmbedContentParameters): Promise<EmbedContentResponse> {
    // 如果DeepSeek支持embedding，实现相应逻辑
    // 否则抛出不支持的错误
    throw new Error('DeepSeek embedding not supported');
  }

  private convertToDeepSeekFormat(request: GenerateContentParameters): any {
    // 转换工具调用格式：Gemini -> OpenAI compatible
    const messages = this.convertContentsToMessages(request.contents);
    
    return {
      model: request.model,
      messages,
      tools: request.config?.tools ? this.convertToolsToOpenAIFormat(request.config.tools) : undefined,
      temperature: request.config?.temperature,
      max_tokens: request.config?.maxOutputTokens,
      top_p: request.config?.topP,
      stream: false
    };
  }

  private convertFromDeepSeekFormat(response: any): GenerateContentResponse {
    // 转换响应格式：DeepSeek -> Gemini
    const choice = response.choices[0];
    const message = choice.message;
    
    // 处理工具调用
    const parts = [];
    if (message.content) {
      parts.push({ text: message.content });
    }
    
    if (message.tool_calls) {
      for (const toolCall of message.tool_calls) {
        parts.push({
          functionCall: {
            id: toolCall.id,
            name: toolCall.function.name,
            args: JSON.parse(toolCall.function.arguments)
          }
        });
      }
    }

    return {
      candidates: [{
        content: {
          parts,
          role: 'model'
        }
      }],
      usageMetadata: {
        promptTokenCount: response.usage?.prompt_tokens || 0,
        candidatesTokenCount: response.usage?.completion_tokens || 0,
        totalTokenCount: response.usage?.total_tokens || 0
      }
    };
  }

  private convertToolsToOpenAIFormat(geminiTools: any[]): any[] {
    return geminiTools.flatMap(tool => 
      tool.functionDeclarations?.map((func: any) => ({
        type: 'function',
        function: {
          name: func.name,
          description: func.description,
          parameters: func.parameters
        }
      })) || []
    );
  }

  private convertContentsToMessages(contents: any[]): any[] {
    return contents.map(content => ({
      role: content.role === 'user' ? 'user' : 'assistant',
      content: content.parts?.map((part: any) => {
        if (part.text) return part.text;
        if (part.functionCall) return `[Function Call: ${part.functionCall.name}]`;
        if (part.functionResponse) return `[Function Response: ${part.functionResponse.name}]`;
        return '[Unknown Content]';
      }).join('\n') || ''
    }));
  }

  private convertStreamChunkFromDeepSeekFormat(chunk: any): GenerateContentResponse {
    const delta = chunk.choices[0]?.delta;
    if (!delta) return { candidates: [] };

    const parts = [];
    if (delta.content) {
      parts.push({ text: delta.content });
    }

    if (delta.tool_calls) {
      for (const toolCall of delta.tool_calls) {
        parts.push({
          functionCall: {
            id: toolCall.id,
            name: toolCall.function?.name,
            args: toolCall.function?.arguments ? JSON.parse(toolCall.function.arguments) : {}
          }
        });
      }
    }

    return {
      candidates: [{
        content: {
          parts,
          role: 'model'
        }
      }]
    };
  }

  private extractTextFromRequest(request: CountTokensParameters): string {
    return request.contents?.map(content => 
      content.parts?.map(part => part.text || '').join(' ') || ''
    ).join(' ') || '';
  }
}
```

### 3. 扩展配置系统

```typescript
// packages/core/src/core/contentGenerator.ts
export async function createContentGeneratorConfig(
  model: string | undefined,
  authType: AuthType | undefined,
): Promise<ContentGeneratorConfig> {
  const geminiApiKey = process.env.GEMINI_API_KEY || undefined;
  const googleApiKey = process.env.GOOGLE_API_KEY || undefined;
  const googleCloudProject = process.env.GOOGLE_CLOUD_PROJECT || undefined;
  const googleCloudLocation = process.env.GOOGLE_CLOUD_LOCATION || undefined;
  const deepseekApiKey = process.env.DEEPSEEK_API_KEY || undefined;  // 新增

  const effectiveModel = model || DEFAULT_GEMINI_MODEL;

  const contentGeneratorConfig: ContentGeneratorConfig = {
    model: effectiveModel,
    authType,
  };

  // 处理其他认证类型...

  // 新增：DeepSeek支持
  if (authType === AuthType.USE_DEEPSEEK && deepseekApiKey) {
    contentGeneratorConfig.apiKey = deepseekApiKey;
    contentGeneratorConfig.provider = 'deepseek';  // 新增provider字段
    return contentGeneratorConfig;
  }

  return contentGeneratorConfig;
}

export async function createContentGenerator(
  config: ContentGeneratorConfig,
  gcConfig: Config,
  sessionId?: string,
): Promise<ContentGenerator> {
  const version = process.env.CLI_VERSION || process.version;
  const httpOptions = {
    headers: {
      'User-Agent': `GeminiCLI/${version} (${process.platform}; ${process.arch})`,
    },
  };

  // 现有的Google相关实现...

  // 新增：DeepSeek支持
  if (config.authType === AuthType.USE_DEEPSEEK) {
    return new DeepSeekContentGenerator(config.apiKey!);
  }

  throw new Error(
    `Error creating contentGenerator: Unsupported authType: ${config.authType}`,
  );
}
```

### 4. 添加模型定义

```typescript
// packages/core/src/config/models.ts
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-pro';
export const DEFAULT_GEMINI_FLASH_MODEL = 'gemini-2.5-flash';
export const DEFAULT_GEMINI_EMBEDDING_MODEL = 'gemini-embedding-001';

// 新增：DeepSeek模型定义
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat';
export const DEFAULT_DEEPSEEK_CODER_MODEL = 'deepseek-coder';
```

### 5. 扩展CLI配置

```typescript
// packages/cli/src/config/auth.ts
export function validateAuthMethod(authMethod: string): string | null {
  switch (authMethod) {
    case 'oauth-personal':
      return null;
    case 'gemini-api-key':
      if (!process.env.GEMINI_API_KEY) {
        return 'GEMINI_API_KEY environment variable is required...';
      }
      return null;
    case 'vertex-ai':
      // 现有验证逻辑...
    case 'deepseek-api-key':  // 新增
      if (!process.env.DEEPSEEK_API_KEY) {
        return 'DEEPSEEK_API_KEY environment variable is required. Please set it in your .env file or environment.';
      }
      return null;
    default:
      return `Unknown auth method: ${authMethod}`;
  }
}
```

### 6. 更新Token限制配置

```typescript
// packages/core/src/core/tokenLimits.ts
export function getTokenLimits(model: string): TokenLimits {
  // 现有Gemini模型配置...
  
  // 新增：DeepSeek模型配置
  if (model.startsWith('deepseek-chat')) {
    return {
      input: 32000,
      output: 4000,
      total: 36000,
    };
  }
  
  if (model.startsWith('deepseek-coder')) {
    return {
      input: 128000,
      output: 4000,
      total: 132000,
    };
  }
  
  // 默认配置...
}
```

### 7. 环境变量配置

```bash
# .env 文件示例
DEEPSEEK_API_KEY=your_deepseek_api_key_here
```

### 8. 使用示例

```bash
# 启动CLI时指定DeepSeek模型
npx gemini-cli --auth deepseek-api-key --model deepseek-chat

# 或者通过环境变量
export DEEPSEEK_API_KEY=your_key
export MODEL=deepseek-chat
npx gemini-cli --auth deepseek-api-key
```

## 🔧 核心技术挑战

### 1. **工具调用格式转换**
- Gemini使用自定义的 `FunctionCall` 格式
- DeepSeek使用OpenAI兼容的 `tool_calls` 格式
- 需要双向转换逻辑

### 2. **响应格式兼容**
- 确保所有响应都符合 `GenerateContentResponse` 接口
- 处理流式响应的差异
- 保持usage metadata的一致性

### 3. **错误处理**
- 不同API的错误格式不同
- 需要统一的错误处理机制
- 重试逻辑的适配

## 🎯 实施建议

### 阶段1：基础支持
1. 实现 `DeepSeekContentGenerator` 基础功能
2. 添加认证和配置支持
3. 实现基本的文本对话功能

### 阶段2：工具调用
1. 实现工具调用格式转换
2. 测试核心工具（read_file, write_file, run_shell_command）
3. 确保工具执行流程正常

### 阶段3：高级功能
1. 流式响应支持
2. 错误处理和重试机制
3. 性能优化和缓存

### 阶段4：完善生态
1. 添加更多模型支持（Claude, ChatGPT等）
2. 完善文档和测试
3. 社区反馈和优化

## 📝 总结

通过这个方案，您可以：

1. **最小化代码改动**：复用现有的工具系统和UI层
2. **保持兼容性**：原有的Gemini功能不受影响
3. **扩展性良好**：未来可以轻松添加更多模型支持
4. **用户体验一致**：所有模型都使用相同的提示词和工具系统

这种架构充分利用了项目现有的抽象层，使得添加新模型支持变得相对简单和安全。 