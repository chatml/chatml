import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__mocks__/server';
import { CreateFromPRModal } from '../CreateFromPRModal';
import { useAppStore } from '@/stores/appStore';

const API_BASE = 'http://localhost:9876';

const mockPRResponse = {
  owner: 'testorg',
  repo: 'testrepo',
  prNumber: 42,
  title: 'Add authentication',
  body: 'Adds OAuth2 flow for login',
  branch: 'feature/auth',
  baseBranch: 'main',
  state: 'open',
  isDraft: false,
  labels: ['enhancement'],
  reviewers: ['alice'],
  additions: 200,
  deletions: 50,
  changedFiles: 8,
  matchedWorkspaceId: 'workspace-1',
  htmlUrl: 'https://github.com/testorg/testrepo/pull/42',
};

// Mock navigation
vi.mock('@/lib/navigation', () => ({
  navigate: vi.fn(),
}));

describe('CreateFromPRModal', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Set up workspaces in store
    useAppStore.setState({
      workspaces: [
        {
          id: 'workspace-1',
          name: 'test-repo',
          path: '/repos/test-repo',
          defaultBranch: 'main',
          createdAt: new Date().toISOString(),
        },
      ],
      selectedWorkspaceId: 'workspace-1',
    });

    // Default handler for resolve-pr (never called unless URL is valid)
    server.use(
      http.post(`${API_BASE}/api/resolve-pr`, () => {
        return HttpResponse.json(mockPRResponse);
      })
    );
  });

  it('renders with two tabs: From PR and From Branch', () => {
    render(<CreateFromPRModal {...defaultProps} />);

    expect(screen.getByText('From PR')).toBeInTheDocument();
    expect(screen.getByText('From Branch')).toBeInTheDocument();
  });

  it('renders the dialog title', () => {
    render(<CreateFromPRModal {...defaultProps} />);

    expect(screen.getByText(/New Session from PR/)).toBeInTheDocument();
  });

  it('shows PR URL input on the PR tab', () => {
    render(<CreateFromPRModal {...defaultProps} />);

    expect(
      screen.getByPlaceholderText('https://github.com/owner/repo/pull/123')
    ).toBeInTheDocument();
  });

  it('shows PR details after entering a valid PR URL', async () => {
    const user = userEvent.setup();
    render(<CreateFromPRModal {...defaultProps} />);

    const input = screen.getByPlaceholderText(
      'https://github.com/owner/repo/pull/123'
    );
    await user.type(input, 'https://github.com/testorg/testrepo/pull/42');

    // Wait for debounced API call and rendering
    await waitFor(
      () => {
        expect(screen.getByText(/Add authentication/)).toBeInTheDocument();
      },
      { timeout: 2000 }
    );

    // Check branch name is displayed in the PR details
    expect(screen.getByText('feature/auth')).toBeInTheDocument();
  });

  it('shows error when PR resolution fails', async () => {
    server.use(
      http.post(`${API_BASE}/api/resolve-pr`, () => {
        return HttpResponse.json(
          { error: 'PR not found' },
          { status: 404 }
        );
      })
    );

    const user = userEvent.setup();
    render(<CreateFromPRModal {...defaultProps} />);

    const input = screen.getByPlaceholderText(
      'https://github.com/owner/repo/pull/123'
    );
    await user.type(input, 'https://github.com/testorg/testrepo/pull/999');

    await waitFor(
      () => {
        expect(screen.getByText(/Failed to resolve PR|PR not found/)).toBeInTheDocument();
      },
      { timeout: 2000 }
    );
  });

  it('does not render when isOpen is false', () => {
    render(<CreateFromPRModal isOpen={false} onClose={vi.fn()} />);

    expect(
      screen.queryByText(/New Session from PR/)
    ).not.toBeInTheDocument();
  });

  it('disables Create Session button when no PR is resolved', () => {
    render(<CreateFromPRModal {...defaultProps} />);

    const createButton = screen.getByRole('button', {
      name: /Create Session/i,
    });
    expect(createButton).toBeDisabled();
  });

  it('shows the Branch tab content when clicked', async () => {
    const user = userEvent.setup();

    // Mock branches endpoint
    server.use(
      http.get(`${API_BASE}/api/repos/:workspaceId/branches`, () => {
        return HttpResponse.json({
          branches: [
            {
              name: 'feature/cool-thing',
              lastCommitDate: new Date().toISOString(),
              lastAuthor: 'dev',
              lastCommitSubject: 'Add cool thing',
              aheadMain: 3,
              behindMain: 0,
            },
          ],
        });
      })
    );

    render(<CreateFromPRModal {...defaultProps} />);

    // Click on the Branch tab
    await user.click(screen.getByText('From Branch'));

    // Should show workspace selector and branch search
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText('Search branches...')
      ).toBeInTheDocument();
    });
  });

  it('shows draft badge for draft PRs', async () => {
    server.use(
      http.post(`${API_BASE}/api/resolve-pr`, () => {
        return HttpResponse.json({
          ...mockPRResponse,
          isDraft: true,
        });
      })
    );

    const user = userEvent.setup();
    render(<CreateFromPRModal {...defaultProps} />);

    const input = screen.getByPlaceholderText(
      'https://github.com/owner/repo/pull/123'
    );
    await user.type(input, 'https://github.com/testorg/testrepo/pull/42');

    await waitFor(
      () => {
        expect(screen.getByText('Draft')).toBeInTheDocument();
      },
      { timeout: 2000 }
    );
  });
});
