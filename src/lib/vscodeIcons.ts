/**
 * Maps filenames to VS Code icon names from @iconify-json/vscode-icons
 * Icon names follow the pattern: vscode-icons:file-type-{type} or vscode-icons:folder-type-{type}
 *
 * @sideeffect Importing this module registers the vscode-icons collection via
 * addCollection() at load time, so it should only be imported where icons are
 * actually rendered.
 */

import { addCollection } from '@iconify/react';
import vscodeIconsData from '@iconify-json/vscode-icons/icons.json';

// File extension to icon mapping
const FILE_EXTENSION_ICONS: Record<string, string> = {
  // JavaScript/TypeScript
  js: 'file-type-js-official',
  mjs: 'file-type-js-official',
  cjs: 'file-type-js-official',
  jsx: 'file-type-reactjs',
  ts: 'file-type-typescript-official',
  tsx: 'file-type-reactts',
  'd.ts': 'file-type-typescriptdef-official',

  // Web
  html: 'file-type-html',
  htm: 'file-type-html',
  css: 'file-type-css',
  scss: 'file-type-scss',
  sass: 'file-type-sass',
  less: 'file-type-less',
  stylus: 'file-type-stylus',

  // Data/Config
  json: 'file-type-json',
  json5: 'file-type-json5',
  yaml: 'file-type-yaml',
  yml: 'file-type-yaml',
  toml: 'file-type-toml',
  xml: 'file-type-xml',
  csv: 'file-type-csv',

  // Documentation
  md: 'file-type-markdown',
  mdx: 'file-type-mdx',
  txt: 'file-type-text',
  pdf: 'file-type-pdf',
  doc: 'file-type-word',
  docx: 'file-type-word',

  // Programming languages
  go: 'file-type-go',
  py: 'file-type-python',
  rb: 'file-type-ruby',
  rs: 'file-type-rust',
  java: 'file-type-java',
  kt: 'file-type-kotlin',
  kts: 'file-type-kotlin',
  swift: 'file-type-swift',
  c: 'file-type-c',
  h: 'file-type-cheader',
  cpp: 'file-type-cpp',
  cc: 'file-type-cpp',
  cxx: 'file-type-cpp',
  hpp: 'file-type-cppheader',
  cs: 'file-type-csharp',
  php: 'file-type-php',
  lua: 'file-type-lua',
  r: 'file-type-r',
  scala: 'file-type-scala',
  clj: 'file-type-clojure',
  ex: 'file-type-elixir',
  exs: 'file-type-elixir',
  erl: 'file-type-erlang',
  hs: 'file-type-haskell',
  pl: 'file-type-perl',
  pm: 'file-type-perl',
  dart: 'file-type-dart',
  zig: 'file-type-zig',
  nim: 'file-type-nim',
  v: 'file-type-vlang',
  asm: 'file-type-assembly',
  s: 'file-type-assembly',

  // Shell
  sh: 'file-type-shell',
  bash: 'file-type-shell',
  zsh: 'file-type-shell',
  fish: 'file-type-shell',
  ps1: 'file-type-powershell',
  psm1: 'file-type-powershell',
  bat: 'file-type-bat',
  cmd: 'file-type-bat',

  // Database
  sql: 'file-type-sql',
  prisma: 'file-type-prisma',
  graphql: 'file-type-graphql',
  gql: 'file-type-graphql',

  // Images
  png: 'file-type-image',
  jpg: 'file-type-image',
  jpeg: 'file-type-image',
  gif: 'file-type-image',
  webp: 'file-type-image',
  ico: 'file-type-image',
  svg: 'file-type-svg',
  bmp: 'file-type-image',
  avif: 'file-type-image',

  // Fonts
  ttf: 'file-type-font',
  otf: 'file-type-font',
  woff: 'file-type-font',
  woff2: 'file-type-font',
  eot: 'file-type-font',

  // Audio/Video
  mp3: 'file-type-audio',
  wav: 'file-type-audio',
  ogg: 'file-type-audio',
  flac: 'file-type-audio',
  mp4: 'file-type-video',
  webm: 'file-type-video',
  mov: 'file-type-video',
  avi: 'file-type-video',

  // Archives
  zip: 'file-type-zip',
  tar: 'file-type-zip',
  gz: 'file-type-zip',
  rar: 'file-type-zip',
  '7z': 'file-type-zip',

  // Config files
  env: 'file-type-dotenv',
  ini: 'file-type-ini',
  conf: 'file-type-config',
  config: 'file-type-config',
  lock: 'file-type-lock',

  // Build tools
  gradle: 'file-type-gradle',
  maven: 'file-type-maven',
  cmake: 'file-type-cmake',

  // Templates
  ejs: 'file-type-ejs',
  pug: 'file-type-pug',
  jade: 'file-type-jade',
  hbs: 'file-type-handlebars',
  handlebars: 'file-type-handlebars',
  mustache: 'file-type-mustache',
  twig: 'file-type-twig',
  njk: 'file-type-nunjucks',
  vue: 'file-type-vue',
  svelte: 'file-type-svelte',
  astro: 'file-type-astro',

  // Binary/Executable
  exe: 'file-type-binary',
  dll: 'file-type-binary',
  so: 'file-type-binary',
  dylib: 'file-type-binary',
  wasm: 'file-type-wasm',

  // Misc
  log: 'file-type-log',
  diff: 'file-type-diff',
  patch: 'file-type-diff',
};

// Special filename mappings (exact match)
const SPECIAL_FILE_ICONS: Record<string, string> = {
  // Git
  '.gitignore': 'file-type-git',
  '.gitattributes': 'file-type-git',
  '.gitmodules': 'file-type-git',
  '.gitkeep': 'file-type-git',

  // Docker
  dockerfile: 'file-type-docker',
  'dockerfile.dev': 'file-type-docker',
  'dockerfile.prod': 'file-type-docker',
  '.dockerignore': 'file-type-docker',
  'docker-compose.yml': 'file-type-docker',
  'docker-compose.yaml': 'file-type-docker',
  'compose.yml': 'file-type-docker',
  'compose.yaml': 'file-type-docker',

  // Package managers
  'package.json': 'file-type-npm',
  'package-lock.json': 'file-type-npm',
  'yarn.lock': 'file-type-yarn',
  '.yarnrc': 'file-type-yarn',
  '.yarnrc.yml': 'file-type-yarn',
  'pnpm-lock.yaml': 'file-type-pnpm',
  'pnpm-workspace.yaml': 'file-type-pnpm',
  'bun.lockb': 'file-type-bun',
  'bunfig.toml': 'file-type-bun',

  // Config files
  '.env': 'file-type-dotenv',
  '.env.local': 'file-type-dotenv',
  '.env.development': 'file-type-dotenv',
  '.env.production': 'file-type-dotenv',
  '.env.example': 'file-type-dotenv',
  '.env.template': 'file-type-dotenv',
  '.editorconfig': 'file-type-editorconfig',
  '.prettierrc': 'file-type-prettier',
  '.prettierrc.json': 'file-type-prettier',
  '.prettierrc.js': 'file-type-prettier',
  '.prettierrc.cjs': 'file-type-prettier',
  'prettier.config.js': 'file-type-prettier',
  'prettier.config.cjs': 'file-type-prettier',
  '.prettierignore': 'file-type-prettier',
  '.eslintrc': 'file-type-eslint',
  '.eslintrc.json': 'file-type-eslint',
  '.eslintrc.js': 'file-type-eslint',
  '.eslintrc.cjs': 'file-type-eslint',
  'eslint.config.js': 'file-type-eslint',
  'eslint.config.mjs': 'file-type-eslint',
  '.eslintignore': 'file-type-eslint',

  // TypeScript config
  'tsconfig.json': 'file-type-tsconfig',
  'tsconfig.base.json': 'file-type-tsconfig',
  'tsconfig.build.json': 'file-type-tsconfig',
  'tsconfig.node.json': 'file-type-tsconfig',

  // Build tools
  makefile: 'file-type-makefile',
  'Makefile': 'file-type-makefile',
  'CMakeLists.txt': 'file-type-cmake',
  'Cargo.toml': 'file-type-cargo',
  'Cargo.lock': 'file-type-cargo',
  'go.mod': 'file-type-go-mod',
  'go.sum': 'file-type-go-mod',
  'Gemfile': 'file-type-ruby',
  'Gemfile.lock': 'file-type-ruby',
  'requirements.txt': 'file-type-pip',
  'setup.py': 'file-type-python',
  'pyproject.toml': 'file-type-python',
  'Pipfile': 'file-type-python',
  'Pipfile.lock': 'file-type-python',
  'poetry.lock': 'file-type-poetry',

  // Framework configs
  'next.config.js': 'file-type-next',
  'next.config.mjs': 'file-type-next',
  'next.config.ts': 'file-type-next',
  'nuxt.config.js': 'file-type-nuxt',
  'nuxt.config.ts': 'file-type-nuxt',
  'vite.config.js': 'file-type-vite',
  'vite.config.ts': 'file-type-vite',
  'webpack.config.js': 'file-type-webpack',
  'webpack.config.ts': 'file-type-webpack',
  'rollup.config.js': 'file-type-rollup',
  'rollup.config.ts': 'file-type-rollup',
  'tailwind.config.js': 'file-type-tailwind',
  'tailwind.config.ts': 'file-type-tailwind',
  'postcss.config.js': 'file-type-postcss',
  'postcss.config.cjs': 'file-type-postcss',
  'babel.config.js': 'file-type-babel',
  '.babelrc': 'file-type-babel',
  'jest.config.js': 'file-type-jest',
  'jest.config.ts': 'file-type-jest',
  'vitest.config.ts': 'file-type-vitest',
  'vitest.config.js': 'file-type-vitest',
  'playwright.config.ts': 'file-type-playwright',
  'cypress.config.js': 'file-type-cypress',
  'cypress.config.ts': 'file-type-cypress',

  // Docs
  'readme.md': 'file-type-markdown',
  'README.md': 'file-type-markdown',
  'README': 'file-type-markdown',
  'license': 'file-type-license',
  'LICENSE': 'file-type-license',
  'license.md': 'file-type-license',
  'LICENSE.md': 'file-type-license',
  'changelog.md': 'file-type-changelog',
  'CHANGELOG.md': 'file-type-changelog',
  'contributing.md': 'file-type-contributing',
  'CONTRIBUTING.md': 'file-type-contributing',

  // CI/CD
  '.travis.yml': 'file-type-travis',
  '.gitlab-ci.yml': 'file-type-gitlab',
  'Jenkinsfile': 'file-type-jenkins',
  'azure-pipelines.yml': 'file-type-azure',

  // Tauri
  'tauri.conf.json': 'file-type-tauri',
};

// Folder name to icon mapping
const FOLDER_ICONS: Record<string, string> = {
  src: 'folder-type-src',
  source: 'folder-type-src',
  lib: 'folder-type-library',
  libs: 'folder-type-library',
  node_modules: 'folder-type-node',
  dist: 'folder-type-dist',
  build: 'folder-type-dist',
  out: 'folder-type-dist',
  output: 'folder-type-dist',
  public: 'folder-type-public',
  static: 'folder-type-public',
  assets: 'folder-type-asset',
  images: 'folder-type-images',
  img: 'folder-type-images',
  icons: 'folder-type-images',
  styles: 'folder-type-css',
  css: 'folder-type-css',
  components: 'folder-type-component',
  pages: 'folder-type-view',
  views: 'folder-type-view',
  hooks: 'folder-type-hook',
  utils: 'folder-type-helper',
  helpers: 'folder-type-helper',
  types: 'folder-type-typescript',
  typings: 'folder-type-typescript',
  config: 'folder-type-config',
  configs: 'folder-type-config',
  tests: 'folder-type-test',
  test: 'folder-type-test',
  __tests__: 'folder-type-test',
  spec: 'folder-type-test',
  specs: 'folder-type-test',
  docs: 'folder-type-docs',
  documentation: 'folder-type-docs',
  api: 'folder-type-api',
  routes: 'folder-type-route',
  store: 'folder-type-redux-store',
  stores: 'folder-type-redux-store',
  state: 'folder-type-redux-store',
  services: 'folder-type-controller',
  controllers: 'folder-type-controller',
  models: 'folder-type-model',
  schemas: 'folder-type-model',
  locales: 'folder-type-locale',
  i18n: 'folder-type-locale',
  translations: 'folder-type-locale',
  scripts: 'folder-type-script',
  bin: 'folder-type-script',
  '.git': 'folder-type-git',
  '.github': 'folder-type-github',
  '.vscode': 'folder-type-vscode',
  '.idea': 'folder-type-idea',
  android: 'folder-type-android',
  ios: 'folder-type-ios',
  'src-tauri': 'folder-type-src',
};

// Register only the icon subset we actually reference (instead of all ~1,475).
// Collect every icon name from the three mappings above, plus defaults and
// opened variants for folders.
const _usedIcons = new Set<string>();
for (const name of Object.values(FILE_EXTENSION_ICONS)) _usedIcons.add(name);
for (const name of Object.values(SPECIAL_FILE_ICONS)) _usedIcons.add(name);
for (const name of Object.values(FOLDER_ICONS)) {
  _usedIcons.add(name);
  _usedIcons.add(`${name}-opened`);
}
_usedIcons.add('default-file');
_usedIcons.add('default-folder');
_usedIcons.add('default-folder-opened');

addCollection({
  ...vscodeIconsData,
  icons: Object.fromEntries(
    Object.entries(vscodeIconsData.icons).filter(([name]) => _usedIcons.has(name)),
  ),
});

/**
 * Get the VS Code icon name for a file
 */
export function getFileIcon(filename: string): string {
  const name = filename.toLowerCase();

  // Check special filenames first (exact match)
  if (SPECIAL_FILE_ICONS[name]) {
    return SPECIAL_FILE_ICONS[name];
  }
  if (SPECIAL_FILE_ICONS[filename]) {
    return SPECIAL_FILE_ICONS[filename];
  }

  // Check for .d.ts files
  if (name.endsWith('.d.ts')) {
    return FILE_EXTENSION_ICONS['d.ts'];
  }

  // Get extension
  const ext = name.split('.').pop() || '';

  // Check extension mapping
  if (FILE_EXTENSION_ICONS[ext]) {
    return FILE_EXTENSION_ICONS[ext];
  }

  // Default file icon
  return 'default-file';
}

/**
 * Get the VS Code icon name for a folder
 */
export function getFolderIcon(folderName: string, isOpen: boolean = false): string {
  const name = folderName.toLowerCase();
  const baseIcon = FOLDER_ICONS[name];

  if (baseIcon) {
    return isOpen ? `${baseIcon}-opened` : baseIcon;
  }

  // Default folder icon
  return isOpen ? 'default-folder-opened' : 'default-folder';
}

/**
 * Get the full iconify icon name with the vscode-icons prefix
 */
export function getIconifyName(iconName: string): string {
  return `vscode-icons:${iconName}`;
}

/**
 * Get all unique folder icons (both closed and opened variants) for preloading
 */
function getAllFolderIcons(): string[] {
  const icons: string[] = [
    // Default folder icons
    'vscode-icons:default-folder',
    'vscode-icons:default-folder-opened',
  ];

  // Add all mapped folder icons with their opened variants
  const uniqueIcons = new Set(Object.values(FOLDER_ICONS));
  uniqueIcons.forEach((icon) => {
    icons.push(`vscode-icons:${icon}`);
    icons.push(`vscode-icons:${icon}-opened`);
  });

  return icons;
}

/**
 * Preload folder icons to prevent flicker when expanding folders.
 * Call this once when the app initializes.
 */
export async function preloadFolderIcons(): Promise<void> {
  // Dynamic import to avoid SSR issues
  const { loadIcons } = await import('@iconify/react');
  const icons = getAllFolderIcons();

  return new Promise((resolve) => {
    loadIcons(icons, () => {
      resolve();
    });
  });
}
