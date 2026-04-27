/**
 * Smoke tests for the CommandPalette dialog.
 *
 * Verifies the high-traffic paths: open/close events, search filtering,
 * command execution, and submenu navigation. The COMMANDS array is large
 * (~30+ items) so we don't try to assert on every command — just the
 * orchestration surface.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test-utils/render';
import { CommandPalette } from '../CommandPalette';
import { useAppStore } from '@/stores/appStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useNavigationStore } from '@/stores/navigationStore';

// Boundary mocks: clipboard/Tauri, API, toast
vi.mock('@/lib/tauri', () => ({
  copyToClipboard: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  unlinkPR: vi.fn(),
}));

vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  }),
}));

// useShortcut from @/hooks: capture the registered shortcut callbacks per
// id so we can simulate keyboard-triggered behavior without wiring the real
// keyboard surface (that's covered by useShortcut.test.ts directly).
const shortcutHandlers: Record<string, () => void> = {};
vi.mock('@/hooks/useShortcut', () => ({
  useShortcut: vi.fn((id: string, cb: () => void) => {
    shortcutHandlers[id] = cb;
  }),
}));

vi.mock('@/lib/navigation', () => ({
  navigate: vi.fn(),
}));

function openPalette() {
  act(() => {
    window.dispatchEvent(new CustomEvent('open-command-palette'));
  });
}

function closePalette() {
  act(() => {
    window.dispatchEvent(new CustomEvent('close-command-palette'));
  });
}

describe('CommandPalette', () => {
  beforeEach(() => {
    useAppStore.setState({
      workspaces: [],
      sessions: [],
      conversations: [],
      selectedWorkspaceId: null,
      selectedSessionId: null,
      selectedConversationId: null,
    });
    useSettingsStore.setState({
      recentCommands: [],
      addRecentCommand: vi.fn(),
      setContentView: vi.fn(),
    } as never);
    useNavigationStore.setState({
      goBack: vi.fn(),
      goForward: vi.fn(),
    } as never);
  });

  afterEach(() => {
    for (const key of Object.keys(shortcutHandlers)) delete shortcutHandlers[key];
    vi.clearAllMocks();
  });

  it('does not render the dialog when closed initially', () => {
    render(<CommandPalette />);
    expect(screen.queryByPlaceholderText(/Type a command or search/i)).toBeNull();
  });

  it('opens via the open-command-palette event', () => {
    render(<CommandPalette />);
    openPalette();
    expect(screen.getByPlaceholderText(/Type a command or search/i)).toBeInTheDocument();
  });

  it("registers the 'commandPalette' shortcut and opening it shows the dialog", () => {
    // Verifies the keyboard binding wiring without depending on the global
    // shortcut module's internals: when useShortcut is invoked with id
    // 'commandPalette', firing its captured callback opens the palette.
    render(<CommandPalette />);
    expect(typeof shortcutHandlers.commandPalette).toBe('function');

    act(() => {
      shortcutHandlers.commandPalette();
    });
    expect(screen.getByPlaceholderText(/Type a command or search/i)).toBeInTheDocument();
  });

  it('renders Settings navigation command in the visible list', () => {
    render(<CommandPalette />);
    openPalette();
    expect(screen.getByText('Open Settings')).toBeInTheDocument();
  });

  it('filters commands by search query', async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    openPalette();

    const input = screen.getByPlaceholderText(/Type a command or search/i);
    await user.type(input, 'history');

    // History command remains visible
    expect(screen.getByText('Open History')).toBeInTheDocument();
    // A non-matching command is hidden
    expect(screen.queryByText('Open Settings')).toBeNull();
  });

  it('closes via the close-command-palette event', () => {
    render(<CommandPalette />);
    openPalette();
    expect(screen.getByPlaceholderText(/Type a command or search/i)).toBeInTheDocument();

    closePalette();
    expect(screen.queryByPlaceholderText(/Type a command or search/i)).toBeNull();
  });

  it('executes a command on selection and closes the dialog', async () => {
    const setContentView = vi.fn();
    useSettingsStore.setState({
      recentCommands: [],
      addRecentCommand: vi.fn(),
      setContentView,
    } as never);

    const user = userEvent.setup();
    render(<CommandPalette />);
    openPalette();

    const item = screen.getByText('Open History');
    await user.click(item);

    expect(setContentView).toHaveBeenCalledWith({ type: 'history' });
    // Dialog closes after navigation
    expect(screen.queryByPlaceholderText(/Type a command or search/i)).toBeNull();
  });

  it('records executed command in recent list', async () => {
    const addRecentCommand = vi.fn();
    useSettingsStore.setState({
      recentCommands: [],
      addRecentCommand,
      setContentView: vi.fn(),
    } as never);

    const user = userEvent.setup();
    render(<CommandPalette />);
    openPalette();

    const item = screen.getByText('Open History');
    await user.click(item);

    expect(addRecentCommand).toHaveBeenCalledWith('open-history');
  });

  it('navigate-back command calls navigationStore.goBack', async () => {
    const goBack = vi.fn();
    useNavigationStore.setState({ goBack, goForward: vi.fn() } as never);

    const user = userEvent.setup();
    render(<CommandPalette />);
    openPalette();

    const input = screen.getByPlaceholderText(/Type a command or search/i);
    await user.type(input, 'Navigate Back');
    const item = screen.getByText('Navigate Back');
    await user.click(item);

    expect(goBack).toHaveBeenCalledTimes(1);
  });

  it('hides commands whose available() returns false', () => {
    // No workspaces → 'go-to-workspace' is unavailable
    useAppStore.setState({
      workspaces: [],
      sessions: [],
      conversations: [],
    });
    render(<CommandPalette />);
    openPalette();

    expect(screen.queryByText('Go to Workspace...')).toBeNull();
  });

  it('shows submenu commands when entries exist', () => {
    useAppStore.setState({
      workspaces: [{ id: 'ws-1', name: 'My Project', path: '/x' } as never],
      sessions: [],
      conversations: [],
    });
    render(<CommandPalette />);
    openPalette();

    expect(screen.getByText('Go to Workspace...')).toBeInTheDocument();
  });

  it('Backspace with empty search and no submenu page is a no-op (does not break)', () => {
    render(<CommandPalette />);
    openPalette();

    const input = screen.getByPlaceholderText(/Type a command or search/i);
    fireEvent.keyDown(input, { key: 'Backspace' });
    // Dialog still open
    expect(screen.getByPlaceholderText(/Type a command or search/i)).toBeInTheDocument();
  });
});
