'use client';

import { Switch } from '@/components/ui/switch';
import { useSettingsStore, SETTINGS_DEFAULTS } from '@/stores/settingsStore';
import { useAuthStore } from '@/stores/authStore';
import { useAppStore } from '@/stores/appStore';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { SettingsRow } from '../shared/SettingsRow';
import { SettingsGroup } from '../shared/SettingsGroup';
import { findSelectableSession, isSelectableSession } from '@/lib/sessionFilters';

function OverridableBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-2xs font-medium text-muted-foreground">
      Per-workspace
    </span>
  );
}

export function GitSettings() {
  const showBaseBranchSessions = useSettingsStore((s) => s.showBaseBranchSessions);
  const setShowBaseBranchSessions = useSettingsStore((s) => s.setShowBaseBranchSessions);
  const branchSyncBanner = useSettingsStore((s) => s.branchSyncBanner);
  const setBranchSyncBanner = useSettingsStore((s) => s.setBranchSyncBanner);
  const branchPrefixType = useSettingsStore((s) => s.branchPrefixType);
  const setBranchPrefixType = useSettingsStore((s) => s.setBranchPrefixType);
  const customPrefix = useSettingsStore((s) => s.branchPrefixCustom);
  const setCustomPrefix = useSettingsStore((s) => s.setBranchPrefixCustom);
  const deleteBranchOnArchive = useSettingsStore((s) => s.deleteBranchOnArchive);
  const setDeleteBranchOnArchive = useSettingsStore((s) => s.setDeleteBranchOnArchive);
  const archiveOnMerge = useSettingsStore((s) => s.archiveOnMerge);
  const setArchiveOnMerge = useSettingsStore((s) => s.setArchiveOnMerge);

  const user = useAuthStore((s) => s.user);
  const githubUsername = user?.login || 'username';

  // Toggle the setting and, when turning visibility off, replace any
  // currently-selected base session so the conversation pane doesn't keep
  // rendering a session the sidebar just hid.
  const handleToggleBaseBranchSessions = (value: boolean) => {
    setShowBaseBranchSessions(value);
    if (!value) {
      const app = useAppStore.getState();
      const selected = app.sessions.find((s) => s.id === app.selectedSessionId);
      if (selected && !isSelectableSession(selected, false)) {
        const fallback = findSelectableSession(app.sessions, selected.workspaceId, false);
        app.selectSession(fallback?.id ?? null);
      }
    }
  };

  return (
    <div>
      <h2 className="text-xl font-semibold mb-5">Git</h2>

      <SettingsGroup label="Sessions">
        <SettingsRow
          settingId="showBaseBranchSessions"
          title="Base branch sessions"
          description="Show a session for the base branch in the sidebar, allowing you to work directly on the main repo without a worktree"
          isModified={showBaseBranchSessions !== SETTINGS_DEFAULTS.showBaseBranchSessions}
          onReset={() => handleToggleBaseBranchSessions(SETTINGS_DEFAULTS.showBaseBranchSessions)}
        >
          <Switch
            checked={showBaseBranchSessions}
            onCheckedChange={handleToggleBaseBranchSessions}
            aria-label="Base branch sessions"
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup label="Sync">
        <SettingsRow
          settingId="branchSyncBanner"
          title="Branch sync notifications"
          description="Show a banner when your branch is behind the base branch"
          isModified={branchSyncBanner !== SETTINGS_DEFAULTS.branchSyncBanner}
          onReset={() => setBranchSyncBanner(SETTINGS_DEFAULTS.branchSyncBanner)}
        >
          <Switch
            checked={branchSyncBanner}
            onCheckedChange={setBranchSyncBanner}
            aria-label="Branch sync notifications"
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup label="Branches">
        <SettingsRow
          settingId="branchPrefixType"
          variant="stacked"
          title="Branch name prefix"
          description="Prefix for new session branch names, followed by a slash."
          badge={<OverridableBadge />}
          isModified={branchPrefixType !== SETTINGS_DEFAULTS.branchPrefixType || customPrefix !== SETTINGS_DEFAULTS.branchPrefixCustom}
          onReset={() => { setBranchPrefixType(SETTINGS_DEFAULTS.branchPrefixType); setCustomPrefix(SETTINGS_DEFAULTS.branchPrefixCustom); }}
        >
          <RadioGroup
            value={branchPrefixType}
            onValueChange={(v) => setBranchPrefixType(v as 'github' | 'custom' | 'none')}
            className="gap-2.5"
          >
            <label className="flex items-center gap-3 cursor-pointer">
              <RadioGroupItem value="github" />
              <span className="text-sm">GitHub username ({githubUsername})</span>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <RadioGroupItem value="custom" />
              <span className="text-sm">Custom</span>
            </label>

            {branchPrefixType === 'custom' && (
              <div className="ml-7">
                <input
                  type="text"
                  value={customPrefix}
                  onChange={(e) => setCustomPrefix(e.target.value)}
                  placeholder="Enter custom prefix"
                  aria-label="Custom branch prefix"
                  className="w-48 px-3 py-1.5 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            )}

            <label className="flex items-center gap-3 cursor-pointer">
              <RadioGroupItem value="none" />
              <span className="text-sm">None</span>
            </label>
          </RadioGroup>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup label="Archiving">
        <SettingsRow
          settingId="deleteBranchOnArchive"
          title="Delete branch on archive"
          isModified={deleteBranchOnArchive !== SETTINGS_DEFAULTS.deleteBranchOnArchive}
          onReset={() => setDeleteBranchOnArchive(SETTINGS_DEFAULTS.deleteBranchOnArchive)}
          description={
            <>
              Delete the local branch when archiving a session. To delete the remote branch,{' '}
              <a
                href="https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-the-automatic-deletion-of-branches"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand hover:underline"
              >
                configure it on GitHub
              </a>
              .
            </>
          }
        >
          <Switch
            checked={deleteBranchOnArchive}
            onCheckedChange={setDeleteBranchOnArchive}
            aria-label="Delete branch on archive"
          />
        </SettingsRow>

        <SettingsRow
          settingId="archiveOnMerge"
          title="Archive on merge"
          description="Automatically archive a session after merging its pull request"
          isModified={archiveOnMerge !== SETTINGS_DEFAULTS.archiveOnMerge}
          onReset={() => setArchiveOnMerge(SETTINGS_DEFAULTS.archiveOnMerge)}
        >
          <Switch
            checked={archiveOnMerge}
            onCheckedChange={setArchiveOnMerge}
            aria-label="Archive on merge"
          />
        </SettingsRow>
      </SettingsGroup>
    </div>
  );
}
