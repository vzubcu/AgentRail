export interface ChatTextContentPart {
  type: 'text';
  text: string;
}

export interface ChatImageUrlValue {
  url: string;
  detail?: 'auto' | 'low' | 'high';
}

export interface ChatImageUrlContentPart {
  type: 'image_url';
  image_url: ChatImageUrlValue;
}

export interface ChatInputTextContentPart {
  type: 'input_text';
  text: string;
}

export interface ChatInputImageContentPart {
  type: 'input_image';
  image_url: string | ChatImageUrlValue;
  detail?: 'auto' | 'low' | 'high';
}

export interface ChatInputFileContentPart {
  type: 'input_file';
  filename: string;
  mime_type?: string;
  data?: string;
  text?: string;
}

export interface ChatAttachmentMetadataContentPart {
  type: 'attachment_metadata';
  attachment_id?: string;
  filename: string;
  mime_type?: string;
  size_bytes?: number;
  cache_path?: string;
  source?: string;
  status?: string;
}

export type ChatContentPart =
  | ChatTextContentPart
  | ChatImageUrlContentPart
  | ChatInputTextContentPart
  | ChatInputImageContentPart
  | ChatInputFileContentPart
  | ChatAttachmentMetadataContentPart;

export type ChatMessageContent = string | ChatContentPart[];

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: ChatMessageContent | null;
}

export interface ChatCompletionToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export type ChatCompletionToolChoice =
  | 'none'
  | 'auto'
  | 'required'
  | 'any'
  | {
      type: 'function';
      function: { name: string };
    };

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  system_prompt?: string;
  tools?: ChatCompletionToolDefinition[];
  tool_choice?: ChatCompletionToolChoice;
  parallel_tool_calls?: boolean;
  [key: string]: unknown;
}

export interface ModelInfo {
  id: string;
  object: 'model';
  owned_by: string;
}

export interface ProviderModel {
  id: string;
  providerModelId: string;
  context?: number;
  maxOutput?: number;
  modality?: string;
  capabilities?: string[];
}
