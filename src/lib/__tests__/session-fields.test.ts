import { describe, it, expect } from 'vitest';
import {
  getPriorityOption,
  getTaskStatusOption,
  PRIORITY_OPTIONS,
  TASK_STATUS_OPTIONS,
} from '../session-fields';

describe('getPriorityOption', () => {
  it('returns correct option for each known priority value', () => {
    expect(getPriorityOption(0).label).toBe('No priority');
    expect(getPriorityOption(1).label).toBe('Urgent');
    expect(getPriorityOption(2).label).toBe('High');
    expect(getPriorityOption(3).label).toBe('Medium');
    expect(getPriorityOption(4).label).toBe('Low');
  });

  it('falls back to first option for unknown value', () => {
    expect(getPriorityOption(99)).toBe(PRIORITY_OPTIONS[0]);
    expect(getPriorityOption(-1)).toBe(PRIORITY_OPTIONS[0]);
  });
});

describe('getTaskStatusOption', () => {
  it('returns correct option for each known status', () => {
    expect(getTaskStatusOption('backlog').label).toBe('Backlog');
    expect(getTaskStatusOption('in_progress').label).toBe('In Progress');
    expect(getTaskStatusOption('in_review').label).toBe('In Review');
    expect(getTaskStatusOption('done').label).toBe('Done');
    expect(getTaskStatusOption('cancelled').label).toBe('Cancelled');
  });

  it('falls back to first option for unknown value', () => {
    expect(getTaskStatusOption('unknown')).toBe(TASK_STATUS_OPTIONS[0]);
    expect(getTaskStatusOption('')).toBe(TASK_STATUS_OPTIONS[0]);
  });
});
