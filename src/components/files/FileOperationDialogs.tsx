'use client';

import { useState, useRef, useCallback } from 'react';
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
import { AlertTriangle } from 'lucide-react';

// --- Confirm Delete Dialog ---

interface ConfirmDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  name: string;
  isDir: boolean;
  isLoading?: boolean;
}

export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  onConfirm,
  name,
  isDir,
  isLoading,
}: ConfirmDeleteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-destructive" />
            Delete {isDir ? 'Folder' : 'File'}
          </DialogTitle>
          <DialogDescription>
            Are you sure you want to delete <span className="font-medium text-foreground">{name}</span>?
            {isDir && ' This will delete the folder and all of its contents.'}
            {' '}This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isLoading}>
            {isLoading ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Confirm Discard Changes Dialog ---

interface ConfirmDiscardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  name: string;
  isFolder?: boolean;
  isLoading?: boolean;
}

export function ConfirmDiscardDialog({
  open,
  onOpenChange,
  onConfirm,
  name,
  isFolder,
  isLoading,
}: ConfirmDiscardDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-5 text-destructive" />
            Discard Changes
          </DialogTitle>
          <DialogDescription>
            {isFolder
              ? <>Discard all changes in <span className="font-medium text-foreground">{name}</span>? This will revert all modified files in this folder.</>
              : <>Discard changes to <span className="font-medium text-foreground">{name}</span>? This will revert the file to the last committed version.</>
            }
            {' '}This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isLoading}>
            {isLoading ? 'Discarding…' : 'Discard'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- New File / New Folder Dialog ---

interface NewItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (name: string) => void;
  type: 'file' | 'folder';
  parentPath: string;
  isLoading?: boolean;
}

export function NewItemDialog({
  open,
  onOpenChange,
  onConfirm,
  type,
  parentPath,
  isLoading,
}: NewItemDialogProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state when dialog opens
  const handleOpenChange = useCallback((newOpen: boolean) => {
    if (newOpen) {
      setName('');
      setError('');
    }
    onOpenChange(newOpen);
  }, [onOpenChange]);

  const validate = (value: string): string => {
    if (!value.trim()) return 'Name cannot be empty';
    if (value.includes('/') || value.includes('\\')) return 'Name cannot contain path separators';
    if (value.includes('\0')) return 'Name contains invalid characters';
    if (value === '.' || value === '..') return 'Invalid name';
    return '';
  };

  const handleSubmit = () => {
    const err = validate(name);
    if (err) {
      setError(err);
      return;
    }
    onConfirm(name.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  const label = type === 'file' ? 'File' : 'Folder';
  const displayParent = parentPath || '(root)';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New {label}</DialogTitle>
          <DialogDescription>
            Create a new {type} in <span className="font-medium text-foreground">{displayParent}</span>
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <Input
            ref={inputRef}
            autoFocus
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError('');
            }}
            onKeyDown={handleKeyDown}
            placeholder={type === 'file' ? 'filename.txt' : 'folder-name'}
            className={error ? 'border-destructive' : ''}
          />
          {error && (
            <p className="text-xs text-destructive mt-1">{error}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={isLoading || !name.trim()}>
            {isLoading ? 'Creating…' : `Create ${label}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
