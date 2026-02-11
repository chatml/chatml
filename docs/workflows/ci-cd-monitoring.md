# CI/CD Monitoring

ChatML integrates with GitHub Actions to provide build monitoring, log viewing, and AI-powered failure analysis directly within the application.

## GitHub Actions Integration

### Workflow Runs

For sessions with a pushed branch, ChatML can fetch GitHub Actions workflow runs:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/repos/{id}/sessions/{sessionId}/ci/runs` | List workflow runs for the session's branch |
| `GET /api/repos/{id}/sessions/{sessionId}/ci/runs/{runId}` | Get details for a specific run |
| `GET /api/repos/{id}/sessions/{sessionId}/ci/runs/{runId}/jobs` | List jobs within a run |
| `POST /api/repos/{id}/sessions/{sessionId}/ci/runs/{runId}/rerun` | Rerun a workflow |

### Job Logs

| Endpoint | Purpose |
|----------|---------|
| `GET /api/repos/{id}/sessions/{sessionId}/ci/jobs/{jobId}/logs` | Get log output for a job |

## AI Failure Analysis

When CI checks fail, Claude can analyze the failure:

| Endpoint | Purpose |
|----------|---------|
| `POST /api/repos/{id}/sessions/{sessionId}/ci/analyze` | Request AI analysis of CI failure |
| `GET /api/repos/{id}/sessions/{sessionId}/ci/failure-context` | Get context about the failure for analysis |

The analysis examines:
- Job log output to identify the failing step
- Error messages and stack traces
- The diff between the session and base branch
- Common failure patterns (test failures, lint errors, build errors, type errors)

## Session Status Indicators

Sessions display CI status through two fields:

| Field | Description |
|-------|-------------|
| `hasCheckFailures` | `true` when any CI check is failing |
| `prStatus` | Updated to reflect overall PR state |

These are tracked by the `PRWatcher` background service that polls GitHub periodically.

## Commit Status

For manual status reporting:

| Endpoint | Purpose |
|----------|---------|
| `POST /api/repos/{id}/sessions/{sessionId}/status` | Post a commit status |
| `GET /api/repos/{id}/sessions/{sessionId}/statuses` | List commit statuses |

## Related Documentation

- [Pull Request Workflow](./pull-request-workflow.md)
- [Polyglot Architecture](../architecture/polyglot-architecture.md)
