import { describe, it, expect } from 'vitest';
import { parseGitHubUrl, extractRepoName } from '../github-url';

describe('parseGitHubUrl', () => {
  it.each([
    ['https://github.com/owner/repo', { owner: 'owner', repo: 'repo' }],
    ['https://github.com/owner/repo.git', { owner: 'owner', repo: 'repo' }],
    ['https://github.com/owner/repo/tree/main', { owner: 'owner', repo: 'repo' }],
    ['https://github.com/owner/repo/pull/123', { owner: 'owner', repo: 'repo' }],
    ['https://github.com/owner/repo/issues', { owner: 'owner', repo: 'repo' }],
    ['http://github.com/owner/repo', { owner: 'owner', repo: 'repo' }],
    ['git@github.com:owner/repo.git', { owner: 'owner', repo: 'repo' }],
    ['git@github.com:owner/repo', { owner: 'owner', repo: 'repo' }],
    ['ssh://git@github.com/owner/repo', { owner: 'owner', repo: 'repo' }],
    ['ssh://git@github.com/owner/repo.git', { owner: 'owner', repo: 'repo' }],
  ])('parses %s', (url, expected) => {
    expect(parseGitHubUrl(url)).toEqual(expected);
  });

  it.each([
    ['https://gitlab.com/owner/repo'],
    ['https://bitbucket.org/owner/repo'],
    ['not-a-url'],
    [''],
    ['https://github.com/'],
    ['https://github.com/owner'],
  ])('returns null for %s', (url) => {
    expect(parseGitHubUrl(url)).toBeNull();
  });

  it('returns null for empty/undefined input', () => {
    expect(parseGitHubUrl('')).toBeNull();
  });
});

describe('extractRepoName', () => {
  it.each([
    ['https://github.com/user/my-repo.git', 'my-repo'],
    ['https://github.com/user/my-repo', 'my-repo'],
    ['git@github.com:org/project.git', 'project'],
    ['git@github.com:org/project', 'project'],
    ['https://gitlab.com/user/app', 'app'],
    ['ssh://git@bitbucket.org/team/lib.git', 'lib'],
    ['https://github.com/user/repo/', 'repo'],
    ['https://github.com/user/repo.git/', 'repo'],
    ['git://example.com/some/path/my-lib.git', 'my-lib'],
  ])('extracts "%s" → "%s"', (url, expected) => {
    expect(extractRepoName(url)).toBe(expected);
  });

  it.each([
    [''],
    ['   '],
  ])('returns null for empty/whitespace: "%s"', (url) => {
    expect(extractRepoName(url)).toBeNull();
  });
});
