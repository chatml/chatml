/**
 * Language mapping for Shiki syntax highlighting.
 * Provides consistent language detection across the codebase.
 */

// Extension to Shiki language mapping
const extensionMap: Record<string, string> = {
  // JavaScript/TypeScript
  js: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  mjs: 'javascript',
  cjs: 'javascript',
  // Web
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  // Data/Config
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  // Documentation
  md: 'markdown',
  mdx: 'markdown',
  // Programming languages
  go: 'go',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  // Shell
  sh: 'bash',
  bash: 'bash',
  zsh: 'zsh',
  ps1: 'powershell',
  // SQL
  sql: 'sql',
  // Others
  graphql: 'graphql',
  gql: 'graphql',
  prisma: 'prisma',
  env: 'dotenv',
  lock: 'text',
  txt: 'text',
};

/**
 * Get Shiki syntax highlighter language identifier for a filename.
 * @param filename - The filename to detect language for
 * @returns Shiki language identifier string
 */
export function getShikiLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const name = filename.toLowerCase();

  // Special files
  if (name === 'dockerfile' || name.endsWith('.dockerfile')) {
    return 'dockerfile';
  }
  if (name === 'makefile') {
    return 'makefile';
  }
  if (name === '.gitignore' || name === '.dockerignore') {
    return 'ignore';
  }

  return extensionMap[ext] || 'text';
}
