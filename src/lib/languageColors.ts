/**
 * GitHub language colors for visual indicators.
 * Colors sourced from github-linguist.
 */

const LANGUAGE_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572A5',
  Go: '#00ADD8',
  Rust: '#dea584',
  Java: '#b07219',
  Ruby: '#701516',
  Swift: '#F05138',
  'C++': '#f34b7d',
  C: '#555555',
  'C#': '#178600',
  'Objective-C': '#438eff',
  Shell: '#89e051',
  Kotlin: '#A97BFF',
  Lua: '#000080',
  PHP: '#4F5D95',
  HTML: '#e34c26',
  CSS: '#563d7c',
  SCSS: '#c6538c',
  Dart: '#00B4AB',
  Scala: '#c22d40',
  Haskell: '#5e5086',
  Elixir: '#6e4a7e',
  Clojure: '#db5855',
  R: '#198CE7',
  Julia: '#a270ba',
  Zig: '#ec915c',
  Vue: '#41b883',
  Svelte: '#ff3e00',
  MDX: '#fcb32c',
  Dockerfile: '#384d54',
  Makefile: '#427819',
  Nix: '#7e7eff',
  OCaml: '#3be133',
  VimScript: '#199f4b',
  LaTeX: '#3D6117',
  HCL: '#844fba',
  Groovy: '#4298b8',
  PowerShell: '#012456',
  Perl: '#0298c3',
};

export function getLanguageColor(language: string): string {
  return LANGUAGE_COLORS[language] ?? '#8b8b8b';
}
