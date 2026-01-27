/**
 * Utilities for rendering GitHub label colors that work well on both light and dark themes.
 */

/**
 * Parse a hex color string to RGB values
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  // Remove # if present
  hex = hex.replace(/^#/, '');

  // Handle 3-character hex
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }

  const num = parseInt(hex, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

/**
 * Convert RGB to HSL
 */
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
}

/**
 * Calculate relative luminance of a color (0-1)
 * Used to determine if a color is "light" or "dark"
 */
function getLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Check if a color is considered "light" (luminance > 0.5)
 */
function isLightColor(hex: string): boolean {
  const { r, g, b } = hexToRgb(hex);
  return getLuminance(r, g, b) > 0.5;
}

/**
 * Adjust a color's lightness for better visibility
 */
function adjustColorForTheme(hex: string, isDark: boolean): string {
  const { r, g, b } = hexToRgb(hex);
  const { h, s, l } = rgbToHsl(r, g, b);

  let newL = l;

  if (isDark) {
    // For dark theme: ensure minimum lightness of 55% for readability
    // but cap at 80% to avoid washing out
    if (l < 55) {
      newL = 55 + (l / 55) * 10; // Scale up dark colors
    } else if (l > 80) {
      newL = 80;
    }
  } else {
    // For light theme: ensure maximum lightness of 45% for readability
    // but keep minimum at 20% to avoid being too dark
    if (l > 45) {
      newL = 45 - ((l - 45) / 55) * 10; // Scale down light colors
    } else if (l < 20) {
      newL = 20;
    }
  }

  return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(newL)}%)`;
}

export interface LabelColorStyles {
  backgroundColor: string;
  color: string;
  borderColor: string;
}

/**
 * Get CSS styles for a GitHub label that work well on both light and dark themes.
 *
 * @param labelColor - The hex color from GitHub (without #)
 * @param isDark - Whether the current theme is dark
 * @returns CSS styles object for the label
 */
export function getLabelStyles(labelColor: string, isDark: boolean): LabelColorStyles {
  const hex = labelColor.replace(/^#/, '');
  const { r, g, b } = hexToRgb(hex);

  // Adjust text color based on theme
  const textColor = adjustColorForTheme(hex, isDark);

  // Background: very subtle, using the original color
  // Use lower opacity on dark theme to avoid overwhelming the card
  const bgOpacity = isDark ? 0.15 : 0.12;
  const backgroundColor = `rgba(${r}, ${g}, ${b}, ${bgOpacity})`;

  // Border: slightly more visible than background
  const borderOpacity = isDark ? 0.35 : 0.30;
  const borderColor = `rgba(${r}, ${g}, ${b}, ${borderOpacity})`;

  return {
    backgroundColor,
    color: textColor,
    borderColor,
  };
}
