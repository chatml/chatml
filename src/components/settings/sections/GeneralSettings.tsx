'use client';

import { useCallback } from 'react';
import Image from 'next/image';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useSettingsStore, SETTINGS_DEFAULTS } from '@/stores/settingsStore';
import { requestNotificationPermission } from '@/lib/tauri';
import { playSound } from '@/lib/sounds';
import { useInstalledApps } from '@/hooks/useInstalledApps';
import { APP_REGISTRY } from '@/lib/openApps';
import { getAppIcon } from '@/components/icons/AppIcons';
import { SettingsRow } from '../shared/SettingsRow';
import { SettingsGroup } from '../shared/SettingsGroup';

export function GeneralSettings() {
  const confirmCloseActiveTab = useSettingsStore((s) => s.confirmCloseActiveTab);
  const setConfirmCloseActiveTab = useSettingsStore((s) => s.setConfirmCloseActiveTab);
  const confirmArchiveDirtySession = useSettingsStore((s) => s.confirmArchiveDirtySession);
  const setConfirmArchiveDirtySession = useSettingsStore((s) => s.setConfirmArchiveDirtySession);
  const desktopNotifications = useSettingsStore((s) => s.desktopNotifications);
  const setDesktopNotifications = useSettingsStore((s) => s.setDesktopNotifications);
  const soundEffects = useSettingsStore((s) => s.soundEffects);
  const setSoundEffects = useSettingsStore((s) => s.setSoundEffects);
  const soundEffectType = useSettingsStore((s) => s.soundEffectType);
  const setSoundEffectType = useSettingsStore((s) => s.setSoundEffectType);
  const sendWithEnter = useSettingsStore((s) => s.sendWithEnter);
  const setSendWithEnter = useSettingsStore((s) => s.setSendWithEnter);
  const autoConvertLongText = useSettingsStore((s) => s.autoConvertLongText);
  const setAutoConvertLongText = useSettingsStore((s) => s.setAutoConvertLongText);
  const suggestionsEnabled = useSettingsStore((s) => s.suggestionsEnabled);
  const setSuggestionsEnabled = useSettingsStore((s) => s.setSuggestionsEnabled);
  const autoSubmitPillSuggestion = useSettingsStore((s) => s.autoSubmitPillSuggestion);
  const setAutoSubmitPillSuggestion = useSettingsStore((s) => s.setAutoSubmitPillSuggestion);
  const defaultOpenApp = useSettingsStore((s) => s.defaultOpenApp);
  const setDefaultOpenApp = useSettingsStore((s) => s.setDefaultOpenApp);
  const { installedApps } = useInstalledApps();

  const handleNotificationToggle = useCallback(async (enabled: boolean) => {
    if (enabled) {
      const perm = await requestNotificationPermission();
      if (perm !== 'granted') return;
    }
    setDesktopNotifications(enabled);
  }, [setDesktopNotifications]);

  return (
    <div>
      <h2 className="text-xl font-semibold mb-5">General</h2>

      <SettingsGroup label="Input & Chat">
        <SettingsRow
          settingId="sendWithEnter"
          title="Send messages with"
          description="Choose which key combination sends messages. Use Shift+Enter for new lines."
          isModified={sendWithEnter !== SETTINGS_DEFAULTS.sendWithEnter}
          onReset={() => setSendWithEnter(SETTINGS_DEFAULTS.sendWithEnter)}
        >
          <Select
            value={sendWithEnter ? 'enter' : 'cmd-enter'}
            onValueChange={(v) => setSendWithEnter(v === 'enter')}
          >
            <SelectTrigger className="w-28" aria-label="Send messages with">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="enter">Enter</SelectItem>
              <SelectItem value="cmd-enter">Cmd+Enter</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>

        <SettingsRow
          settingId="suggestionsEnabled"
          title="Input suggestions"
          description="Show AI-suggested prompts after each assistant turn"
          isModified={suggestionsEnabled !== SETTINGS_DEFAULTS.suggestionsEnabled}
          onReset={() => setSuggestionsEnabled(SETTINGS_DEFAULTS.suggestionsEnabled)}
        >
          <Switch checked={suggestionsEnabled} onCheckedChange={setSuggestionsEnabled} aria-label="Input suggestions" />
        </SettingsRow>

        <SettingsRow
          settingId="autoSubmitPillSuggestion"
          title="Auto-submit pill suggestions"
          description="Automatically send the message when clicking a suggestion pill"
          isModified={autoSubmitPillSuggestion !== SETTINGS_DEFAULTS.autoSubmitPillSuggestion}
          onReset={() => setAutoSubmitPillSuggestion(SETTINGS_DEFAULTS.autoSubmitPillSuggestion)}
        >
          <Switch checked={autoSubmitPillSuggestion} onCheckedChange={setAutoSubmitPillSuggestion} aria-label="Auto-submit pill suggestions" />
        </SettingsRow>

        <SettingsRow
          settingId="autoConvertLongText"
          title="Auto-convert long text"
          description="Convert pasted text over 5,000 characters into text attachments"
          isModified={autoConvertLongText !== SETTINGS_DEFAULTS.autoConvertLongText}
          onReset={() => setAutoConvertLongText(SETTINGS_DEFAULTS.autoConvertLongText)}
        >
          <Switch checked={autoConvertLongText} onCheckedChange={setAutoConvertLongText} aria-label="Auto-convert long text" />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup label="Editor">
        <SettingsRow
          settingId="defaultOpenApp"
          title="Default editor"
          description="App used by the toolbar Open button"
          isModified={defaultOpenApp !== SETTINGS_DEFAULTS.defaultOpenApp}
          onReset={() => setDefaultOpenApp(SETTINGS_DEFAULTS.defaultOpenApp)}
        >
          <Select value={defaultOpenApp} onValueChange={setDefaultOpenApp}>
            <SelectTrigger className="w-44" aria-label="Default editor">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(installedApps.length > 0 ? installedApps : APP_REGISTRY)
                .filter((app) => app.category === 'editor')
                .map((app) => {
                  const FallbackIcon = getAppIcon(app.id, app.category);
                  const installedApp = installedApps.find((a) => a.id === app.id);
                  return (
                    <SelectItem key={app.id} value={app.id}>
                      <div className="flex items-center gap-2">
                        {installedApp?.iconBase64 ? (
                          <Image src={`data:image/png;base64,${installedApp.iconBase64}`} className="h-4 w-4 shrink-0" alt="" aria-hidden="true" width={16} height={16} unoptimized />
                        ) : (
                          <FallbackIcon className="h-4 w-4 shrink-0" />
                        )}
                        {app.name}
                      </div>
                    </SelectItem>
                  );
                })}
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup label="Notifications">
        <SettingsRow
          settingId="desktopNotifications"
          title="Desktop notifications"
          description="Notify when an agent finishes working"
          isModified={desktopNotifications !== SETTINGS_DEFAULTS.desktopNotifications}
          onReset={() => setDesktopNotifications(SETTINGS_DEFAULTS.desktopNotifications)}
        >
          <Switch checked={desktopNotifications} onCheckedChange={handleNotificationToggle} aria-label="Desktop notifications" />
        </SettingsRow>

        <SettingsRow
          settingId="soundEffects"
          title="Sound effects"
          description="Play a sound when an agent finishes working"
          isModified={soundEffects !== SETTINGS_DEFAULTS.soundEffects || soundEffectType !== SETTINGS_DEFAULTS.soundEffectType}
          onReset={() => { setSoundEffects(SETTINGS_DEFAULTS.soundEffects); setSoundEffectType(SETTINGS_DEFAULTS.soundEffectType); }}
        >
          <div className="flex items-center gap-2">
            <Select value={soundEffectType} onValueChange={setSoundEffectType}>
              <SelectTrigger className="w-24" aria-label="Sound effect type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="chime">Chime</SelectItem>
                <SelectItem value="ding">Ding</SelectItem>
                <SelectItem value="pop">Pop</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => playSound(soundEffectType)}
            >
              Test
            </Button>
            <Switch checked={soundEffects} onCheckedChange={setSoundEffects} aria-label="Sound effects" />
          </div>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup label="Confirmations">
        <SettingsRow
          settingId="confirmCloseActiveTab"
          title="Confirm before closing active conversations"
          description="Ask for confirmation when closing a conversation with messages"
          isModified={confirmCloseActiveTab !== SETTINGS_DEFAULTS.confirmCloseActiveTab}
          onReset={() => setConfirmCloseActiveTab(SETTINGS_DEFAULTS.confirmCloseActiveTab)}
        >
          <Switch
            checked={confirmCloseActiveTab}
            onCheckedChange={setConfirmCloseActiveTab}
            aria-label="Confirm before closing active conversations"
          />
        </SettingsRow>

        <SettingsRow
          settingId="confirmArchiveDirtySession"
          title="Confirm archive with uncommitted changes"
          description="Show a confirmation dialog when archiving a session that has uncommitted or unpushed changes"
          isModified={confirmArchiveDirtySession !== SETTINGS_DEFAULTS.confirmArchiveDirtySession}
          onReset={() => setConfirmArchiveDirtySession(SETTINGS_DEFAULTS.confirmArchiveDirtySession)}
        >
          <Switch
            checked={confirmArchiveDirtySession}
            onCheckedChange={setConfirmArchiveDirtySession}
            aria-label="Confirm archive with uncommitted changes"
          />
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}
