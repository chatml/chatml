'use client';

import { useMemo } from 'react';
import { SearchX } from 'lucide-react';
import type { SettingMeta, SettingsCategory } from './settingsRegistry';

interface SettingsSearchResultsProps {
  results: SettingMeta[];
  query: string;
  onNavigate: (category: SettingsCategory, settingId?: string) => void;
}

export function SettingsSearchResults({ results, query, onNavigate }: SettingsSearchResultsProps) {
  const grouped = useMemo(() => {
    const groups = new Map<SettingsCategory, SettingMeta[]>();
    for (const result of results) {
      const existing = groups.get(result.category) || [];
      existing.push(result);
      groups.set(result.category, existing);
    }
    return groups;
  }, [results]);

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <SearchX className="w-8 h-8 mb-3 opacity-40" />
        <p className="text-sm font-medium">No settings found</p>
        <p className="text-xs mt-1">
          No results for &ldquo;{query}&rdquo;
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-4">
        {results.length} {results.length === 1 ? 'result' : 'results'} for &ldquo;{query}&rdquo;
      </p>

      <div className="space-y-6">
        {Array.from(grouped.entries()).map(([category, settings]) => (
          <div key={category}>
            <button
              type="button"
              onClick={() => onNavigate(category)}
              className="text-xs font-medium text-brand hover:underline uppercase tracking-wider mb-2 block"
            >
              {settings[0].categoryLabel}
            </button>

            <div className="border border-border/50 rounded-lg overflow-hidden">
              {settings.map((setting, idx) => (
                <button
                  key={setting.id}
                  type="button"
                  onClick={() => onNavigate(setting.category, setting.id)}
                  className={`w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors ${
                    idx < settings.length - 1 ? 'border-b border-border/50' : ''
                  }`}
                >
                  <h4 className="text-sm font-medium">{setting.title}</h4>
                  <p className="text-xs text-muted-foreground mt-0.5">{setting.description}</p>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
