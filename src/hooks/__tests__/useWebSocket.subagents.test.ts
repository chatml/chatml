import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/stores/appStore';

/**
 * Tests for sub-agent event handling (Group A frontend).
 *
 * Sub-agents are spawned by the Task tool and run in parallel.
 * The agent-runner emits subagent_started/stopped events and
 * tool_start/tool_end events with an agentId field for sub-agent tools.
 */

const CONV_ID = 'conv-1';

describe('useWebSocket — sub-agent event handling', () => {
  beforeEach(() => {
    useAppStore.setState({
      streamingState: {},
      activeTools: {},
      subAgents: {},
      conversations: [
        {
          id: CONV_ID,
          sessionId: 's1',
          type: 'task' as const,
          name: 'Test',
          status: 'active' as const,
          messages: [],
          toolSummary: [],
          createdAt: '',
          updatedAt: '',
        },
      ],
      messages: [],
    });
  });

  // ==========================================================================
  // subagent_started event
  // ==========================================================================

  describe('subagent_started event', () => {
    it('adds sub-agent to store with agentId, agentType, startTime', () => {
      const store = useAppStore.getState();
      store.setStreaming(CONV_ID, true);

      // Simulates: case 'subagent_started'
      store.addSubAgent(CONV_ID, {
        agentId: 'agent-1',
        agentType: 'Explore',
        parentToolUseId: 'toolu_123',
        startTime: Date.now(),
        completed: false,
        tools: [],
      });

      const agents = useAppStore.getState().subAgents[CONV_ID];
      expect(agents).toHaveLength(1);
      expect(agents[0].agentId).toBe('agent-1');
      expect(agents[0].agentType).toBe('Explore');
      expect(agents[0].parentToolUseId).toBe('toolu_123');
      expect(agents[0].completed).toBe(false);
    });

    it('handles multiple concurrent sub-agents', () => {
      const store = useAppStore.getState();
      store.setStreaming(CONV_ID, true);

      store.addSubAgent(CONV_ID, {
        agentId: 'agent-1',
        agentType: 'Explore',
        startTime: Date.now(),
        completed: false,
        tools: [],
      });
      store.addSubAgent(CONV_ID, {
        agentId: 'agent-2',
        agentType: 'Bash',
        startTime: Date.now(),
        completed: false,
        tools: [],
      });

      const agents = useAppStore.getState().subAgents[CONV_ID];
      expect(agents).toHaveLength(2);
      expect(agents[0].agentId).toBe('agent-1');
      expect(agents[1].agentId).toBe('agent-2');
    });
  });

  // ==========================================================================
  // subagent_stopped event
  // ==========================================================================

  describe('subagent_stopped event', () => {
    it('marks sub-agent as completed with endTime', () => {
      const store = useAppStore.getState();
      store.setStreaming(CONV_ID, true);
      store.addSubAgent(CONV_ID, {
        agentId: 'agent-1',
        agentType: 'Explore',
        startTime: Date.now(),
        completed: false,
        tools: [],
      });

      store.completeSubAgent(CONV_ID, 'agent-1');

      const agents = useAppStore.getState().subAgents[CONV_ID];
      expect(agents[0].completed).toBe(true);
      expect(agents[0].endTime).toBeDefined();
    });

    it('does not affect other sub-agents', () => {
      const store = useAppStore.getState();
      store.addSubAgent(CONV_ID, {
        agentId: 'agent-1',
        agentType: 'Explore',
        startTime: Date.now(),
        completed: false,
        tools: [],
      });
      store.addSubAgent(CONV_ID, {
        agentId: 'agent-2',
        agentType: 'Bash',
        startTime: Date.now(),
        completed: false,
        tools: [],
      });

      store.completeSubAgent(CONV_ID, 'agent-1');

      const agents = useAppStore.getState().subAgents[CONV_ID];
      expect(agents[0].completed).toBe(true);
      expect(agents[1].completed).toBe(false);
    });
  });

  // ==========================================================================
  // tool_start with agentId
  // ==========================================================================

  describe('tool_start with agentId', () => {
    it('routes tool to sub-agent instead of flat activeTools', () => {
      const store = useAppStore.getState();
      store.setStreaming(CONV_ID, true);
      store.addSubAgent(CONV_ID, {
        agentId: 'agent-1',
        agentType: 'Explore',
        startTime: Date.now(),
        completed: false,
        tools: [],
      });

      // Sub-agent tool
      store.addSubAgentTool(CONV_ID, 'agent-1', {
        id: 'tool-1',
        tool: 'Read',
        startTime: Date.now(),
        agentId: 'agent-1',
      });

      const agents = useAppStore.getState().subAgents[CONV_ID];
      expect(agents[0].tools).toHaveLength(1);
      expect(agents[0].tools[0].tool).toBe('Read');

      // Flat activeTools should be unaffected
      const flatTools = useAppStore.getState().activeTools[CONV_ID] || [];
      expect(flatTools).toHaveLength(0);
    });

    it('still adds to flat activeTools when agentId is absent', () => {
      const store = useAppStore.getState();
      store.setStreaming(CONV_ID, true);

      // Parent agent tool (no agentId)
      store.addActiveTool(CONV_ID, {
        id: 'tool-1',
        tool: 'Bash',
        startTime: Date.now(),
      });

      const flatTools = useAppStore.getState().activeTools[CONV_ID];
      expect(flatTools).toHaveLength(1);
      expect(flatTools[0].tool).toBe('Bash');
    });
  });

  // ==========================================================================
  // tool_end with agentId
  // ==========================================================================

  describe('tool_end with agentId', () => {
    it('completes tool on the correct sub-agent', () => {
      const store = useAppStore.getState();
      store.addSubAgent(CONV_ID, {
        agentId: 'agent-1',
        agentType: 'Explore',
        startTime: Date.now(),
        completed: false,
        tools: [],
      });
      store.addSubAgentTool(CONV_ID, 'agent-1', {
        id: 'tool-1',
        tool: 'Read',
        startTime: Date.now(),
        agentId: 'agent-1',
      });

      store.completeSubAgentTool(CONV_ID, 'agent-1', 'tool-1', true, 'File read', undefined, undefined);

      const agents = useAppStore.getState().subAgents[CONV_ID];
      const tool = agents[0].tools[0];
      expect(tool.endTime).toBeDefined();
      expect(tool.success).toBe(true);
      expect(tool.summary).toBe('File read');
    });

    it('still completes in flat activeTools when agentId is absent', () => {
      const store = useAppStore.getState();
      store.setStreaming(CONV_ID, true);
      store.addActiveTool(CONV_ID, {
        id: 'tool-1',
        tool: 'Bash',
        startTime: Date.now(),
      });

      store.completeActiveTool(CONV_ID, 'tool-1', true, 'done');

      const flatTools = useAppStore.getState().activeTools[CONV_ID];
      expect(flatTools[0].endTime).toBeDefined();
      expect(flatTools[0].success).toBe(true);
    });
  });

  // ==========================================================================
  // result/complete/interrupted events with sub-agents
  // ==========================================================================

  describe('result event with sub-agents', () => {
    it('clears sub-agents via finalizeStreamingMessage', () => {
      const store = useAppStore.getState();
      store.setStreaming(CONV_ID, true);
      store.appendStreamingText(CONV_ID, 'some text');
      store.addSubAgent(CONV_ID, {
        agentId: 'agent-1',
        agentType: 'Explore',
        startTime: Date.now(),
        completed: true,
        tools: [],
      });

      // Simulates what the result handler does
      store.finalizeStreamingMessage(CONV_ID, { durationMs: 1000 });

      const agents = useAppStore.getState().subAgents[CONV_ID];
      expect(agents).toHaveLength(0);
    });
  });

  describe('complete event with sub-agents', () => {
    it('clears sub-agents state', () => {
      const store = useAppStore.getState();
      store.setStreaming(CONV_ID, true);
      store.addSubAgent(CONV_ID, {
        agentId: 'agent-1',
        agentType: 'Explore',
        startTime: Date.now(),
        completed: false,
        tools: [],
      });

      // Simulates: case 'complete'
      store.clearStreamingText(CONV_ID);
      store.setStreaming(CONV_ID, false);
      store.clearActiveTools(CONV_ID);
      store.clearThinking(CONV_ID);
      store.clearSubAgents(CONV_ID);

      expect(useAppStore.getState().subAgents[CONV_ID]).toHaveLength(0);
    });
  });

  describe('interrupted event with sub-agents', () => {
    it('clears sub-agents state alongside everything else', () => {
      const store = useAppStore.getState();
      store.setStreaming(CONV_ID, true);
      store.appendStreamingText(CONV_ID, 'text');
      store.addActiveTool(CONV_ID, { id: 'tool-1', tool: 'Bash', startTime: Date.now() });
      store.addSubAgent(CONV_ID, {
        agentId: 'agent-1',
        agentType: 'Explore',
        startTime: Date.now(),
        completed: false,
        tools: [],
      });

      // Simulates: case 'interrupted'
      store.clearStreamingText(CONV_ID);
      store.setStreaming(CONV_ID, false);
      store.clearActiveTools(CONV_ID);
      store.clearThinking(CONV_ID);
      store.clearSubAgents(CONV_ID);
      store.updateConversation(CONV_ID, { status: 'idle' });

      const state = useAppStore.getState();
      expect(state.subAgents[CONV_ID]).toHaveLength(0);
      expect(state.activeTools[CONV_ID]).toHaveLength(0);
      expect(state.streamingState[CONV_ID]?.isStreaming).toBe(false);
    });
  });

  // ==========================================================================
  // Full lifecycle
  // ==========================================================================

  describe('full lifecycle', () => {
    it('tracks multiple sub-agents with interleaved tool events', () => {
      const store = useAppStore.getState();
      store.setStreaming(CONV_ID, true);

      // subagent_started x2
      store.addSubAgent(CONV_ID, {
        agentId: 'agent-A',
        agentType: 'Explore',
        startTime: Date.now(),
        completed: false,
        tools: [],
      });
      store.addSubAgent(CONV_ID, {
        agentId: 'agent-B',
        agentType: 'Bash',
        startTime: Date.now(),
        completed: false,
        tools: [],
      });

      // tool_start(agentA)
      store.addSubAgentTool(CONV_ID, 'agent-A', {
        id: 'tool-a1',
        tool: 'Grep',
        startTime: Date.now(),
        agentId: 'agent-A',
      });

      // tool_start(agentB)
      store.addSubAgentTool(CONV_ID, 'agent-B', {
        id: 'tool-b1',
        tool: 'Bash',
        startTime: Date.now(),
        agentId: 'agent-B',
      });

      // tool_end(agentA)
      store.completeSubAgentTool(CONV_ID, 'agent-A', 'tool-a1', true, 'found matches');

      // subagent_stopped(agentA)
      store.completeSubAgent(CONV_ID, 'agent-A');

      // tool_end(agentB)
      store.completeSubAgentTool(CONV_ID, 'agent-B', 'tool-b1', true, 'command executed');

      // subagent_stopped(agentB)
      store.completeSubAgent(CONV_ID, 'agent-B');

      const agents = useAppStore.getState().subAgents[CONV_ID];
      expect(agents).toHaveLength(2);

      // Agent A
      expect(agents[0].completed).toBe(true);
      expect(agents[0].tools).toHaveLength(1);
      expect(agents[0].tools[0].success).toBe(true);

      // Agent B
      expect(agents[1].completed).toBe(true);
      expect(agents[1].tools).toHaveLength(1);
      expect(agents[1].tools[0].success).toBe(true);
    });
  });
});
