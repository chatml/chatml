/**
 * ThemeScript - Prevents flash of wrong theme on app startup
 *
 * This component renders an inline script that runs synchronously in the <head>
 * before CSS is parsed. It reads the theme preference from localStorage and
 * immediately applies the correct class and background color to prevent any
 * visible flash.
 */
export function ThemeScript() {
  const script = `
(function() {
  // Must match next-themes storageKey (default: 'theme')
  var STORAGE_KEY = 'theme';
  // Must match globals.css: .dark --background and light theme --background
  var DARK_BG = '#141414';
  var LIGHT_BG = '#ffffff';

  function getTheme() {
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'dark') return 'dark';
      if (stored === 'light') return 'light';
    } catch (e) {}
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  var theme = getTheme();
  var html = document.documentElement;

  if (theme === 'dark') {
    html.classList.add('dark');
    html.style.backgroundColor = DARK_BG;
  } else {
    html.classList.remove('dark');
    html.style.backgroundColor = LIGHT_BG;
  }
})();
`;

  return (
    <script
      dangerouslySetInnerHTML={{ __html: script }}
    />
  );
}
