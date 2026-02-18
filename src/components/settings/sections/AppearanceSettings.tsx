'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTheme } from 'next-themes';
import { SettingsRow } from '../shared/SettingsRow';

export function AppearanceSettings() {
  const fontSize = useSettingsStore((s) => s.fontSize);
  const setFontSize = useSettingsStore((s) => s.setFontSize);
  const { theme, setTheme } = useTheme();

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
