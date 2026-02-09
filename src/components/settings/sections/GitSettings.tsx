'use client';

import { Switch } from '@/components/ui/switch';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAuthStore } from '@/stores/authStore';

export function GitSettings() {
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

  return (
    <div>
      <h2 className="text-xl font-semibold mb-5">Git</h2>

      {/* Branch name prefix */}
      <div className="py-4 border-b border-border/50">
        <h4 className="text-sm font-medium">Branch name prefix</h4>
        <p className="text-sm text-muted-foreground mt-0.5">
          Prefix for new session branch names, followed by a slash.
        </p>

        <div className="mt-4 space-y-2">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="radio"
              name="branchPrefix"
              checked={branchPrefixType === 'github'}
              onChange={() => setBranchPrefixType('github')}
              className="w-4 h-4 text-primary border-muted-foreground/50 focus:ring-primary"
            />
            <span className="text-sm">GitHub username ({githubUsername})</span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="radio"
              name="branchPrefix"
              checked={branchPrefixType === 'custom'}
              onChange={() => setBranchPrefixType('custom')}
              className="w-4 h-4 text-primary border-muted-foreground/50 focus:ring-primary"
            />
            <span className="text-sm">Custom</span>
          </label>

          {branchPrefixType === 'custom' && (
            <div className="ml-7">
              <input
                type="text"
                value={customPrefix}
                onChange={(e) => setCustomPrefix(e.target.value)}
                placeholder="Enter custom prefix"
                className="w-48 px-3 py-1.5 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          )}

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="radio"
              name="branchPrefix"
              checked={branchPrefixType === 'none'}
              onChange={() => setBranchPrefixType('none')}
              className="w-4 h-4 text-primary border-muted-foreground/50 focus:ring-primary"
            />
            <span className="text-sm">None</span>
          </label>
        </div>
      </div>

      {/* Delete branch on archive */}
      <div className="flex items-start justify-between py-4 border-b border-border/50">
        <div className="flex-1 pr-4">
          <h4 className="text-sm font-medium">Delete branch on archive</h4>
          <p className="text-sm text-muted-foreground mt-0.5">
            Delete the local branch when archiving a session.
            <br />
            To delete the remote branch,{' '}
            <a
              href="https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-the-automatic-deletion-of-branches"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              configure it on GitHub
            </a>
            .
          </p>
        </div>
        <div className="shrink-0 pt-1">
          <Switch
            checked={deleteBranchOnArchive}
            onCheckedChange={setDeleteBranchOnArchive}
          />
        </div>
      </div>

      {/* Archive on merge */}
      <div className="flex items-start justify-between py-4 border-b border-border/50">
        <div className="flex-1 pr-4">
          <h4 className="text-sm font-medium">Archive on merge</h4>
          <p className="text-sm text-muted-foreground mt-0.5">
            Automatically archive a session after merging its pull request
          </p>
        </div>
        <div className="shrink-0 pt-1">
          <Switch
            checked={archiveOnMerge}
            onCheckedChange={setArchiveOnMerge}
          />
        </div>
      </div>
    </div>
  );
}
