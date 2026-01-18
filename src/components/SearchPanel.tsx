'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Search,
  X,
  FileCode,
  FolderGit2,
  Filter,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export function SearchPanel() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ file: string; line: number; content: string; workspace: string }[]>([]);

  return (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground">
      {/* Header */}
      <div className="h-11 flex items-center gap-2 px-3 border-b border-sidebar-border shrink-0">
        <Search className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-semibold">Search</span>
      </div>

      {/* Search Input */}
      <div className="p-2 border-b border-sidebar-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Search across workspaces..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8 pr-8 h-8 text-sm bg-sidebar-accent border-sidebar-border"
          />
          {query && (
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
              onClick={() => setQuery('')}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
        <div className="flex items-center gap-1 mt-2">
          <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 text-muted-foreground">
            <Filter className="h-3 w-3" />
            Filters
          </Button>
        </div>
      </div>

      {/* Results */}
      <ScrollArea className="flex-1">
        {query ? (
          results.length > 0 ? (
            <div className="p-2">
              {results.map((result, idx) => (
                <div
                  key={idx}
                  className="px-2 py-1.5 rounded hover:bg-sidebar-accent cursor-pointer"
                >
                  <div className="flex items-center gap-2 text-xs">
                    <FileCode className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate">{result.file}</span>
                    <span className="text-muted-foreground">:{result.line}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate pl-5">
                    {result.content}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-3 py-8 text-center">
              <p className="text-sm text-muted-foreground">No results found</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Try a different search term
              </p>
            </div>
          )
        ) : (
          <div className="px-3 py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
              <Search className="w-6 h-6 text-muted-foreground/50" />
            </div>
            <p className="text-sm text-muted-foreground">Search your code</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Find across all workspaces and sessions
            </p>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
