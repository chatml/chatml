'use client';

import { useCallback } from 'react';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useSettingsStore } from '@/stores/settingsStore';
import { requestNotificationPermission } from '@/lib/tauri';
import { useInstalledApps } from '@/hooks/useInstalledApps';
import { APP_REGISTRY } from '@/lib/openApps';
import { SettingsRow } from '../shared/SettingsRow';

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

      <SettingsRow
        title="Send messages with"
        description="Choose which key combination sends messages. Use Shift+Enter for new lines."
      >
        <Select
          value={sendWithEnter ? 'enter' : 'cmd-enter'}
          onValueChange={(v) => setSendWithEnter(v === 'enter')}
        >
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="enter">Enter</SelectItem>
            <SelectItem value="cmd-enter">Cmd+Enter</SelectItem>
          </SelectContent>
        </Select>
      </SettingsRow>

      <SettingsRow title="Default editor" description="App used by the toolbar Open button">
        <Select value={defaultOpenApp} onValueChange={setDefaultOpenApp}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(installedApps.length > 0 ? installedApps : APP_REGISTRY).map((app) => (
              <SelectItem key={app.id} value={app.id}>
                {app.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>

      <SettingsRow
        title="Desktop notifications"
        description="Notify when an agent finishes working"
      >
        <Switch checked={desktopNotifications} onCheckedChange={handleNotificationToggle} />
      </SettingsRow>

      <SettingsRow
        title="Sound effects"
        description="Play a sound when an agent finishes working"
      >
        <div className="flex items-center gap-2">
          <Select value={soundEffectType} onValueChange={setSoundEffectType}>
            <SelectTrigger className="w-24">
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
            onClick={() => {
              // TODO: Wire to actual sound playback
              console.log('Test sound:', soundEffectType);
            }}
          >
            Test
          </Button>
          <Switch checked={soundEffects} onCheckedChange={setSoundEffects} />
        </div>
      </SettingsRow>

      <SettingsRow
        title="Auto-convert long text"
        description="Convert pasted text over 5,000 characters into text attachments"
      >
        <Switch checked={autoConvertLongText} onCheckedChange={setAutoConvertLongText} />
      </SettingsRow>

      <SettingsRow
        title="Confirm before closing active conversations"
        description="Ask for confirmation when closing a conversation with messages"
      >
        <Switch
          checked={confirmCloseActiveTab}
          onCheckedChange={setConfirmCloseActiveTab}
        />
      </SettingsRow>

      <SettingsRow
        title="Confirm archive with uncommitted changes"
        description="Show a confirmation dialog when archiving a session that has uncommitted or unpushed changes"
      >
        <Switch
          checked={confirmArchiveDirtySession}
          onCheckedChange={setConfirmArchiveDirtySession}
        />
      </SettingsRow>
    </div>
  );
}
