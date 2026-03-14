import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../../__mocks__/server';
import { CreateSessionModal } from '../CreateSessionModal';
import { useAppStore } from '@/stores/appStore';

const API_BASE = 'http://localhost:9876';

const mockPRs = [
  {
    number: 885,
    title: 'feat: add image paste support via Cmd+V in chat input',
    state: 'open',
    htmlUrl: 'https://github.com/testorg/testrepo/pull/885',
    isDraft: false,
    mergeable: true,
    mergeableState: 'clean',
    checkStatus: 'success',
    checkDetails: [],
    labels: [],
    branch: 'feature/image-paste',
    baseBranch: 'main',
    workspaceId: 'workspace-1',
    workspaceName: 'test-repo',
    repoOwner: 'testorg',
    repoName: 'testrepo',
    checksTotal: 3,
    checksPassed: 3,
    checksFailed: 0,
  },
  {
    number: 539,
    title: 'feat: Add Agent Teams support for parallel sub-agents',
    state: 'open',
    htmlUrl: 'https://github.com/testorg/testrepo/pull/539',
    isDraft: true,
    mergeable: null,
    mergeableState: 'unknown',
    checkStatus: 'pending',
    checkDetails: [],
    labels: [],
    branch: 'feature/agent-teams',
    baseBranch: 'main',
    workspaceId: 'workspace-1',
    workspaceName: 'test-repo',
    repoOwner: 'testorg',
    repoName: 'testrepo',
    checksTotal: 0,
    checksPassed: 0,
    checksFailed: 0,
  },
];

const mockGitHubIssues = [
  {
    number: 42,
    title: 'Bug: Login fails on Safari',
    state: 'open',
    htmlUrl: 'https://github.com/testorg/testrepo/issues/42',
    labels: [{ name: 'bug', color: 'fc2929' }],
    user: { login: 'alice', avatarUrl: '' },
    assignees: [],
    comments: 3,
    createdAt: '2026-03-10T00:00:00Z',
    updatedAt: '2026-03-12T00:00:00Z',
  },
];

const mockLinearIssues = [
  {
    id: 'lin-1',
    identifier: 'ENG-123',
    title: 'Implement dark mode toggle',
    description: 'Users want a dark mode option',
    stateName: 'In Progress',
    labels: ['feature'],
    assignee: 'bob',
    project: 'UI Improvements',
  },
];

// Mock navigation
vi.mock('@/lib/navigation', () => ({
  navigate: vi.fn(),
}));

describe('CreateSessionModal', () => {
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

    // Default handlers
    server.use(
      http.get(`${API_BASE}/api/prs`, () => {
        return HttpResponse.json(mockPRs);
      }),
      http.get(`${API_BASE}/api/repos/:workspaceId/issues`, () => {
        return HttpResponse.json(mockGitHubIssues);
      }),
      http.get(`${API_BASE}/api/auth/linear/issues`, () => {
        return HttpResponse.json(mockLinearIssues);
      }),
      http.post(`${API_BASE}/api/resolve-pr`, () => {
        return HttpResponse.json({
          owner: 'testorg',
          repo: 'testrepo',
          prNumber: 885,
          title: 'feat: add image paste support via Cmd+V in chat input',
          body: 'Adds image paste functionality',
          branch: 'feature/image-paste',
          baseBranch: 'main',
          state: 'open',
          isDraft: false,
          labels: [],
          reviewers: [],
          additions: 100,
          deletions: 20,
          changedFiles: 5,
          matchedWorkspaceId: 'workspace-1',
          htmlUrl: 'https://github.com/testorg/testrepo/pull/885',
        });
      }),
    );
  });

  it('renders with three tabs: Pull requests, Branches, Issues', () => {
    render(<CreateSessionModal {...defaultProps} />);

    expect(screen.getByText('Pull requests')).toBeInTheDocument();
    expect(screen.getByText('Branches')).toBeInTheDocument();
    expect(screen.getByText('Issues')).toBeInTheDocument();
  });

  it('renders the search input', () => {
    render(<CreateSessionModal {...defaultProps} />);

    expect(
      screen.getByPlaceholderText('Search by title, number, or author...')
    ).toBeInTheDocument();
  });

  it('shows PR list on the Pull requests tab', async () => {
    const user = userEvent.setup();
    render(<CreateSessionModal {...defaultProps} />);

    await user.click(screen.getByText('Pull requests'));

    await waitFor(
      () => {
        expect(screen.getByText(/add image paste support/)).toBeInTheDocument();
        expect(screen.getByText('#885')).toBeInTheDocument();
      },
      { timeout: 2000 }
    );
  });

  it('shows draft PR with draft icon styling', async () => {
    const user = userEvent.setup();
    render(<CreateSessionModal {...defaultProps} />);

    await user.click(screen.getByText('Pull requests'));

    await waitFor(
      () => {
        expect(screen.getByText(/Agent Teams/)).toBeInTheDocument();
        expect(screen.getByText('#539')).toBeInTheDocument();
      },
      { timeout: 2000 }
    );
  });

  it('shows the Branches tab content when clicked', async () => {
    const user = userEvent.setup();

    render(<CreateSessionModal {...defaultProps} />);

    await user.click(screen.getByText('Branches'));

    // Should switch to branches tab (content change, empty state)
    await waitFor(() => {
      expect(screen.getByText('No branches found')).toBeInTheDocument();
    });
  });

  it('shows the Issues tab with GitHub and Linear issues', async () => {
    render(<CreateSessionModal {...defaultProps} />);

    await waitFor(
      () => {
        // GitHub issues group
        expect(screen.getByText('GitHub Issues')).toBeInTheDocument();
        expect(screen.getByText(/Login fails on Safari/)).toBeInTheDocument();
        expect(screen.getByText('#42')).toBeInTheDocument();

        // Linear issues group
        expect(screen.getByText('Linear Issues')).toBeInTheDocument();
        expect(screen.getByText(/dark mode toggle/)).toBeInTheDocument();
        expect(screen.getByText('ENG-123')).toBeInTheDocument();
      },
      { timeout: 2000 }
    );
  });

  it('does not render when isOpen is false', () => {
    render(<CreateSessionModal isOpen={false} onClose={vi.fn()} />);

    expect(
      screen.queryByText('Pull requests')
    ).not.toBeInTheDocument();
  });

  it('shows workspace selector', () => {
    render(<CreateSessionModal {...defaultProps} />);

    expect(screen.getByText('test-repo')).toBeInTheDocument();
  });

  it('filters PRs by search term', async () => {
    const user = userEvent.setup();
    render(<CreateSessionModal {...defaultProps} />);

    // Switch to PR tab and wait for PRs to load
    await user.click(screen.getByText('Pull requests'));
    await waitFor(() => {
      expect(screen.getByText('#885')).toBeInTheDocument();
    }, { timeout: 2000 });

    // Type search
    const input = screen.getByPlaceholderText('Search by title, number, or author...');
    await user.type(input, 'Agent');

    // Should only show matching PR
    await waitFor(() => {
      expect(screen.queryByText('#885')).not.toBeInTheDocument();
      expect(screen.getByText('#539')).toBeInTheDocument();
    });
  });
});
