import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '@/stores/appStore';

/**
 * Tests for sub-agent state management in appStore.
 * Covers addSubAgent, completeSubAgent, addSubAgentTool,
 * completeSubAgentTool, clearSubAgents, and updateToolProgress.
 */

const CONV_ID = 'conv-1';
const CONV_ID_2 = 'conv-2';

describe('appStore — sub-agent state', () => {
  beforeEach(() => {
    useAppStore.setState({
      subAgents: {},
      activeTools: {},
      streamingState: {},
    });
  });

  // ==========================================================================
  // addSubAgent
  // ==========================================================================

  describe('addSubAgent', () => {
    it('creates sub-agent entry with correct fields', () => {
      useAppStore.getState().addSubAgent(CONV_ID, {
        agentId: 'agent-1',
        agentType: 'Explore',
        parentToolUseId: 'toolu_abc',
        startTime: 1000,
        completed: false,
        tools: [],
      });

      const agents = useAppStore.getState().subAgents[CONV_ID];
      expect(agents).toHaveLength(1);
      expect(agents[0]).toEqual({
        agentId: 'agent-1',
        agentType: 'Explore',
        parentToolUseId: 'toolu_abc',
        startTime: 1000,
        completed: false,
        tools: [],
      });
    });

    it('appends to existing sub-agents for same conversation', () => {
      const store = useAppStore.getState();
      store.addSubAgent(CONV_ID, {
        agentId: 'agent-1',
        agentType: 'Explore',
        startTime: 1000,
        completed: false,
        tools: [],
      });
      store.addSubAgent(CONV_ID, {
        agentId: 'agent-2',
        agentType: 'Bash',
        startTime: 2000,
        completed: false,
        tools: [],
      });

      expect(useAppStore.getState().subAgents[CONV_ID]).toHaveLength(2);
    });

    it('isolates sub-agents by conversation id', () => {
      const store = useAppStore.getState();
      store.addSubAgent(CONV_ID, {
        agentId: 'agent-1',
        agentType: 'Explore',
        startTime: 1000,
        completed: false,
        tools: [],
      });
      store.addSubAgent(CONV_ID_2, {
        agentId: 'agent-2',
        agentType: 'Bash',
        startTime: 2000,
        completed: false,
        tools: [],
      });

      expect(useAppStore.getState().subAgents[CONV_ID]).toHaveLength(1);
      expect(useAppStore.getState().subAgents[CONV_ID_2]).toHaveLength(1);
    });
  });

  // ==========================================================================
  // completeSubAgent
  // ==========================================================================

  describe('completeSubAgent', () => {
    it('sets completed=true and endTime', () => {
      const store = useAppStore.getState();
      store.addSubAgent(CONV_ID, {
        agentId: 'agent-1',
        agentType: 'Explore',
        startTime: 1000,
        completed: false,
        tools: [],
      });

      store.completeSubAgent(CONV_ID, 'agent-1');

      const agent = useAppStore.getState().subAgents[CONV_ID][0];
      expect(agent.completed).toBe(true);
      expect(agent.endTime).toBeGreaterThan(0);
    });

    it('does nothing for unknown agentId', () => {
      const store = useAppStore.getState();
      store.addSubAgent(CONV_ID, {
        agentId: 'agent-1',
        agentType: 'Explore',
        startTime: 1000,
        completed: false,
        tools: [],
      });

      store.completeSubAgent(CONV_ID, 'agent-unknown');

      const agent = useAppStore.getState().subAgents[CONV_ID][0];
      expect(agent.completed).toBe(false);
    });
  });

  // ==========================================================================
  // addSubAgentTool
  // ==========================================================================

  describe('addSubAgentTool', () => {
    it('adds tool to correct sub-agent', () => {
      const store = useAppStore.getState();
      store.addSubAgent(CONV_ID, {
        agentId: 'agent-1',
        agentType: 'Explore',
        startTime: 1000,
        completed: false,
        tools: [],
      });

      store.addSubAgentTool(CONV_ID, 'agent-1', {
        id: 'tool-1',
        tool: 'Read',
        startTime: Date.now(),
        agentId: 'agent-1',
      });

      const agent = useAppStore.getState().subAgents[CONV_ID][0];
      expect(agent.tools).toHaveLength(1);
      expect(agent.tools[0].tool).toBe('Read');
    });

    it('does nothing for unknown agentId', () => {
      const store = useAppStore.getState();
      store.addSubAgent(CONV_ID, {
        agentId: 'agent-1',
        agentType: 'Explore',
        startTime: 1000,
        completed: false,
        tools: [],
      });

      store.addSubAgentTool(CONV_ID, 'agent-unknown', {
        id: 'tool-1',
        tool: 'Read',
        startTime: Date.now(),
        agentId: 'agent-unknown',
      });

      const agent = useAppStore.getState().subAgents[CONV_ID][0];
      expect(agent.tools).toHaveLength(0);
    });

    it('handles multiple tools on same sub-agent', () => {
      const store = useAppStore.getState();
      store.addSubAgent(CONV_ID, {
        agentId: 'agent-1',
        agentType: 'Explore',
        startTime: 1000,
        completed: false,
        tools: [],
      });

      store.addSubAgentTool(CONV_ID, 'agent-1', {
        id: 'tool-1',
        tool: 'Read',
        startTime: Date.now(),
        agentId: 'agent-1',
      });
      store.addSubAgentTool(CONV_ID, 'agent-1', {
        id: 'tool-2',
        tool: 'Grep',
        startTime: Date.now(),
        agentId: 'agent-1',
      });

      const agent = useAppStore.getState().subAgents[CONV_ID][0];
      expect(agent.tools).toHaveLength(2);
    });
  });

  // ==========================================================================
  // completeSubAgentTool
  // ==========================================================================

  describe('completeSubAgentTool', () => {
    it('marks tool as complete with success/summary/endTime', () => {
      const store = useAppStore.getState();
      store.addSubAgent(CONV_ID, {
        agentId: 'agent-1',
        agentType: 'Explore',
        startTime: 1000,
        completed: false,
        tools: [],
      });
      store.addSubAgentTool(CONV_ID, 'agent-1', {
        id: 'tool-1',
        tool: 'Read',
        startTime: Date.now(),
        agentId: 'agent-1',
      });

      store.completeSubAgentTool(CONV_ID, 'agent-1', 'tool-1', true, 'File contents read');

      const tool = useAppStore.getState().subAgents[CONV_ID][0].tools[0];
      expect(tool.success).toBe(true);
      expect(tool.summary).toBe('File contents read');
      expect(tool.endTime).toBeGreaterThan(0);
    });

    it('captures stdout/stderr for Bash tools', () => {
      const store = useAppStore.getState();
      store.addSubAgent(CONV_ID, {
        agentId: 'agent-1',
        agentType: 'Bash',
        startTime: 1000,
        completed: false,
        tools: [],
      });
      store.addSubAgentTool(CONV_ID, 'agent-1', {
        id: 'tool-1',
        tool: 'Bash',
        startTime: Date.now(),
        agentId: 'agent-1',
      });

      store.completeSubAgentTool(CONV_ID, 'agent-1', 'tool-1', true, 'done', 'hello world', 'warn: something');

      const tool = useAppStore.getState().subAgents[CONV_ID][0].tools[0];
      expect(tool.stdout).toBe('hello world');
      expect(tool.stderr).toBe('warn: something');
    });

    it('does nothing for unknown agentId or toolId', () => {
      const store = useAppStore.getState();
      store.addSubAgent(CONV_ID, {
        agentId: 'agent-1',
        agentType: 'Explore',
        startTime: 1000,
        completed: false,
        tools: [{ id: 'tool-1', tool: 'Read', startTime: 1000, agentId: 'agent-1' }],
      });

      // Unknown agentId
      store.completeSubAgentTool(CONV_ID, 'agent-unknown', 'tool-1', true, 'done');
      const tool1 = useAppStore.getState().subAgents[CONV_ID][0].tools[0];
      expect(tool1.endTime).toBeUndefined();

      // Unknown toolId
      store.completeSubAgentTool(CONV_ID, 'agent-1', 'tool-unknown', true, 'done');
      const tool2 = useAppStore.getState().subAgents[CONV_ID][0].tools[0];
      expect(tool2.endTime).toBeUndefined();
    });
  });

  // ==========================================================================
  // clearSubAgents
  // ==========================================================================

  describe('clearSubAgents', () => {
    it('removes all sub-agents for conversation', () => {
      const store = useAppStore.getState();
      store.addSubAgent(CONV_ID, {
        agentId: 'agent-1',
        agentType: 'Explore',
        startTime: 1000,
        completed: false,
        tools: [],
      });
      store.addSubAgent(CONV_ID, {
        agentId: 'agent-2',
        agentType: 'Bash',
        startTime: 2000,
        completed: false,
        tools: [],
      });

      store.clearSubAgents(CONV_ID);

      expect(useAppStore.getState().subAgents[CONV_ID]).toHaveLength(0);
    });

    it('does not affect other conversations', () => {
      const store = useAppStore.getState();
      store.addSubAgent(CONV_ID, {
        agentId: 'agent-1',
        agentType: 'Explore',
        startTime: 1000,
        completed: false,
        tools: [],
      });
      store.addSubAgent(CONV_ID_2, {
        agentId: 'agent-2',
        agentType: 'Bash',
        startTime: 2000,
        completed: false,
        tools: [],
      });

      store.clearSubAgents(CONV_ID);

      expect(useAppStore.getState().subAgents[CONV_ID]).toHaveLength(0);
      expect(useAppStore.getState().subAgents[CONV_ID_2]).toHaveLength(1);
    });
  });

  // ==========================================================================
  // updateToolProgress
  // ==========================================================================

  describe('updateToolProgress', () => {
    it('sets elapsedSeconds on matching active tool', () => {
      const store = useAppStore.getState();
      store.setStreaming(CONV_ID, true);
      store.addActiveTool(CONV_ID, {
        id: 'tool-1',
        tool: 'Bash',
        startTime: Date.now(),
      });

      store.updateToolProgress(CONV_ID, 'tool-1', { elapsedTimeSeconds: 15 });

      const tool = useAppStore.getState().activeTools[CONV_ID][0];
      expect(tool.elapsedSeconds).toBe(15);
    });

    it('does nothing for unknown tool id', () => {
      const store = useAppStore.getState();
      store.setStreaming(CONV_ID, true);
      store.addActiveTool(CONV_ID, {
        id: 'tool-1',
        tool: 'Bash',
        startTime: Date.now(),
      });

      store.updateToolProgress(CONV_ID, 'tool-unknown', { elapsedTimeSeconds: 15 });

      const tool = useAppStore.getState().activeTools[CONV_ID][0];
      expect(tool.elapsedSeconds).toBeUndefined();
    });
  });
});
