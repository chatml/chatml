/**
 * ThemeScript - Prevents flash of wrong theme on app startup
 *
 * This component renders an inline script that runs synchronously in the <head>
 * before the body is parsed. It reads the theme preference and immediately
 * applies the correct class and background color.
 */
export function ThemeScript() {
  // Critical CSS: default to dark background (matches Tauri window)
  // NO light mode fallback here - we handle that in the script
  // This ensures dark bg is shown until JS determines actual theme
  const criticalCSS = `
    html, body { background-color: #0f1111 !important; }
  `;

  const script = `
(function() {
  var STORAGE_KEY = 'theme';
  var DARK_BG = '#0f1111';
  var LIGHT_BG = '#ffffff';

  function getTheme() {
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'dark') return 'dark';
      if (stored === 'light') return 'light';
    } catch (e) {}
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  // Suppress benign ResizeObserver loop error before MCP bridge catches it
  window.addEventListener('error', function(e) {
    if (e.message && e.message.indexOf('ResizeObserver loop') !== -1) {
      e.stopImmediatePropagation();
    }
  });

  var theme = getTheme();
  var html = document.documentElement;
  var bg = theme === 'dark' ? DARK_BG : LIGHT_BG;

  // Set class and inline style on html
  if (theme === 'dark') {
    html.classList.add('dark');
  } else {
    html.classList.remove('dark');
  }
  html.style.backgroundColor = bg;

  // Also inject a style tag for body since body doesn't exist yet
  var style = document.createElement('style');
  style.textContent = 'body { background-color: ' + bg + ' !important; }';
  document.head.appendChild(style);
})();
`;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: criticalCSS }} />
      <script dangerouslySetInnerHTML={{ __html: script }} />
    </>
  );
}
