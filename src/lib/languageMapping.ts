/**
 * Shared language mapping for Monaco editor and Shiki syntax highlighting.
 * Provides consistent language detection across the codebase.
 */

interface LanguageMapping {
  monaco: string;
  shiki: string;
}

// Extension to language mapping
const extensionMap: Record<string, LanguageMapping> = {
  // JavaScript/TypeScript
  js: { monaco: 'javascript', shiki: 'javascript' },
  jsx: { monaco: 'javascript', shiki: 'jsx' },
  ts: { monaco: 'typescript', shiki: 'typescript' },
  tsx: { monaco: 'typescript', shiki: 'tsx' },
  mjs: { monaco: 'javascript', shiki: 'javascript' },
  cjs: { monaco: 'javascript', shiki: 'javascript' },
  // Web
  html: { monaco: 'html', shiki: 'html' },
  htm: { monaco: 'html', shiki: 'html' },
  css: { monaco: 'css', shiki: 'css' },
  scss: { monaco: 'scss', shiki: 'scss' },
  sass: { monaco: 'scss', shiki: 'sass' },
  less: { monaco: 'less', shiki: 'less' },
  // Data/Config
  json: { monaco: 'json', shiki: 'json' },
  yaml: { monaco: 'yaml', shiki: 'yaml' },
  yml: { monaco: 'yaml', shiki: 'yaml' },
  toml: { monaco: 'plaintext', shiki: 'toml' },
  xml: { monaco: 'xml', shiki: 'xml' },
  // Documentation
  md: { monaco: 'markdown', shiki: 'markdown' },
  mdx: { monaco: 'markdown', shiki: 'mdx' },
  // Programming languages
  go: { monaco: 'go', shiki: 'go' },
  py: { monaco: 'python', shiki: 'python' },
  rb: { monaco: 'ruby', shiki: 'ruby' },
  rs: { monaco: 'rust', shiki: 'rust' },
  java: { monaco: 'java', shiki: 'java' },
  kt: { monaco: 'kotlin', shiki: 'kotlin' },
  kts: { monaco: 'kotlin', shiki: 'kotlin' },
  swift: { monaco: 'swift', shiki: 'swift' },
  c: { monaco: 'c', shiki: 'c' },
  h: { monaco: 'c', shiki: 'c' },
  cpp: { monaco: 'cpp', shiki: 'cpp' },
  cc: { monaco: 'cpp', shiki: 'cpp' },
  hpp: { monaco: 'cpp', shiki: 'cpp' },
  cs: { monaco: 'csharp', shiki: 'csharp' },
  php: { monaco: 'php', shiki: 'php' },
  // Shell
  sh: { monaco: 'shell', shiki: 'bash' },
  bash: { monaco: 'shell', shiki: 'bash' },
  zsh: { monaco: 'shell', shiki: 'zsh' },
  ps1: { monaco: 'powershell', shiki: 'powershell' },
  // SQL
  sql: { monaco: 'sql', shiki: 'sql' },
  // Others
  graphql: { monaco: 'graphql', shiki: 'graphql' },
  gql: { monaco: 'graphql', shiki: 'graphql' },
  prisma: { monaco: 'plaintext', shiki: 'prisma' },
  env: { monaco: 'plaintext', shiki: 'dotenv' },
  lock: { monaco: 'plaintext', shiki: 'text' },
  txt: { monaco: 'plaintext', shiki: 'text' },
};

const defaultMapping: LanguageMapping = { monaco: 'plaintext', shiki: 'text' };

/**
 * Get language identifiers for a given filename.
 * @param filename - The filename to detect language for
 * @returns Object with monaco and shiki language identifiers
 */
export function getLanguageFromFilename(filename: string): LanguageMapping {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const name = filename.toLowerCase();

  // Special files
  if (name === 'dockerfile' || name.endsWith('.dockerfile')) {
    return { monaco: 'dockerfile', shiki: 'dockerfile' };
  }
  if (name === 'makefile') {
    return { monaco: 'makefile', shiki: 'makefile' };
  }
  if (name === '.gitignore' || name === '.dockerignore') {
    return { monaco: 'plaintext', shiki: 'ignore' };
  }

  return extensionMap[ext] || defaultMapping;
}

/**
 * Get Monaco editor language identifier for a filename.
 * @param filename - The filename to detect language for
 * @returns Monaco language identifier string
 */
export function getMonacoLanguage(filename: string): string {
  return getLanguageFromFilename(filename).monaco;
}

/**
 * Get Shiki syntax highlighter language identifier for a filename.
 * @param filename - The filename to detect language for
 * @returns Shiki language identifier string
 */
export function getShikiLanguage(filename: string): string {
  return getLanguageFromFilename(filename).shiki;
}
