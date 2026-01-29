'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FileCode } from 'lucide-react';
import { cn } from '@/lib/utils';
import { openFolderDialog, getHomeDir } from '@/lib/tauri';

interface QuickStartDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type Template = 'empty' | 'nextjs';

// Generate a unique default project name with timestamp
function generateDefaultName(): string {
  const timestamp = Date.now().toString(36).slice(-4);
  return `chatml-playground-${timestamp}`;
}

export function QuickStartDialog({ isOpen, onClose }: QuickStartDialogProps) {
  const [name, setName] = useState(generateDefaultName);
  const [location, setLocation] = useState('');
  const [template, setTemplate] = useState<Template>('empty');
  const hasInitializedLocation = useRef(false);

  const canSubmit = name.trim() && location.trim();

  // Fetch home directory once for default location
  useEffect(() => {
    if (!hasInitializedLocation.current) {
      hasInitializedLocation.current = true;
      getHomeDir().then((home) => {
        if (home) {
          setLocation(home);
        }
      });
    }
  }, []);

  const handleClose = useCallback(() => {
    setName(generateDefaultName());
    setTemplate('empty');
    onClose();
  }, [onClose]);

  const handleSubmit = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!canSubmit) return;

    // TODO: Implement actual project creation via Tauri command
    // For now, show a message that this feature is coming soon
    const templateName = template === 'nextjs' ? 'Next.js' : 'Empty';
    alert(`Quick start feature coming soon!\n\nProject: ${name}\nLocation: ${location}\nTemplate: ${templateName}`);
    handleClose();
  }, [canSubmit, name, location, template, handleClose]);

  // Keyboard shortcut: Cmd+Enter to submit
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === 'Enter' && canSubmit) {
        e.preventDefault();
        handleSubmit();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, canSubmit, handleSubmit]);

  const handleBrowse = async () => {
    const selectedPath = await openFolderDialog('Select Location');
    if (selectedPath) {
      setLocation(selectedPath);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Quick start</DialogTitle>
          <DialogDescription>
            ChatML will create a new folder and GitHub repo for you.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label htmlFor="project-name" className="text-sm font-medium">Name</label>
              <Input
                id="project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="chatml-playground"
                className="text-sm"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="project-location" className="text-sm font-medium">Location</label>
              <div className="flex gap-2">
                <Input
                  id="project-location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Select a location..."
                  className="font-mono text-sm flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleBrowse}
                >
                  Browse...
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-sm font-medium">Template</span>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setTemplate('empty')}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 rounded-lg border text-left transition-colors flex-1',
                    template === 'empty'
                      ? 'border-primary/50 bg-primary/5'
                      : 'border-border hover:bg-surface-2'
                  )}
                >
                  <div className="w-10 h-10 rounded-md bg-muted/50 flex items-center justify-center shrink-0">
                    <FileCode className="w-5 h-5 text-muted-foreground" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">Empty</div>
                    <div className="text-xs text-muted-foreground">Start from scratch</div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setTemplate('nextjs')}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3 rounded-lg border text-left transition-colors flex-1',
                    template === 'nextjs'
                      ? 'border-primary/50 bg-primary/5'
                      : 'border-border hover:bg-surface-2'
                  )}
                >
                  <div className="w-10 h-10 rounded-md bg-muted/50 flex items-center justify-center shrink-0">
                    <span className="text-lg font-bold text-muted-foreground">N</span>
                  </div>
                  <div>
                    <div className="text-sm font-medium">Next.js</div>
                    <div className="text-xs text-muted-foreground">TS, Tailwind, App Router</div>
                  </div>
                </button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              Create
              <kbd className="ml-2 pointer-events-none inline-flex h-5 items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                <span className="text-xs">&#8984;</span>&#8629;
              </kbd>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
