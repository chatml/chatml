import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '../appStore';
import type { ActiveTool, SubAgent, BackgroundTask } from '@/lib/types';

const CONV = 'conv-1';

function makeTool(overrides: Partial<ActiveTool> = {}): ActiveTool {
  return {
    id: `t-${Math.random().toString(36).slice(2, 7)}`,
    tool: 'Read',
    startTime: Date.now(),
    ...overrides,
  } as ActiveTool;
}

function makeSubAgent(overrides: Partial<SubAgent> = {}): SubAgent {
  return {
    agentId: `a-${Math.random().toString(36).slice(2, 7)}`,
    agentType: 'general-purpose',
    parentToolUseId: 'parent-1',
    tools: [],
    startTime: Date.now(),
    completed: false,
    ...overrides,
  } as SubAgent;
}

function makeBgTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  return {
    taskId: `task-${Math.random().toString(36).slice(2, 7)}`,
    description: 'Run thing',
    status: 'running',
    startTime: Date.now(),
    ...overrides,
  } as BackgroundTask;
}

describe('appStore — active tools, sub-agents, background tasks', () => {
  beforeEach(() => {
    useAppStore.setState({
      activeTools: {},
      subAgents: {},
      backgroundTasks: {},
      streamingState: {},
    });
  });

  // ---- Active tools -----------------------------------------------------------

  describe('addActiveTool', () => {
    it('appends a tool to the conversation array', () => {
      const tool = makeTool({ id: 't1', tool: 'Read' });
      useAppStore.getState().addActiveTool(CONV, tool);
      expect(useAppStore.getState().activeTools[CONV]).toEqual([tool]);
    });

    it('deduplicates tools with the same id', () => {
      const tool = makeTool({ id: 't1' });
      useAppStore.getState().addActiveTool(CONV, tool);
      useAppStore.getState().addActiveTool(CONV, tool);
      expect(useAppStore.getState().activeTools[CONV]).toHaveLength(1);
    });

    it('isolates tools across conversations', () => {
      useAppStore.getState().addActiveTool('conv-a', makeTool({ id: 't1' }));
      useAppStore.getState().addActiveTool('conv-b', makeTool({ id: 't2' }));
      expect(useAppStore.getState().activeTools['conv-a']).toHaveLength(1);
      expect(useAppStore.getState().activeTools['conv-b']).toHaveLength(1);
    });
  });

  describe('completeActiveTool', () => {
    it('sets endTime, success, summary, stdout, stderr, metadata', () => {
      const tool = makeTool({ id: 't1' });
      useAppStore.setState({ activeTools: { [CONV]: [tool] } });

      useAppStore.getState().completeActiveTool(
        CONV,
        't1',
        true,
        'done',
        'out',
        'err',
        { key: 'value' } as never,
      );

      const updated = useAppStore.getState().activeTools[CONV][0];
      expect(updated.endTime).toBeDefined();
      expect(updated.success).toBe(true);
      expect(updated.summary).toBe('done');
      expect(updated.stdout).toBe('out');
      expect(updated.stderr).toBe('err');
      expect(updated.metadata).toEqual({ key: 'value' });
    });

    it('is idempotent when tool is not present', () => {
      const before = useAppStore.getState().activeTools;
      useAppStore.getState().completeActiveTool(CONV, 'missing', true);
      expect(useAppStore.getState().activeTools).toBe(before);
    });
  });

  describe('updateToolProgress', () => {
    it('updates elapsedSeconds for an in-flight tool', () => {
      const tool = makeTool({ id: 't1' });
      useAppStore.setState({ activeTools: { [CONV]: [tool] } });

      useAppStore.getState().updateToolProgress(CONV, 't1', { elapsedTimeSeconds: 5 } as never);

      expect(useAppStore.getState().activeTools[CONV][0].elapsedSeconds).toBe(5);
    });

    it('is a no-op when tool already completed (has endTime)', () => {
      const tool = makeTool({ id: 't1', endTime: Date.now() });
      useAppStore.setState({ activeTools: { [CONV]: [tool] } });
      const before = useAppStore.getState().activeTools[CONV][0];

      useAppStore.getState().updateToolProgress(CONV, 't1', { elapsedTimeSeconds: 99 } as never);
      expect(useAppStore.getState().activeTools[CONV][0]).toBe(before);
    });

    it('is a no-op when tool not found', () => {
      useAppStore.setState({ activeTools: { [CONV]: [] } });
      useAppStore.getState().updateToolProgress(CONV, 'missing', { elapsedTimeSeconds: 5 } as never);
      expect(useAppStore.getState().activeTools[CONV]).toEqual([]);
    });
  });

  describe('updateToolProgressBatch', () => {
    it('updates multiple tools in one batch', () => {
      const t1 = makeTool({ id: 't1' });
      const t2 = makeTool({ id: 't2' });
      useAppStore.setState({ activeTools: { [CONV]: [t1, t2] } });

      useAppStore.getState().updateToolProgressBatch([
        { conversationId: CONV, toolId: 't1', progress: { elapsedTimeSeconds: 1 } as never },
        { conversationId: CONV, toolId: 't2', progress: { elapsedTimeSeconds: 2 } as never },
      ]);

      const tools = useAppStore.getState().activeTools[CONV];
      expect(tools.find((t) => t.id === 't1')?.elapsedSeconds).toBe(1);
      expect(tools.find((t) => t.id === 't2')?.elapsedSeconds).toBe(2);
    });

    it('is a no-op when no updates have a matching active tool', () => {
      useAppStore.setState({ activeTools: { [CONV]: [] } });
      const before = useAppStore.getState().activeTools;

      useAppStore.getState().updateToolProgressBatch([
        { conversationId: CONV, toolId: 'missing', progress: { elapsedTimeSeconds: 5 } as never },
      ]);
      expect(useAppStore.getState().activeTools).toBe(before);
    });

    it('returns state unchanged when updates array is empty', () => {
      useAppStore.setState({ activeTools: { [CONV]: [makeTool({ id: 't1' })] } });
      const before = useAppStore.getState().activeTools;
      useAppStore.getState().updateToolProgressBatch([]);
      expect(useAppStore.getState().activeTools).toBe(before);
    });
  });

  describe('clearActiveTools', () => {
    it('replaces the conversation\'s active tools with an empty array', () => {
      useAppStore.setState({ activeTools: { [CONV]: [makeTool(), makeTool()] } });
      useAppStore.getState().clearActiveTools(CONV);
      expect(useAppStore.getState().activeTools[CONV]).toEqual([]);
    });
  });

  // ---- Sub agents -------------------------------------------------------------

  describe('addSubAgent', () => {
    it('adds a sub-agent', () => {
      const agent = makeSubAgent({ agentId: 'a1' });
      useAppStore.getState().addSubAgent(CONV, agent);
      expect(useAppStore.getState().subAgents[CONV]).toEqual([agent]);
    });

    it('deduplicates sub-agents with the same id', () => {
      const agent = makeSubAgent({ agentId: 'a1' });
      useAppStore.getState().addSubAgent(CONV, agent);
      useAppStore.getState().addSubAgent(CONV, agent);
      expect(useAppStore.getState().subAgents[CONV]).toHaveLength(1);
    });
  });

  describe('completeSubAgent', () => {
    it('marks completed=true and sets endTime', () => {
      const agent = makeSubAgent({ agentId: 'a1' });
      useAppStore.setState({ subAgents: { [CONV]: [agent] } });

      useAppStore.getState().completeSubAgent(CONV, 'a1');
      const updated = useAppStore.getState().subAgents[CONV][0];
      expect(updated.completed).toBe(true);
      expect(updated.endTime).toBeDefined();
    });
  });

  describe('addSubAgentTool', () => {
    it('appends tool to the named sub-agent', () => {
      const agent = makeSubAgent({ agentId: 'a1', tools: [] });
      useAppStore.setState({ subAgents: { [CONV]: [agent] } });

      const tool = makeTool({ id: 'sub-t1' });
      useAppStore.getState().addSubAgentTool(CONV, 'a1', tool);

      const updated = useAppStore.getState().subAgents[CONV][0];
      expect(updated.tools).toEqual([tool]);
    });

    it('warns and drops tool when sub-agent does not exist', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      useAppStore.setState({ subAgents: { [CONV]: [] } });

      useAppStore.getState().addSubAgentTool(CONV, 'missing', makeTool({ id: 't1' }));

      expect(warnSpy).toHaveBeenCalled();
      expect(useAppStore.getState().subAgents[CONV]).toEqual([]);
      warnSpy.mockRestore();
    });

    it('deduplicates tools within the same sub-agent', () => {
      const tool = makeTool({ id: 't1' });
      const agent = makeSubAgent({ agentId: 'a1', tools: [tool] });
      useAppStore.setState({ subAgents: { [CONV]: [agent] } });

      useAppStore.getState().addSubAgentTool(CONV, 'a1', tool);
      expect(useAppStore.getState().subAgents[CONV][0].tools).toHaveLength(1);
    });
  });

  describe('completeSubAgentTool', () => {
    it('finalizes a tool inside a sub-agent', () => {
      const tool = makeTool({ id: 't1' });
      const agent = makeSubAgent({ agentId: 'a1', tools: [tool] });
      useAppStore.setState({ subAgents: { [CONV]: [agent] } });

      useAppStore.getState().completeSubAgentTool(CONV, 'a1', 't1', true, 'ok', 'so', 'se');
      const finalized = useAppStore.getState().subAgents[CONV][0].tools[0];
      expect(finalized.endTime).toBeDefined();
      expect(finalized.success).toBe(true);
      expect(finalized.summary).toBe('ok');
      expect(finalized.stdout).toBe('so');
      expect(finalized.stderr).toBe('se');
    });
  });

  describe('setSubAgentOutput / setSubAgentUsage', () => {
    it('setSubAgentOutput updates output for matching agent', () => {
      const agent = makeSubAgent({ agentId: 'a1', output: undefined });
      useAppStore.setState({ subAgents: { [CONV]: [agent] } });

      useAppStore.getState().setSubAgentOutput(CONV, 'a1', 'hello world');
      expect(useAppStore.getState().subAgents[CONV][0].output).toBe('hello world');
    });

    it('setSubAgentUsage matches by parentToolUseId', () => {
      const agent = makeSubAgent({ agentId: 'a1', parentToolUseId: 'parent-1' });
      useAppStore.setState({ subAgents: { [CONV]: [agent] } });

      useAppStore.getState().setSubAgentUsage(CONV, 'parent-1', { inputTokens: 100, outputTokens: 50 } as never);
      expect((useAppStore.getState().subAgents[CONV][0] as SubAgent & { usage?: { inputTokens: number; outputTokens: number } }).usage).toEqual({ inputTokens: 100, outputTokens: 50 });
    });

    it('setSubAgentUsage is a no-op when no agent has matching parentToolUseId', () => {
      const agent = makeSubAgent({ agentId: 'a1', parentToolUseId: 'parent-1' });
      useAppStore.setState({ subAgents: { [CONV]: [agent] } });

      useAppStore.getState().setSubAgentUsage(CONV, 'other', { inputTokens: 1, outputTokens: 1 } as never);
      expect((useAppStore.getState().subAgents[CONV][0] as SubAgent & { usage?: unknown }).usage).toBeUndefined();
    });
  });

  describe('clearSubAgents', () => {
    it('clears the conversation\'s sub-agents', () => {
      useAppStore.setState({ subAgents: { [CONV]: [makeSubAgent(), makeSubAgent()] } });
      useAppStore.getState().clearSubAgents(CONV);
      expect(useAppStore.getState().subAgents[CONV]).toEqual([]);
    });
  });

  // ---- Background tasks ------------------------------------------------------

  describe('addBackgroundTask', () => {
    it('appends task to the conversation array', () => {
      const task = makeBgTask({ taskId: 'task-1' });
      useAppStore.getState().addBackgroundTask(CONV, task);
      expect(useAppStore.getState().backgroundTasks[CONV]).toEqual([task]);
    });

    it('deduplicates by taskId', () => {
      const task = makeBgTask({ taskId: 'task-1' });
      useAppStore.getState().addBackgroundTask(CONV, task);
      useAppStore.getState().addBackgroundTask(CONV, task);
      expect(useAppStore.getState().backgroundTasks[CONV]).toHaveLength(1);
    });
  });

  describe('updateBackgroundTask', () => {
    it('merges partial updates', () => {
      const task = makeBgTask({ taskId: 'task-1', status: 'running' });
      useAppStore.setState({ backgroundTasks: { [CONV]: [task] } });

      useAppStore.getState().updateBackgroundTask(CONV, 'task-1', { status: 'completed' });
      expect(useAppStore.getState().backgroundTasks[CONV][0].status).toBe('completed');
    });
  });

  describe('stopBackgroundTask', () => {
    it('marks status=stopped and sets endTime', () => {
      const task = makeBgTask({ taskId: 'task-1', status: 'running' });
      useAppStore.setState({ backgroundTasks: { [CONV]: [task] } });

      useAppStore.getState().stopBackgroundTask(CONV, 'task-1');
      const stopped = useAppStore.getState().backgroundTasks[CONV][0] as BackgroundTask & { endTime: number };
      expect(stopped.status).toBe('stopped');
      expect(stopped.endTime).toBeDefined();
    });
  });

  describe('clearBackgroundTasks', () => {
    it('clears all tasks for the conversation', () => {
      useAppStore.setState({ backgroundTasks: { [CONV]: [makeBgTask(), makeBgTask()] } });
      useAppStore.getState().clearBackgroundTasks(CONV);
      expect(useAppStore.getState().backgroundTasks[CONV]).toEqual([]);
    });
  });

  describe('clearStoppedBackgroundTasks', () => {
    it('removes only stopped tasks, keeps running ones', () => {
      const running = makeBgTask({ taskId: 't-running', status: 'running' });
      const stopped = makeBgTask({ taskId: 't-stopped', status: 'stopped' });
      useAppStore.setState({ backgroundTasks: { [CONV]: [running, stopped] } });

      useAppStore.getState().clearStoppedBackgroundTasks(CONV);
      const tasks = useAppStore.getState().backgroundTasks[CONV];
      expect(tasks).toHaveLength(1);
      expect(tasks[0].taskId).toBe('t-running');
    });
  });

  describe('removeBackgroundTask', () => {
    it('removes a specific task by id', () => {
      const t1 = makeBgTask({ taskId: 't1' });
      const t2 = makeBgTask({ taskId: 't2' });
      useAppStore.setState({ backgroundTasks: { [CONV]: [t1, t2] } });

      useAppStore.getState().removeBackgroundTask(CONV, 't1');
      expect(useAppStore.getState().backgroundTasks[CONV].map((t) => t.taskId)).toEqual(['t2']);
    });

    it('is a no-op when task does not exist', () => {
      const t1 = makeBgTask({ taskId: 't1' });
      useAppStore.setState({ backgroundTasks: { [CONV]: [t1] } });
      const before = useAppStore.getState().backgroundTasks;

      useAppStore.getState().removeBackgroundTask(CONV, 'missing');
      expect(useAppStore.getState().backgroundTasks).toBe(before);
    });
  });
});
