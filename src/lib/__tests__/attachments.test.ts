import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getFileExtension,
  getFileName,
  isFileSupported,
  getMimeType,
  getFileCategory,
  isImage,
  generateAttachmentId,
  formatFileSize,
  validateFile,
  validateAttachments,
  processDroppedFiles,
  loadAttachmentContent,
  loadAllAttachmentContents,
  getAttachmentSubtitle,
  ATTACHMENT_LIMITS,
  SUPPORTED_EXTENSIONS,
} from '../attachments';
import type { Attachment } from '../types';

// Mock the tauri module
vi.mock('../tauri', () => ({
  readFileMetadata: vi.fn(),
  readFileAsBase64: vi.fn(),
  countFileLines: vi.fn(),
  getImageDimensions: vi.fn(),
}));

import { readFileMetadata, readFileAsBase64, countFileLines, getImageDimensions } from '../tauri';

const mockReadFileMetadata = vi.mocked(readFileMetadata);
const mockReadFileAsBase64 = vi.mocked(readFileAsBase64);
const mockCountFileLines = vi.mocked(countFileLines);
const mockGetImageDimensions = vi.mocked(getImageDimensions);

function makeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: 'att-123',
    type: 'file',
    name: 'test.ts',
    mimeType: 'text/typescript',
    size: 1024,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// getFileExtension
// ============================================================================

describe('getFileExtension', () => {
  it('returns lowercase extension with dot', () => {
    expect(getFileExtension('foo.ts')).toBe('.ts');
  });

  it('handles uppercase extensions', () => {
    expect(getFileExtension('image.PNG')).toBe('.png');
  });

  it('returns last extension for double extensions', () => {
    expect(getFileExtension('archive.tar.gz')).toBe('.gz');
  });

  it('returns empty string for files without extension', () => {
    expect(getFileExtension('Makefile')).toBe('');
  });

  it('handles paths with directories', () => {
    expect(getFileExtension('/home/user/project/index.tsx')).toBe('.tsx');
  });

  it('handles dotfiles', () => {
    // path.extname treats the entire dotfile name as the extension
    // (e.g. ".gitignore" → ".gitignore") since there's nothing before the dot.
    expect(getFileExtension('.gitignore')).toBe('.gitignore');
  });
});

// ============================================================================
// getFileName
// ============================================================================

describe('getFileName', () => {
  it('extracts filename from unix path', () => {
    expect(getFileName('/home/user/file.ts')).toBe('file.ts');
  });

  it('extracts filename from windows path', () => {
    expect(getFileName('C:\\Users\\user\\file.ts')).toBe('file.ts');
  });

  it('returns the string itself if no path separator', () => {
    expect(getFileName('file.ts')).toBe('file.ts');
  });

  it('handles trailing slash', () => {
    expect(getFileName('/foo/bar/')).toBe('');
  });
});

// ============================================================================
// isFileSupported
// ============================================================================

describe('isFileSupported', () => {
  it('returns true for supported code files', () => {
    expect(isFileSupported('app.ts')).toBe(true);
    expect(isFileSupported('app.tsx')).toBe(true);
    expect(isFileSupported('main.go')).toBe(true);
    expect(isFileSupported('script.py')).toBe(true);
  });

  it('returns true for supported image files', () => {
    expect(isFileSupported('photo.png')).toBe(true);
    expect(isFileSupported('icon.svg')).toBe(true);
  });

  it('returns true for config files', () => {
    expect(isFileSupported('package.json')).toBe(true);
    expect(isFileSupported('config.yaml')).toBe(true);
  });

  it('returns false for unsupported file types', () => {
    expect(isFileSupported('archive.zip')).toBe(false);
    expect(isFileSupported('binary.exe')).toBe(false);
    expect(isFileSupported('video.mp4')).toBe(false);
  });

  it('returns false for files without extension', () => {
    expect(isFileSupported('Makefile')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isFileSupported('IMAGE.PNG')).toBe(true);
    expect(isFileSupported('File.JSON')).toBe(true);
  });
});

// ============================================================================
// getMimeType
// ============================================================================

describe('getMimeType', () => {
  it('returns correct MIME for images', () => {
    expect(getMimeType('photo.png')).toBe('image/png');
    expect(getMimeType('photo.jpg')).toBe('image/jpeg');
    expect(getMimeType('photo.jpeg')).toBe('image/jpeg');
    expect(getMimeType('icon.svg')).toBe('image/svg+xml');
  });

  it('returns correct MIME for code files', () => {
    expect(getMimeType('app.ts')).toBe('text/typescript');
    expect(getMimeType('app.js')).toBe('text/javascript');
    expect(getMimeType('main.py')).toBe('text/x-python');
    expect(getMimeType('main.go')).toBe('text/x-go');
  });

  it('returns correct MIME for config files', () => {
    expect(getMimeType('config.json')).toBe('application/json');
    expect(getMimeType('config.yaml')).toBe('text/yaml');
  });

  it('returns octet-stream for unknown extensions', () => {
    expect(getMimeType('file.xyz')).toBe('application/octet-stream');
  });

  it('returns octet-stream for files without extension', () => {
    expect(getMimeType('Makefile')).toBe('application/octet-stream');
  });
});

// ============================================================================
// getFileCategory
// ============================================================================

describe('getFileCategory', () => {
  it('categorizes image files', () => {
    expect(getFileCategory('photo.png')).toBe('image');
    expect(getFileCategory('icon.svg')).toBe('image');
  });

  it('categorizes code files', () => {
    expect(getFileCategory('app.ts')).toBe('code');
    expect(getFileCategory('main.go')).toBe('code');
    expect(getFileCategory('lib.rs')).toBe('code');
  });

  it('categorizes text files', () => {
    expect(getFileCategory('readme.md')).toBe('text');
    expect(getFileCategory('notes.txt')).toBe('text');
  });

  it('categorizes config files', () => {
    expect(getFileCategory('package.json')).toBe('config');
    expect(getFileCategory('docker.dockerfile')).toBe('config');
  });

  it('categorizes shell files', () => {
    expect(getFileCategory('build.sh')).toBe('shell');
    expect(getFileCategory('setup.ps1')).toBe('shell');
  });

  it('categorizes markup files', () => {
    expect(getFileCategory('index.html')).toBe('markup');
    expect(getFileCategory('style.css')).toBe('markup');
  });

  it('categorizes data files', () => {
    expect(getFileCategory('schema.sql')).toBe('data');
    expect(getFileCategory('query.graphql')).toBe('data');
  });

  it('categorizes document files', () => {
    expect(getFileCategory('report.pdf')).toBe('documents');
  });

  it('returns unknown for unsupported files', () => {
    expect(getFileCategory('archive.zip')).toBe('unknown');
    expect(getFileCategory('Makefile')).toBe('unknown');
  });
});

// ============================================================================
// isImage
// ============================================================================

describe('isImage', () => {
  it('returns true for image extensions', () => {
    expect(isImage('photo.png')).toBe(true);
    expect(isImage('photo.jpg')).toBe(true);
    expect(isImage('photo.gif')).toBe(true);
    expect(isImage('photo.webp')).toBe(true);
  });

  it('returns false for non-image files', () => {
    expect(isImage('code.ts')).toBe(false);
    expect(isImage('doc.pdf')).toBe(false);
  });
});

// ============================================================================
// generateAttachmentId
// ============================================================================

describe('generateAttachmentId', () => {
  it('starts with att- prefix', () => {
    expect(generateAttachmentId()).toMatch(/^att-/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateAttachmentId()));
    expect(ids.size).toBe(100);
  });
});

// ============================================================================
// formatFileSize
// ============================================================================

describe('formatFileSize', () => {
  it('formats bytes', () => {
    expect(formatFileSize(500)).toBe('500 B');
    expect(formatFileSize(0)).toBe('0 B');
  });

  it('formats kilobytes', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB');
    expect(formatFileSize(1536)).toBe('1.5 KB');
  });

  it('formats megabytes', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('handles boundary at 1024', () => {
    expect(formatFileSize(1023)).toBe('1023 B');
    expect(formatFileSize(1024)).toBe('1.0 KB');
  });

  it('handles boundary at 1MB', () => {
    expect(formatFileSize(1024 * 1024 - 1)).toMatch(/KB$/);
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
  });
});

// ============================================================================
// validateFile
// ============================================================================

describe('validateFile', () => {
  it('accepts valid file with supported extension and size', () => {
    expect(validateFile('app.ts', 1024)).toEqual({ valid: true });
  });

  it('rejects unsupported extension', () => {
    const result = validateFile('archive.zip', 1024);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Unsupported file type');
    expect(result.error).toContain('.zip');
  });

  it('rejects file exceeding max size', () => {
    const result = validateFile('app.ts', ATTACHMENT_LIMITS.MAX_FILE_SIZE + 1);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('File too large');
  });

  it('accepts file at exactly max size', () => {
    expect(validateFile('app.ts', ATTACHMENT_LIMITS.MAX_FILE_SIZE)).toEqual({ valid: true });
  });

  it('checks extension before size', () => {
    const result = validateFile('archive.zip', ATTACHMENT_LIMITS.MAX_FILE_SIZE + 1);
    expect(result.error).toContain('Unsupported file type');
  });
});

// ============================================================================
// validateAttachments
// ============================================================================

describe('validateAttachments', () => {
  it('accepts valid set of attachments', () => {
    const attachments = [makeAttachment({ size: 1024 })];
    expect(validateAttachments(attachments)).toEqual({ valid: true });
  });

  it('rejects when too many attachments', () => {
    const attachments = Array.from({ length: ATTACHMENT_LIMITS.MAX_ATTACHMENTS + 1 }, () =>
      makeAttachment({ size: 100 })
    );
    const result = validateAttachments(attachments);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Too many attachments');
  });

  it('accepts exactly max number of attachments', () => {
    const attachments = Array.from({ length: ATTACHMENT_LIMITS.MAX_ATTACHMENTS }, () =>
      makeAttachment({ size: 100 })
    );
    expect(validateAttachments(attachments)).toEqual({ valid: true });
  });

  it('rejects when total size exceeds limit', () => {
    const attachments = [
      makeAttachment({ size: ATTACHMENT_LIMITS.MAX_TOTAL_SIZE }),
      makeAttachment({ size: 1 }),
    ];
    const result = validateAttachments(attachments);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Total attachment size');
  });

  it('accepts empty attachment list', () => {
    expect(validateAttachments([])).toEqual({ valid: true });
  });
});

// ============================================================================
// processDroppedFiles
// ============================================================================

describe('processDroppedFiles', () => {
  it('processes valid text file', async () => {
    mockReadFileMetadata.mockResolvedValue({ size: 500, isDirectory: false });
    mockCountFileLines.mockResolvedValue(42);

    const result = await processDroppedFiles(['/home/user/code.ts']);

    expect(result.attachments).toHaveLength(1);
    expect(result.errors).toHaveLength(0);
    expect(result.attachments[0]).toMatchObject({
      type: 'file',
      name: 'code.ts',
      mimeType: 'text/typescript',
      size: 500,
      lineCount: 42,
    });
  });

  it('processes valid image file with dimensions', async () => {
    mockReadFileMetadata.mockResolvedValue({ size: 2048, isDirectory: false });
    mockGetImageDimensions.mockResolvedValue({ width: 800, height: 600 });

    const result = await processDroppedFiles(['/home/user/photo.png']);

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toMatchObject({
      type: 'image',
      name: 'photo.png',
      width: 800,
      height: 600,
    });
  });

  it('returns error for directory', async () => {
    mockReadFileMetadata.mockResolvedValue({ size: 0, isDirectory: true });

    const result = await processDroppedFiles(['/home/user/src']);

    expect(result.attachments).toHaveLength(0);
    expect(result.errors).toContain('Folders cannot be attached');
  });

  it('returns error when metadata read fails', async () => {
    mockReadFileMetadata.mockResolvedValue(null);

    const result = await processDroppedFiles(['/home/user/file.ts']);

    expect(result.attachments).toHaveLength(0);
    expect(result.errors[0]).toContain('Failed to read file');
  });

  it('returns error for unsupported file type', async () => {
    mockReadFileMetadata.mockResolvedValue({ size: 100, isDirectory: false });

    const result = await processDroppedFiles(['/home/user/archive.zip']);

    expect(result.attachments).toHaveLength(0);
    expect(result.errors[0]).toContain('Unsupported file type');
  });

  it('returns error for oversized file', async () => {
    mockReadFileMetadata.mockResolvedValue({
      size: ATTACHMENT_LIMITS.MAX_FILE_SIZE + 1,
      isDirectory: false,
    });

    const result = await processDroppedFiles(['/home/user/big.ts']);

    expect(result.attachments).toHaveLength(0);
    expect(result.errors[0]).toContain('File too large');
  });

  it('processes multiple files in parallel', async () => {
    mockReadFileMetadata.mockResolvedValue({ size: 100, isDirectory: false });
    mockCountFileLines.mockResolvedValue(10);

    const result = await processDroppedFiles(['/a.ts', '/b.js', '/c.py']);

    expect(result.attachments).toHaveLength(3);
    expect(result.errors).toHaveLength(0);
  });

  it('handles mix of valid and invalid files', async () => {
    mockReadFileMetadata
      .mockResolvedValueOnce({ size: 100, isDirectory: false }) // valid .ts
      .mockResolvedValueOnce({ size: 100, isDirectory: false }); // .zip fails validation
    mockCountFileLines.mockResolvedValue(10);

    const result = await processDroppedFiles(['/valid.ts', '/invalid.zip']);

    expect(result.attachments).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
  });

  it('catches thrown errors gracefully', async () => {
    mockReadFileMetadata.mockRejectedValue(new Error('disk error'));

    const result = await processDroppedFiles(['/broken.ts']);

    expect(result.attachments).toHaveLength(0);
    expect(result.errors[0]).toContain('disk error');
  });

  it('does not count lines for PDF files', async () => {
    mockReadFileMetadata.mockResolvedValue({ size: 5000, isDirectory: false });

    const result = await processDroppedFiles(['/doc.pdf']);

    expect(result.attachments).toHaveLength(1);
    expect(mockCountFileLines).not.toHaveBeenCalled();
    expect(result.attachments[0].lineCount).toBeUndefined();
  });

  it('handles image without dimensions gracefully', async () => {
    mockReadFileMetadata.mockResolvedValue({ size: 2048, isDirectory: false });
    mockGetImageDimensions.mockResolvedValue(null);

    const result = await processDroppedFiles(['/photo.png']);

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].width).toBeUndefined();
    expect(result.attachments[0].height).toBeUndefined();
  });
});

// ============================================================================
// loadAttachmentContent
// ============================================================================

describe('loadAttachmentContent', () => {
  it('returns attachment as-is if base64Data already loaded', async () => {
    const att = makeAttachment({ base64Data: 'abc123', path: '/file.ts' });
    const result = await loadAttachmentContent(att);
    expect(result).toBe(att);
    expect(mockReadFileAsBase64).not.toHaveBeenCalled();
  });

  it('loads base64 content from file path', async () => {
    mockReadFileAsBase64.mockResolvedValue('ZmlsZWNvbnRlbnQ=');
    const att = makeAttachment({ path: '/file.ts' });

    const result = await loadAttachmentContent(att);

    expect(result.base64Data).toBe('ZmlsZWNvbnRlbnQ=');
    expect(mockReadFileAsBase64).toHaveBeenCalledWith('/file.ts');
  });

  it('throws if attachment has no path', async () => {
    const att = makeAttachment({ path: undefined });
    await expect(loadAttachmentContent(att)).rejects.toThrow('has no path');
  });

  it('throws if reading file content fails', async () => {
    mockReadFileAsBase64.mockResolvedValue(null);
    const att = makeAttachment({ path: '/missing.ts' });
    await expect(loadAttachmentContent(att)).rejects.toThrow('Failed to read file content');
  });
});

// ============================================================================
// loadAllAttachmentContents
// ============================================================================

describe('loadAllAttachmentContents', () => {
  it('loads content for all attachments', async () => {
    mockReadFileAsBase64.mockResolvedValue('base64data');
    const attachments = [
      makeAttachment({ path: '/a.ts' }),
      makeAttachment({ path: '/b.ts' }),
    ];

    const result = await loadAllAttachmentContents(attachments);

    expect(result).toHaveLength(2);
    expect(result[0].base64Data).toBe('base64data');
    expect(result[1].base64Data).toBe('base64data');
  });

  it('returns empty array for empty input', async () => {
    const result = await loadAllAttachmentContents([]);
    expect(result).toEqual([]);
  });
});

// ============================================================================
// getAttachmentSubtitle
// ============================================================================

describe('getAttachmentSubtitle', () => {
  it('shows dimensions for images', () => {
    const att = makeAttachment({ type: 'image', width: 1920, height: 1080 });
    expect(getAttachmentSubtitle(att)).toBe('1920\u00D71080');
  });

  it('shows line count for text files with plural', () => {
    const att = makeAttachment({ lineCount: 42 });
    expect(getAttachmentSubtitle(att)).toBe('42 lines');
  });

  it('shows line count singular for 1 line', () => {
    const att = makeAttachment({ lineCount: 1 });
    expect(getAttachmentSubtitle(att)).toBe('1 line');
  });

  it('falls back to file size when no other metadata', () => {
    const att = makeAttachment({ size: 2048 });
    expect(getAttachmentSubtitle(att)).toBe('2.0 KB');
  });

  it('falls back to file size when lineCount is 0', () => {
    const att = makeAttachment({ lineCount: 0, size: 512 });
    expect(getAttachmentSubtitle(att)).toBe('512 B');
  });

  it('prefers dimensions over lineCount for images', () => {
    const att = makeAttachment({ type: 'image', width: 100, height: 100, lineCount: 10 });
    expect(getAttachmentSubtitle(att)).toBe('100\u00D7100');
  });
});

// ============================================================================
// Constants
// ============================================================================

describe('ATTACHMENT_LIMITS', () => {
  it('has expected limits', () => {
    expect(ATTACHMENT_LIMITS.MAX_FILE_SIZE).toBe(5 * 1024 * 1024);
    expect(ATTACHMENT_LIMITS.MAX_TOTAL_SIZE).toBe(20 * 1024 * 1024);
    expect(ATTACHMENT_LIMITS.MAX_ATTACHMENTS).toBe(10);
  });
});

describe('SUPPORTED_EXTENSIONS', () => {
  it('includes all expected categories', () => {
    expect(Object.keys(SUPPORTED_EXTENSIONS)).toEqual(
      expect.arrayContaining(['image', 'text', 'code', 'config', 'shell', 'markup', 'data', 'documents'])
    );
  });

  it('includes PDF in documents', () => {
    expect(SUPPORTED_EXTENSIONS.documents).toContain('.pdf');
  });
});
