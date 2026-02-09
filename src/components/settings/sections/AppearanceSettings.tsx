'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSettingsStore } from '@/stores/settingsStore';
import { EDITOR_THEMES } from '@/lib/monacoThemes';
import { useTheme } from 'next-themes';
import { SettingsRow } from '../shared/SettingsRow';

export function AppearanceSettings() {
  const editorTheme = useSettingsStore((s) => s.editorTheme);
  const setEditorTheme = useSettingsStore((s) => s.setEditorTheme);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const setFontSize = useSettingsStore((s) => s.setFontSize);
  const { theme, setTheme } = useTheme();

  const darkThemes = EDITOR_THEMES.filter((t) => t.isDark);
  const lightThemes = EDITOR_THEMES.filter((t) => !t.isDark);

  return (
    <div>
      <h2 className="text-xl font-semibold mb-5">Appearance</h2>
      <SettingsRow title="Theme" description="Choose your preferred color scheme">
        <Select value={theme} onValueChange={setTheme}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="system">System</SelectItem>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
          </SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow title="Editor theme" description="Syntax highlighting theme for code blocks">
        <Select value={editorTheme} onValueChange={setEditorTheme}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Dark</div>
            {darkThemes.map((theme) => (
              <SelectItem key={theme.id} value={theme.id}>
                {theme.name}
              </SelectItem>
            ))}
            <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground border-t mt-1 pt-2">Light</div>
            {lightThemes.map((theme) => (
              <SelectItem key={theme.id} value={theme.id}>
                {theme.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>
      <SettingsRow title="Font size" description="Adjust the interface font size">
        <Select value={fontSize} onValueChange={setFontSize}>
          <SelectTrigger className="w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="small">Small</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="large">Large</SelectItem>
          </SelectContent>
        </Select>
      </SettingsRow>
    </div>
  );
}
