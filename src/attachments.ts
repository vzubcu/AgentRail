import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type {
  ChatAttachmentMetadataContentPart,
  ChatCompletionRequest,
  ChatContentPart,
  ChatImageUrlContentPart,
  ChatImageUrlValue,
  ChatInputFileContentPart,
  ChatMessageContent,
} from './types.js';
import { providers } from './providers/index.js';
import { inferCapabilities } from './models/capabilities.js';
import { AUTO_MODEL_ID, AUTO_MODEL_ALIASES, FILES_MODEL_ID } from './router.js';

const CACHE_RELATIVE_DIR = path.join('.agentrail', 'attachments-cache');
const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX_BYTES = 50 * 1024 * 1024;
const SUPPORTED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const STANDARD_FONT_DATA_URL = new URL('../node_modules/pdfjs-dist/standard_fonts/', import.meta.url).toString();

export interface AttachmentProcessingSummary {
  filename: string;
  mimeType: string;
  kind: 'image' | 'pdf';
  status: 'inlined' | 'extracted';
  sizeBytes: number;
  cachePath: string;
  textLength?: number;
}

export interface NormalizedAttachmentRequest {
  request: ChatCompletionRequest;
  summaries: AttachmentProcessingSummary[];
}

export class AttachmentProcessingError extends Error {
  readonly status = 400;
  readonly type = 'invalid_request_error';

  constructor(message: string) {
    super(message);
    this.name = 'AttachmentProcessingError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeLooseContentParts(content: unknown, depth = 0): ChatContentPart[] | null {
  if (depth > 3) {
    return null;
  }

  if (Array.isArray(content)) {
    const normalized: ChatContentPart[] = [];
    for (const item of content) {
      const parts = normalizeLooseContentParts(item, depth + 1);
      if (!parts) {
        return null;
      }
      normalized.push(...parts);
    }
    return normalized;
  }

  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }

  if (!isRecord(content)) {
    return null;
  }

  if (typeof content.text === 'string' && (!content.type || content.type === 'text' || content.type === 'input_text')) {
    return [{ type: 'text', text: content.text }];
  }

  for (const nestedKey of ['content', 'parts', 'blocks']) {
    const nested = content[nestedKey];
    if (nested !== undefined) {
      const normalizedNested = normalizeLooseContentParts(nested, depth + 1);
      if (normalizedNested) {
        return normalizedNested;
      }
    }
  }

  if (typeof content.content === 'string' && !content.type) {
    return [{ type: 'text', text: content.content }];
  }

  const type = typeof content.type === 'string' ? content.type : '';
  if (!type) {
    return null;
  }

  switch (type) {
    case 'text':
    case 'input_text':
      if (typeof content.text !== 'string') {
        return null;
      }
      return [{ type, text: content.text } as ChatContentPart];
    case 'image_url':
      if (typeof content.image_url !== 'string' && !isRecord(content.image_url)) {
        return null;
      }
      return [{
        type: 'image_url',
        image_url: normalizeImageUrlValue(content.image_url),
      }];
    case 'input_image':
      if (typeof content.image_url !== 'string' && !isRecord(content.image_url)) {
        return null;
      }
      return [{
        type: 'input_image',
        image_url: typeof content.image_url === 'string'
          ? content.image_url
          : normalizeImageUrlValue(content.image_url),
        detail: normalizeImageDetail(content.detail),
      }];
    case 'input_file':
      if (typeof content.filename !== 'string' || content.filename.length === 0) {
        return null;
      }
      return [{
        type: 'input_file',
        filename: content.filename,
        mime_type: typeof content.mime_type === 'string' ? content.mime_type : undefined,
        data: typeof content.data === 'string' ? content.data : undefined,
        text: typeof content.text === 'string' ? content.text : undefined,
      }];
    case 'attachment_metadata':
      if (typeof content.filename !== 'string' || content.filename.length === 0) {
        return null;
      }
      return [{
        type: 'attachment_metadata',
        filename: content.filename,
        attachment_id: typeof content.attachment_id === 'string' ? content.attachment_id : undefined,
        mime_type: typeof content.mime_type === 'string' ? content.mime_type : undefined,
        size_bytes: typeof content.size_bytes === 'number' ? content.size_bytes : undefined,
        cache_path: typeof content.cache_path === 'string' ? content.cache_path : undefined,
        source: typeof content.source === 'string' ? content.source : undefined,
        status: typeof content.status === 'string' ? content.status : undefined,
      }];
    default:
      return null;
  }
}

function safeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-120) || 'attachment.bin';
}

function normalizeMimeType(value: string | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeImageUrlValue(value: unknown, detail?: unknown): ChatImageUrlValue {
  if (typeof value === 'string') {
    return { url: value, detail: normalizeImageDetail(detail) };
  }

  if (isRecord(value) && typeof value.url === 'string') {
    return {
      url: value.url,
      detail: normalizeImageDetail(value.detail ?? detail),
    };
  }

  throw new AttachmentProcessingError('Image attachment is missing a valid URL.');
}

function normalizeImageDetail(value: unknown): 'auto' | 'low' | 'high' | undefined {
  if (value === 'auto' || value === 'low' || value === 'high') return value;
  return undefined;
}

function isImageUrlPart(part: ChatContentPart): part is ChatImageUrlContentPart {
  return part.type === 'image_url';
}

function decodeDataPayload(part: ChatInputFileContentPart): { buffer: Buffer; mimeType: string; dataUrl: string } {
  const raw = typeof part.data === 'string' ? part.data.trim() : '';
  const fallbackMime = normalizeMimeType(part.mime_type);

  if (!raw) {
    throw new AttachmentProcessingError(`Attachment "${part.filename}" is missing file data.`);
  }

  if (raw.startsWith('data:')) {
    const match = raw.match(/^data:([^;,]+)?;base64,([\s\S]+)$/i);
    if (!match) {
      throw new AttachmentProcessingError(`Attachment "${part.filename}" must use a base64 data URL.`);
    }
    const mimeType = normalizeMimeType(match[1] || fallbackMime);
    if (!mimeType) {
      throw new AttachmentProcessingError(`Attachment "${part.filename}" is missing a MIME type.`);
    }
    return {
      buffer: Buffer.from(match[2], 'base64'),
      mimeType,
      dataUrl: `data:${mimeType};base64,${match[2]}`,
    };
  }

  if (!fallbackMime) {
    throw new AttachmentProcessingError(`Attachment "${part.filename}" must include mime_type when data is raw base64.`);
  }

  return {
    buffer: Buffer.from(raw, 'base64'),
    mimeType: fallbackMime,
    dataUrl: `data:${fallbackMime};base64,${raw}`,
  };
}

async function writeAttachmentCache(rootDir: string, filename: string, buffer: Buffer): Promise<string> {
  const dir = getAttachmentCacheDir(rootDir);
  await mkdir(dir, { recursive: true });
  const targetPath = path.join(dir, `${Date.now()}-${randomUUID()}-${safeFilename(filename)}`);
  await writeFile(targetPath, buffer);
  return targetPath;
}

async function cleanupAttachmentCache(rootDir: string): Promise<void> {
  const dir = getAttachmentCacheDir(rootDir);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  const files = await Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => {
    const filePath = path.join(dir, entry.name);
    const stats = await stat(filePath);
    return {
      filePath,
      mtimeMs: stats.mtimeMs,
      size: stats.size,
    };
  }));

  const now = Date.now();
  for (const file of files) {
    if (now - file.mtimeMs > CACHE_MAX_AGE_MS) {
      await rm(file.filePath, { force: true });
    }
  }

  const freshFiles = files
    .filter((file) => now - file.mtimeMs <= CACHE_MAX_AGE_MS)
    .sort((a, b) => a.mtimeMs - b.mtimeMs);
  let total = freshFiles.reduce((sum, file) => sum + file.size, 0);

  for (const file of freshFiles) {
    if (total <= CACHE_MAX_BYTES) break;
    await rm(file.filePath, { force: true });
    total -= file.size;
  }
}

function formatPdfText(filename: string, extractedText: string): string {
  const cleaned = extractedText.replace(/\s+\n/g, '\n').trim();
  if (!cleaned) {
    throw new AttachmentProcessingError(`Attachment "${filename}" did not contain extractable text.`);
  }
  return `[Attachment: ${filename}]\n[PDF extract]\n${cleaned}`;
}

async function normalizeContentArray(
  content: ChatContentPart[],
  rootDir: string,
  summaries: AttachmentProcessingSummary[],
  preserveNativeFiles: boolean,
): Promise<ChatContentPart[]> {
  const normalized: ChatContentPart[] = [];

  for (const part of content) {
    switch (part.type) {
      case 'text': {
        normalized.push({ type: 'text', text: String(part.text ?? '') });
        break;
      }
      case 'input_text': {
        normalized.push({ type: 'text', text: String(part.text ?? '') });
        break;
      }
      case 'image_url': {
        normalized.push({
          type: 'image_url',
          image_url: normalizeImageUrlValue(part.image_url),
        });
        break;
      }
      case 'input_image': {
        normalized.push({
          type: 'image_url',
          image_url: normalizeImageUrlValue(part.image_url, part.detail),
        });
        break;
      }
      case 'attachment_metadata': {
        break;
      }
      case 'input_file': {
        if (preserveNativeFiles) {
          normalized.push({
            type: 'input_file',
            filename: part.filename,
            mime_type: typeof part.mime_type === 'string' ? part.mime_type : undefined,
            data: typeof part.data === 'string' ? part.data : undefined,
            text: typeof part.text === 'string' ? part.text : undefined,
          });
          break;
        }

        if (typeof part.text === 'string' && part.text.trim()) {
          normalized.push({ type: 'text', text: formatPdfText(part.filename, part.text) });
          break;
        }

        const { buffer, mimeType, dataUrl } = decodeDataPayload(part);
        const cachePath = await writeAttachmentCache(rootDir, part.filename, buffer);

        if (SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
          normalized.push({ type: 'image_url', image_url: { url: dataUrl } });
          summaries.push({
            filename: part.filename,
            mimeType,
            kind: 'image',
            status: 'inlined',
            sizeBytes: buffer.byteLength,
            cachePath,
          });
          break;
        }

        if (mimeType === 'application/pdf') {
          const extractedText = await extractPdfTextFromBuffer(buffer);
          normalized.push({ type: 'text', text: formatPdfText(part.filename, extractedText) });
          summaries.push({
            filename: part.filename,
            mimeType,
            kind: 'pdf',
            status: 'extracted',
            sizeBytes: buffer.byteLength,
            cachePath,
            textLength: extractedText.trim().length,
          });
          break;
        }

        throw new AttachmentProcessingError(`Unsupported attachment type for "${part.filename}": ${mimeType || 'unknown'}.`);
      }
      default: {
        throw new AttachmentProcessingError(`Unsupported content block type: ${(part as { type?: string }).type || 'unknown'}.`);
      }
    }
  }

  return normalized;
}

export function getAttachmentCacheDir(rootDir = process.cwd()): string {
  return path.join(rootDir, CACHE_RELATIVE_DIR);
}

export async function extractPdfTextFromBuffer(buffer: Buffer): Promise<string> {
  const loadingTask = getDocument({ data: new Uint8Array(buffer), standardFontDataUrl: STANDARD_FONT_DATA_URL, verbosity: 0 });
  const pdf = await loadingTask.promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) {
      pages.push(pdf.numPages > 1 ? `[Page ${pageNumber}] ${text}` : text);
    }
  }

  return pages.join('\n\n').trim();
}

export function contentToText(content: ChatMessageContent): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (part.type === 'text' || part.type === 'input_text') return String(part.text ?? '');
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

export function messageContentHasImage(content: ChatMessageContent): boolean {
  if (typeof content === 'string') return false;
  return Array.isArray(content) && content.some((part) => {
    if (isImageUrlPart(part)) return true;
    return part.type === 'input_image';
  });
}

export function requestHasImageInputs(request: ChatCompletionRequest): boolean {
  return request.messages.some((message) => message.content != null && messageContentHasImage(message.content));
}

export function formatAttachmentSummaryHeader(summaries: AttachmentProcessingSummary[]): string {
  const images = summaries.filter((summary) => summary.kind === 'image').length;
  const pdfs = summaries.filter((summary) => summary.kind === 'pdf').length;
  return `images=${images}; pdfs=${pdfs}; total=${summaries.length}`;
}

function modelSupportsNativeFileInputs(modelId: string): boolean {
  if (modelId === FILES_MODEL_ID) {
    return true;
  }

  const slashIndex = modelId.indexOf('/');
  if (slashIndex > 0) {
    const providerName = modelId.slice(0, slashIndex);
    const bareModelId = modelId.slice(slashIndex + 1);
    const provider = providers.find((candidate) => candidate.name === providerName);
    const providerModel = provider?.supportsModel(bareModelId);
    return !!providerModel && inferCapabilities(providerModel).includes('file_input');
  }

  return providers.some((provider) => {
    const providerModel = provider.supportsModel(modelId);
    return !!providerModel && inferCapabilities(providerModel).includes('file_input');
  });
}

function filesModelSupportsVision(): boolean {
  return providers.some((provider) => provider.models.some((model) => {
    const capabilities = inferCapabilities(model);
    return capabilities.includes('file_input') && capabilities.includes('vision');
  }));
}

export function assertRequestModelCapabilities(request: ChatCompletionRequest): void {
  if (!requestHasImageInputs(request)) return;

  // agentrail/auto handles image routing via vision-capable provider filtering in router.ts
  if (request.model === AUTO_MODEL_ID || AUTO_MODEL_ALIASES.has(request.model)) {
    return;
  }

  const slashIndex = request.model.indexOf('/');
  if (slashIndex > 0) {
    const providerName = request.model.slice(0, slashIndex);
    const bareModelId = request.model.slice(slashIndex + 1);
    const provider = providers.find((candidate) => candidate.name === providerName);
    const providerModel = provider?.supportsModel(bareModelId);
    if (providerModel && inferCapabilities(providerModel).includes('vision')) {
      return;
    }
    throw new AttachmentProcessingError(`Model "${request.model}" does not support vision attachments.`);
  }

  const supportsVision = providers.some((provider) => {
    const providerModel = provider.supportsModel(request.model);
    return !!providerModel && inferCapabilities(providerModel).includes('vision');
  });

  if (!supportsVision) {
    throw new AttachmentProcessingError(`Model "${request.model}" does not support vision attachments.`);
  }
}

export async function normalizeChatRequestAttachments(
  request: ChatCompletionRequest,
  options: { rootDir?: string } = {},
): Promise<NormalizedAttachmentRequest> {
  const rootDir = options.rootDir ?? process.cwd();
  const preserveNativeFiles = modelSupportsNativeFileInputs(request.model);
  if (!preserveNativeFiles) {
    await cleanupAttachmentCache(rootDir);
  }
  const summaries: AttachmentProcessingSummary[] = [];

  const messages = await Promise.all(request.messages.map(async (message, index) => {
    if (message.content == null) {
      const toolCalls = (message as { tool_calls?: unknown[] }).tool_calls;
      if (message.role === 'assistant' && Array.isArray(toolCalls) && toolCalls.length > 0) {
        return {
          ...message,
          content: '',
        };
      }

      throw new AttachmentProcessingError(
        `messages[${index}].content must be a string or an array of content parts.`,
      );
    }

    if (typeof message.content === 'string') {
      return message;
    }

    const contentParts = Array.isArray(message.content)
      ? message.content
      : normalizeLooseContentParts(message.content);

    if (!contentParts) {
      throw new AttachmentProcessingError(
        `messages[${index}].content must be a string or an array of content parts.`,
      );
    }

    const normalizedContent = await normalizeContentArray(contentParts, rootDir, summaries, preserveNativeFiles);
    return {
      ...message,
      content: normalizedContent,
    };
  }));

  return {
    request: {
      ...request,
      messages,
    },
    summaries,
  };
}

