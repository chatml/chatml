'use client';

import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useSettingsStore, SETTINGS_DEFAULTS } from '@/stores/settingsStore';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';
import { SettingsRow } from '../shared/SettingsRow';
import { SettingsGroup } from '../shared/SettingsGroup';

const LIGHT_COLORS = {
  bg: 'oklch(0.98 0 0)',
  surface: 'oklch(0.94 0.01 280)',
  text: 'oklch(0.141 0.005 285.823)',
  primary: 'oklch(0.58 0.22 280)',
  border: 'oklch(0.92 0.004 286.32)',
  muted: 'oklch(0.552 0.016 285.938)',
} as const;

const DARK_COLORS = {
  bg: '#090909',
  surface: '#1a1c1d',
  text: 'oklch(0.9 0 0)',
  primary: 'oklch(0.55 0.12 280)',
  border: '#26282d',
  muted: 'oklch(0.55 0 0)',
} as const;

interface SwatchColors {
  bg: string;
  surface: string;
  text: string;
  primary: string;
  border: string;
  muted: string;
}

function SwatchMockup({ colors }: { colors: SwatchColors }) {
  return (
    <div className="flex h-full" style={{ background: colors.bg }}>
      {/* Sidebar */}
      <div
        className="w-[18px] h-full flex flex-col gap-[4px] py-[5px] px-[3px]"
        style={{ background: colors.surface, borderRight: `1px solid ${colors.border}` }}
      >
        <div className="h-[5px] rounded-sm" style={{ background: colors.muted, opacity: 0.4 }} />
        <div className="h-[5px] rounded-sm" style={{ background: colors.muted, opacity: 0.4 }} />
        <div className="h-[5px] rounded-sm" style={{ background: colors.muted, opacity: 0.4 }} />
      </div>
      {/* Content */}
      <div className="flex-1 flex flex-col gap-[4px] p-[6px]">
        <div className="h-[5px] rounded-sm w-full" style={{ background: colors.text, opacity: 0.15 }} />
        <div className="h-[5px] rounded-sm w-4/5" style={{ background: colors.text, opacity: 0.15 }} />
        <div className="h-[5px] rounded-sm w-3/5" style={{ background: colors.text, opacity: 0.15 }} />
        <div className="mt-auto self-end h-[6px] w-[6px] rounded-full" style={{ background: colors.primary }} />
      </div>
    </div>
  );
}

function ThemeSwatch({ value, label, isSelected }: { value: string; label: string; isSelected: boolean }) {
  const inputId = `theme-${value}`;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <RadioGroupItem value={value} id={inputId} className="sr-only" />
      <label
        htmlFor={inputId}
        className="cursor-pointer"
      >
        <div
          className={cn(
            'w-[100px] h-[68px] rounded-md overflow-hidden transition-all',
            isSelected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : 'ring-1 ring-border/50 hover:ring-border',
          )}
        >
          {value === 'system' ? (
            <div className="flex h-full">
              <div className="w-1/2 h-full overflow-hidden">
                <SwatchMockup colors={DARK_COLORS} />
              </div>
              <div className="w-1/2 h-full overflow-hidden" style={{ borderLeft: `1px solid ${DARK_COLORS.border}` }}>
                <SwatchMockup colors={LIGHT_COLORS} />
              </div>
            </div>
          ) : (
            <SwatchMockup colors={value === 'dark' ? DARK_COLORS : LIGHT_COLORS} />
          )}
        </div>
      </label>
      <span className={cn('text-xs', isSelected ? 'text-foreground font-medium' : 'text-muted-foreground')}>{label}</span>
    </div>
  );
}

export function AppearanceSettings() {
  const fontSize = useSettingsStore((s) => s.fontSize);
  const setFontSize = useSettingsStore((s) => s.setFontSize);
  const zenMode = useSettingsStore((s) => s.zenMode);
  const setZenMode = useSettingsStore((s) => s.setZenMode);
  const showTokenUsage = useSettingsStore((s) => s.showTokenUsage);
  const setShowTokenUsage = useSettingsStore((s) => s.setShowTokenUsage);
  const showChatCost = useSettingsStore((s) => s.showChatCost);
  const setShowChatCost = useSettingsStore((s) => s.setShowChatCost);
  const showMessageTokenCost = useSettingsStore((s) => s.showMessageTokenCost);
  const setShowMessageTokenCost = useSettingsStore((s) => s.setShowMessageTokenCost);
  const { theme, setTheme } = useTheme();

  return (
    <div>
      <h2 className="text-xl font-semibold mb-5">Appearance</h2>

      <SettingsGroup label="Theme">
        <SettingsRow
          settingId="theme"
          title="Color scheme"
          description="Choose your preferred color scheme"
          variant="stacked"
          isModified={theme !== 'system'}
          onReset={() => setTheme('system')}
        >
          <RadioGroup
            value={theme ?? 'system'}
            onValueChange={setTheme}
            className="flex gap-3"
            aria-label="Color scheme"
          >
            <ThemeSwatch value="light" label="Light" isSelected={theme === 'light'} />
            <ThemeSwatch value="dark" label="Dark" isSelected={theme === 'dark'} />
            <ThemeSwatch value="system" label="System" isSelected={theme === 'system' || !theme} />
          </RadioGroup>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup label="Typography">
        <SettingsRow
          settingId="fontSize"
          title="Font size"
          description="Adjust the interface font size"
          isModified={fontSize !== SETTINGS_DEFAULTS.fontSize}
          onReset={() => setFontSize(SETTINGS_DEFAULTS.fontSize)}
        >
          <Select value={fontSize} onValueChange={setFontSize}>
            <SelectTrigger className="w-32" aria-label="Font size">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="small">Small</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="large">Large</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup label="Layout">
        <SettingsRow
          settingId="zenMode"
          title="Zen mode"
          description="Hide sidebars for a distraction-free experience"
          isModified={zenMode !== SETTINGS_DEFAULTS.zenMode}
          onReset={() => setZenMode(SETTINGS_DEFAULTS.zenMode)}
        >
          <Switch checked={zenMode} onCheckedChange={setZenMode} aria-label="Zen mode" />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup label="Display">
        <SettingsRow
          settingId="showTokenUsage"
          title="Show token usage"
          description="Display token counts and cost breakdown in run summaries"
          isModified={showTokenUsage !== SETTINGS_DEFAULTS.showTokenUsage}
          onReset={() => setShowTokenUsage(SETTINGS_DEFAULTS.showTokenUsage)}
        >
          <Switch checked={showTokenUsage} onCheckedChange={setShowTokenUsage} aria-label="Show token usage" />
        </SettingsRow>

        <SettingsRow
          settingId="showChatCost"
          title="Show cost"
          description="Display cost in run summaries"
          isModified={showChatCost !== SETTINGS_DEFAULTS.showChatCost}
          onReset={() => setShowChatCost(SETTINGS_DEFAULTS.showChatCost)}
        >
          <Switch checked={showChatCost} onCheckedChange={setShowChatCost} aria-label="Show cost" />
        </SettingsRow>

        <SettingsRow
          settingId="showMessageTokenCost"
          title="Show per-message tokens & cost"
          description="Display a compact token count and cost line below each assistant message"
          isModified={showMessageTokenCost !== SETTINGS_DEFAULTS.showMessageTokenCost}
          onReset={() => setShowMessageTokenCost(SETTINGS_DEFAULTS.showMessageTokenCost)}
        >
          <Switch checked={showMessageTokenCost} onCheckedChange={setShowMessageTokenCost} aria-label="Show per-message tokens and cost" />
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}
