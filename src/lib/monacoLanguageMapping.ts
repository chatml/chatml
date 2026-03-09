/**
 * Language mapping for Monaco Editor.
 * Monaco uses different identifiers than Shiki in some cases.
 */

const extensionMap: Record<string, string> = {
  // JavaScript/TypeScript
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  // Web
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  // Data/Config
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'plaintext',
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
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  // Shell
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  ps1: 'powershell',
  // SQL
  sql: 'sql',
  // Others
  graphql: 'graphql',
  gql: 'graphql',
  dockerfile: 'dockerfile',
  // Fallback
  txt: 'plaintext',
  lock: 'plaintext',
};

/**
 * Get Monaco Editor language identifier for a filename.
 */
export function getMonacoLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const name = filename.toLowerCase();

  if (name === 'dockerfile' || name.endsWith('.dockerfile')) {
    return 'dockerfile';
  }
  if (name === 'makefile') {
    return 'plaintext';
  }

  return extensionMap[ext] || 'plaintext';
}
