import { act } from '@testing-library/react';

// Store reset utilities will be added as needed when testing specific stores
// For now, provide basic test data factories

export function createMockWorkspace(overrides?: Record<string, unknown>) {
  return {
    id: `workspace-${Date.now()}`,
    name: 'Test Workspace',
    path: '/test/path',
    defaultBranch: 'main',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

export function createMockSession(overrides?: Record<string, unknown>) {
  return {
    id: `session-${Date.now()}`,
    workspaceId: 'workspace-1',
    name: 'Test Session',
    branch: 'feature/test',
    worktreePath: '/test/worktree',
    status: 'idle',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

export function createMockConversation(overrides?: Record<string, unknown>) {
  return {
    id: `conv-${Date.now()}`,
    sessionId: 'session-1',
    type: 'task',
    name: 'Test Conversation',
    status: 'idle',
    messages: [],
    toolSummary: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

export function createMockMessage(overrides?: Record<string, unknown>) {
  return {
    id: `msg-${Date.now()}`,
    conversationId: 'conv-1',
    role: 'user',
    content: 'Test message',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// Helper to run store updates in act()
export function runInAct<T>(fn: () => T): T {
  let result: T;
  act(() => {
    result = fn();
  });
  return result!;
}
