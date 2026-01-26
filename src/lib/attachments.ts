/**
 * Attachment processing utilities for the Compose area
 */

import type { Attachment } from './types';
import { readFileMetadata, readFileAsBase64, countFileLines, getImageDimensions } from './tauri';

// ============================================================================
// Constants
// ============================================================================

export const ATTACHMENT_LIMITS = {
  MAX_FILE_SIZE: 5 * 1024 * 1024,      // 5MB per file
  MAX_TOTAL_SIZE: 20 * 1024 * 1024,    // 20MB total per message
  MAX_ATTACHMENTS: 10,                  // Max files per message
  PREVIEW_LENGTH: 500,                  // Characters for text preview
};

export const SUPPORTED_EXTENSIONS: Record<string, string[]> = {
  images: ['.png', '.jpg', '.jpeg', '.gif', '.webp'],
  text: ['.txt', '.md', '.markdown', '.csv'],
  code: [
    '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
    '.go', '.py', '.rs', '.rb', '.java', '.c', '.cpp', '.h', '.hpp',
    '.swift', '.kt', '.scala', '.php', '.cs', '.fs',
  ],
  config: ['.json', '.yaml', '.yml', '.toml', '.xml', '.env', '.ini', '.conf'],
  shell: ['.sh', '.bash', '.zsh', '.fish', '.ps1'],
  markup: ['.html', '.htm', '.css', '.scss', '.sass', '.less'],
  data: ['.sql', '.graphql', '.proto'],
};

// Flatten all supported extensions for easy lookup
const ALL_SUPPORTED_EXTENSIONS = new Set(
  Object.values(SUPPORTED_EXTENSIONS).flat().map(ext => ext.toLowerCase())
);

// MIME type mapping
const MIME_TYPES: Record<string, string> = {
  // Images
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  // Text
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.csv': 'text/csv',
  // Code
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.js': 'text/javascript',
  '.jsx': 'text/javascript',
  '.mjs': 'text/javascript',
  '.cjs': 'text/javascript',
  '.go': 'text/x-go',
  '.py': 'text/x-python',
  '.rs': 'text/x-rust',
  '.rb': 'text/x-ruby',
  '.java': 'text/x-java',
  '.c': 'text/x-c',
  '.cpp': 'text/x-c++',
  '.h': 'text/x-c',
  '.hpp': 'text/x-c++',
  '.swift': 'text/x-swift',
  '.kt': 'text/x-kotlin',
  '.scala': 'text/x-scala',
  '.php': 'text/x-php',
  '.cs': 'text/x-csharp',
  '.fs': 'text/x-fsharp',
  // Config
  '.json': 'application/json',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.toml': 'text/toml',
  '.xml': 'application/xml',
  '.env': 'text/plain',
  '.ini': 'text/plain',
  '.conf': 'text/plain',
  // Shell
  '.sh': 'text/x-shellscript',
  '.bash': 'text/x-shellscript',
  '.zsh': 'text/x-shellscript',
  '.fish': 'text/x-shellscript',
  '.ps1': 'text/x-powershell',
  // Markup
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.scss': 'text/x-scss',
  '.sass': 'text/x-sass',
  '.less': 'text/x-less',
  // Data
  '.sql': 'text/x-sql',
  '.graphql': 'text/x-graphql',
  '.proto': 'text/x-protobuf',
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get file extension from path (lowercase)
 */
export function getFileExtension(path: string): string {
  const lastDot = path.lastIndexOf('.');
  if (lastDot === -1) return '';
  return path.slice(lastDot).toLowerCase();
}

/**
 * Get filename from path
 */
export function getFileName(path: string): string {
  const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return lastSlash === -1 ? path : path.slice(lastSlash + 1);
}

/**
 * Check if file extension is supported
 */
export function isFileSupported(path: string): boolean {
  const ext = getFileExtension(path);
  return ALL_SUPPORTED_EXTENSIONS.has(ext);
}

/**
 * Get MIME type for a file path
 */
export function getMimeType(path: string): string {
  const ext = getFileExtension(path);
  return MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * Get file category based on extension
 */
export function getFileCategory(path: string): 'image' | 'code' | 'text' | 'config' | 'shell' | 'markup' | 'data' | 'unknown' {
  const ext = getFileExtension(path);
  for (const [category, extensions] of Object.entries(SUPPORTED_EXTENSIONS)) {
    if (extensions.includes(ext)) {
      return category as 'image' | 'code' | 'text' | 'config' | 'shell' | 'markup' | 'data';
    }
  }
  return 'unknown';
}

/**
 * Check if file is an image
 */
export function isImage(path: string): boolean {
  return getFileCategory(path) === 'image';
}

/**
 * Generate a unique ID for attachments
 */
export function generateAttachmentId(): string {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============================================================================
// Validation
// ============================================================================

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate a single file for attachment
 */
export function validateFile(path: string, size: number): ValidationResult {
  const ext = getFileExtension(path);

  // Check extension
  if (!ALL_SUPPORTED_EXTENSIONS.has(ext)) {
    return { valid: false, error: `Unsupported file type: ${ext}` };
  }

  // Check size
  if (size > ATTACHMENT_LIMITS.MAX_FILE_SIZE) {
    return { valid: false, error: `File too large (max ${formatFileSize(ATTACHMENT_LIMITS.MAX_FILE_SIZE)}): ${getFileName(path)}` };
  }

  return { valid: true };
}

/**
 * Validate the current set of attachments
 */
export function validateAttachments(attachments: Attachment[]): ValidationResult {
  // Check count
  if (attachments.length > ATTACHMENT_LIMITS.MAX_ATTACHMENTS) {
    return { valid: false, error: `Too many attachments (max ${ATTACHMENT_LIMITS.MAX_ATTACHMENTS})` };
  }

  // Check total size
  const totalSize = attachments.reduce((sum, a) => sum + a.size, 0);
  if (totalSize > ATTACHMENT_LIMITS.MAX_TOTAL_SIZE) {
    return { valid: false, error: `Total attachment size exceeds ${formatFileSize(ATTACHMENT_LIMITS.MAX_TOTAL_SIZE)}` };
  }

  return { valid: true };
}

// ============================================================================
// File Processing
// ============================================================================

export interface ProcessResult {
  attachments: Attachment[];
  errors: string[];
}

/**
 * Process a single file into an attachment
 */
async function processSingleFile(path: string): Promise<{ attachment?: Attachment; error?: string }> {
  try {
    // Get file metadata
    const metadata = await readFileMetadata(path);
    if (!metadata) {
      return { error: `Failed to read file: ${getFileName(path)}` };
    }

    // Check if it's a directory
    if (metadata.isDirectory) {
      return { error: 'Folders cannot be attached' };
    }

    // Validate file
    const validation = validateFile(path, metadata.size);
    if (!validation.valid) {
      return { error: validation.error! };
    }

    // Create base attachment
    const attachment: Attachment = {
      id: generateAttachmentId(),
      type: isImage(path) ? 'image' : 'file',
      name: getFileName(path),
      path: path,
      mimeType: getMimeType(path),
      size: metadata.size,
    };

    // Get additional metadata based on type
    if (isImage(path)) {
      const dimensions = await getImageDimensions(path);
      if (dimensions) {
        attachment.width = dimensions.width;
        attachment.height = dimensions.height;
      }
    } else {
      // Count lines for text files
      const lines = await countFileLines(path);
      if (lines !== null) {
        attachment.lineCount = lines;
      }
    }

    return { attachment };
  } catch (err) {
    return { error: `Error processing ${getFileName(path)}: ${err instanceof Error ? err.message : 'Unknown error'}` };
  }
}

/**
 * Process dropped files into attachments (parallel processing for better performance)
 */
export async function processDroppedFiles(paths: string[]): Promise<ProcessResult> {
  // Process all files in parallel
  const results = await Promise.allSettled(paths.map(processSingleFile));

  const attachments: Attachment[] = [];
  const errors: string[] = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      if (result.value.attachment) {
        attachments.push(result.value.attachment);
      } else if (result.value.error) {
        errors.push(result.value.error);
      }
    } else {
      // Promise rejected (shouldn't happen with our try/catch, but handle it)
      errors.push(`Unexpected error: ${result.reason}`);
    }
  }

  return { attachments, errors };
}

/**
 * Load base64 content for an attachment (for sending to API)
 */
export async function loadAttachmentContent(attachment: Attachment): Promise<Attachment> {
  if (attachment.base64Data) {
    return attachment; // Already loaded
  }

  if (!attachment.path) {
    throw new Error(`Cannot load content: attachment "${attachment.name}" has no path`);
  }

  const base64 = await readFileAsBase64(attachment.path);
  if (!base64) {
    throw new Error(`Failed to read file content: ${attachment.name}`);
  }

  return {
    ...attachment,
    base64Data: base64,
  };
}

/**
 * Load base64 content for all attachments
 */
export async function loadAllAttachmentContents(attachments: Attachment[]): Promise<Attachment[]> {
  return Promise.all(attachments.map(loadAttachmentContent));
}

// ============================================================================
// Display Helpers
// ============================================================================

/**
 * Get subtitle/metadata text for an attachment card
 */
export function getAttachmentSubtitle(attachment: Attachment): string {
  if (attachment.type === 'image' && attachment.width && attachment.height) {
    return `${attachment.width}x${attachment.height}`;
  }
  if (attachment.lineCount !== undefined && attachment.lineCount > 0) {
    return `+${attachment.lineCount} lines`;
  }
  return formatFileSize(attachment.size);
}
