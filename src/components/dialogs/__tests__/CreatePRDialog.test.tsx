import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__mocks__/server';
import { CreatePRDialog } from '../CreatePRDialog';

const API_BASE = 'http://localhost:9876';

// Default mock handlers for PR endpoints
function mockGenerateSuccess(title = 'Add auth flow', body = '- Added login\n- Added JWT') {
  server.use(
    http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/pr/generate`, () => {
      return HttpResponse.json({ title, body });
    })
  );
}

function mockCreateSuccess(htmlUrl = 'https://github.com/owner/repo/pull/42') {
  server.use(
    http.post(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/pr/create`, () => {
      return HttpResponse.json({ number: 42, htmlUrl });
    })
  );
}

describe('CreatePRDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    workspaceId: 'workspace-1',
    sessionId: 'session-1',
    onSuccess: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state while generating', () => {
    // Use a handler that delays forever
    server.use(
      http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/pr/generate`, () => {
        return new Promise(() => {
          // Never resolve
        });
      })
    );

    render(<CreatePRDialog {...defaultProps} />);

    expect(screen.getByText('Generating PR description...')).toBeInTheDocument();
  });

  it('shows generated title and body after loading', async () => {
    mockGenerateSuccess('Fix the bug', '## Summary\n- Fixed the issue');

    render(<CreatePRDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Fix the bug')).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText('PR description (markdown supported)');
    expect(textarea).toHaveValue('## Summary\n- Fixed the issue');
  });

  it('shows error when generation fails', async () => {
    server.use(
      http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/pr/generate`, () => {
        return HttpResponse.json({ error: 'No commits' }, { status: 400 });
      })
    );

    render(<CreatePRDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText(/Failed to generate PR description|No commits/)).toBeInTheDocument();
    });
  });

  it('allows editing title and body', async () => {
    const user = userEvent.setup();
    mockGenerateSuccess('Original Title', 'Original body');

    render(<CreatePRDialog {...defaultProps} />);

    // Wait for title to appear
    await waitFor(() => {
      expect(screen.getByDisplayValue('Original Title')).toBeInTheDocument();
    });

    // Clear and type new title
    const titleInput = screen.getByDisplayValue('Original Title');
    await user.clear(titleInput);
    await user.type(titleInput, 'New Title');
    expect(titleInput).toHaveValue('New Title');
  });

  it('creates PR when clicking Create button', async () => {
    const user = userEvent.setup();
    mockGenerateSuccess('Test PR', 'Test body');
    mockCreateSuccess('https://github.com/owner/repo/pull/99');

    render(<CreatePRDialog {...defaultProps} />);

    // Wait for form to be ready
    await waitFor(() => {
      expect(screen.getByDisplayValue('Test PR')).toBeInTheDocument();
    });

    // Click Create
    const createButton = screen.getByRole('button', { name: 'Create Pull Request' });
    await user.click(createButton);

    await waitFor(() => {
      expect(defaultProps.onSuccess).toHaveBeenCalledWith('https://github.com/owner/repo/pull/99');
    });
  });

  it('disables Create button when title is empty', async () => {
    mockGenerateSuccess('', 'Some body');

    render(<CreatePRDialog {...defaultProps} />);

    await waitFor(() => {
      const createButton = screen.getByRole('button', { name: 'Create Pull Request' });
      expect(createButton).toBeDisabled();
    });
  });

  it('calls onOpenChange when Cancel is clicked', async () => {
    const user = userEvent.setup();
    mockGenerateSuccess();

    render(<CreatePRDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Add auth flow')).toBeInTheDocument();
    });

    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    await user.click(cancelButton);

    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('calls generate again when Regenerate is clicked', async () => {
    const user = userEvent.setup();
    let callCount = 0;
    server.use(
      http.get(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/pr/generate`, () => {
        callCount++;
        return HttpResponse.json({
          title: `Title ${callCount}`,
          body: `Body ${callCount}`,
        });
      })
    );

    render(<CreatePRDialog {...defaultProps} />);

    // Wait for first generation
    await waitFor(() => {
      expect(screen.getByDisplayValue('Title 1')).toBeInTheDocument();
    });

    // Click regenerate
    const regenerateButton = screen.getByRole('button', { name: /Regenerate/ });
    await user.click(regenerateButton);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Title 2')).toBeInTheDocument();
    });
  });

  it('shows error when PR creation fails', async () => {
    const user = userEvent.setup();
    mockGenerateSuccess('Test PR', 'Body');

    server.use(
      http.post(`${API_BASE}/api/repos/:workspaceId/sessions/:sessionId/pr/create`, () => {
        return HttpResponse.json(
          { error: 'A pull request already exists' },
          { status: 422 }
        );
      })
    );

    render(<CreatePRDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Test PR')).toBeInTheDocument();
    });

    const createButton = screen.getByRole('button', { name: 'Create Pull Request' });
    await user.click(createButton);

    await waitFor(() => {
      expect(screen.getByText(/Failed to create pull request|already exists/)).toBeInTheDocument();
    });

    // Should not call onSuccess
    expect(defaultProps.onSuccess).not.toHaveBeenCalled();
  });

  it('does not render content when closed', () => {
    mockGenerateSuccess();

    render(<CreatePRDialog {...defaultProps} open={false} />);

    expect(screen.queryByText('New Pull Request')).not.toBeInTheDocument();
  });
});
