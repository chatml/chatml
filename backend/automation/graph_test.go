package automation

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ============================================================================
// ParseGraph
// ============================================================================

func TestParseGraph_EmptyJSON(t *testing.T) {
	g, err := ParseGraph("{}")
	require.NoError(t, err)
	assert.Empty(t, g.Nodes)
	assert.Empty(t, g.Edges)
}

func TestParseGraph_InvalidJSON(t *testing.T) {
	_, err := ParseGraph("not json")
	assert.Error(t, err)
}

func TestParseGraph_NodesOnly(t *testing.T) {
	graphJSON := `{
		"nodes": [
			{"id": "n1", "type": "trigger-manual", "data": {"kind": "trigger-manual", "label": "Start", "config": {}}},
			{"id": "n2", "type": "action-agent", "data": {"kind": "action-agent", "label": "Agent", "config": {"model": "gpt-4"}}}
		],
		"edges": []
	}`

	g, err := ParseGraph(graphJSON)
	require.NoError(t, err)

	assert.Len(t, g.Nodes, 2)
	assert.Equal(t, "trigger-manual", g.Nodes["n1"].Kind)
	assert.Equal(t, "Start", g.Nodes["n1"].Label)
	assert.Equal(t, "action-agent", g.Nodes["n2"].Kind)
	assert.Equal(t, "gpt-4", g.Nodes["n2"].Config["model"])
}

func TestParseGraph_NodesAndEdges(t *testing.T) {
	graphJSON := `{
		"nodes": [
			{"id": "n1", "type": "trigger-manual", "data": {"kind": "trigger-manual", "label": "Start", "config": {}}},
			{"id": "n2", "type": "action-agent", "data": {"kind": "action-agent", "label": "Agent", "config": {}}},
			{"id": "n3", "type": "action-webhook", "data": {"kind": "action-webhook", "label": "Webhook", "config": {}}}
		],
		"edges": [
			{"id": "e1", "source": "n1", "target": "n2"},
			{"id": "e2", "source": "n2", "target": "n3"}
		]
	}`

	g, err := ParseGraph(graphJSON)
	require.NoError(t, err)

	assert.Len(t, g.Nodes, 3)
	assert.Len(t, g.Edges, 2)

	// Check adjacency
	assert.Equal(t, []string{"n2"}, g.OutgoingNodes("n1"))
	assert.Equal(t, []string{"n3"}, g.OutgoingNodes("n2"))
	assert.Empty(t, g.OutgoingNodes("n3"))

	assert.Empty(t, g.IncomingNodes("n1"))
	assert.Equal(t, []string{"n1"}, g.IncomingNodes("n2"))
	assert.Equal(t, []string{"n2"}, g.IncomingNodes("n3"))
}

func TestParseGraph_KindFallsBackToType(t *testing.T) {
	graphJSON := `{
		"nodes": [{"id": "n1", "type": "custom-type", "data": {"label": "Test"}}],
		"edges": []
	}`

	g, err := ParseGraph(graphJSON)
	require.NoError(t, err)
	assert.Equal(t, "custom-type", g.Nodes["n1"].Kind)
}

func TestParseGraph_EdgeLabels(t *testing.T) {
	graphJSON := `{
		"nodes": [
			{"id": "n1", "type": "logic-conditional", "data": {"kind": "logic-conditional", "label": "Check", "config": {}}},
			{"id": "n2", "type": "action-agent", "data": {"kind": "action-agent", "label": "True", "config": {}}},
			{"id": "n3", "type": "action-agent", "data": {"kind": "action-agent", "label": "False", "config": {}}}
		],
		"edges": [
			{"id": "e1", "source": "n1", "target": "n2", "label": "true"},
			{"id": "e2", "source": "n1", "target": "n3", "data": {"label": "false"}}
		]
	}`

	g, err := ParseGraph(graphJSON)
	require.NoError(t, err)

	assert.Equal(t, "true", g.Edges[0].Label)
	assert.Equal(t, "false", g.Edges[1].Label)
}

func TestParseGraph_NilConfig(t *testing.T) {
	graphJSON := `{
		"nodes": [{"id": "n1", "type": "trigger-manual", "data": {"kind": "trigger-manual", "label": "Start"}}],
		"edges": []
	}`

	g, err := ParseGraph(graphJSON)
	require.NoError(t, err)
	assert.NotNil(t, g.Nodes["n1"].Config)
	assert.Empty(t, g.Nodes["n1"].Config)
}

// ============================================================================
// TopologicalSort
// ============================================================================

func TestTopologicalSort_LinearChain(t *testing.T) {
	g := buildGraph(
		[]nodeSpec{{"n1", "trigger-manual"}, {"n2", "action-agent"}, {"n3", "action-webhook"}},
		[][2]string{{"n1", "n2"}, {"n2", "n3"}},
	)

	sorted, err := g.TopologicalSort()
	require.NoError(t, err)
	assert.Equal(t, []string{"n1", "n2", "n3"}, sorted)
}

func TestTopologicalSort_Diamond(t *testing.T) {
	// n1 → n2, n1 → n3, n2 → n4, n3 → n4
	g := buildGraph(
		[]nodeSpec{{"n1", "trigger-manual"}, {"n2", "action-agent"}, {"n3", "action-agent"}, {"n4", "action-webhook"}},
		[][2]string{{"n1", "n2"}, {"n1", "n3"}, {"n2", "n4"}, {"n3", "n4"}},
	)

	sorted, err := g.TopologicalSort()
	require.NoError(t, err)
	assert.Len(t, sorted, 4)

	// n1 must be first, n4 must be last
	assert.Equal(t, "n1", sorted[0])
	assert.Equal(t, "n4", sorted[3])

	// n2 and n3 are interchangeable in middle
	middle := sorted[1:3]
	assert.Contains(t, middle, "n2")
	assert.Contains(t, middle, "n3")
}

func TestTopologicalSort_SingleNode(t *testing.T) {
	g := buildGraph(
		[]nodeSpec{{"n1", "trigger-manual"}},
		nil,
	)

	sorted, err := g.TopologicalSort()
	require.NoError(t, err)
	assert.Equal(t, []string{"n1"}, sorted)
}

func TestTopologicalSort_EmptyGraph(t *testing.T) {
	g := buildGraph(nil, nil)

	sorted, err := g.TopologicalSort()
	require.NoError(t, err)
	assert.Empty(t, sorted)
}

func TestTopologicalSort_CycleDetection(t *testing.T) {
	g := buildGraph(
		[]nodeSpec{{"n1", "action-agent"}, {"n2", "action-agent"}, {"n3", "action-agent"}},
		[][2]string{{"n1", "n2"}, {"n2", "n3"}, {"n3", "n1"}},
	)

	_, err := g.TopologicalSort()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "cycle")
}

func TestTopologicalSort_SelfLoop(t *testing.T) {
	g := buildGraph(
		[]nodeSpec{{"n1", "action-agent"}},
		[][2]string{{"n1", "n1"}},
	)

	_, err := g.TopologicalSort()
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "cycle")
}

func TestTopologicalSort_DisconnectedComponents(t *testing.T) {
	// Two separate chains: n1→n2, n3→n4
	g := buildGraph(
		[]nodeSpec{{"n1", "trigger-manual"}, {"n2", "action-agent"}, {"n3", "trigger-cron"}, {"n4", "action-webhook"}},
		[][2]string{{"n1", "n2"}, {"n3", "n4"}},
	)

	sorted, err := g.TopologicalSort()
	require.NoError(t, err)
	assert.Len(t, sorted, 4)

	// Within each chain, order must be preserved
	indexOf := func(id string) int {
		for i, s := range sorted {
			if s == id {
				return i
			}
		}
		return -1
	}
	assert.Less(t, indexOf("n1"), indexOf("n2"))
	assert.Less(t, indexOf("n3"), indexOf("n4"))
}

func TestTopologicalSort_FanOut(t *testing.T) {
	// n1 → n2, n3, n4
	g := buildGraph(
		[]nodeSpec{{"n1", "trigger-manual"}, {"n2", "action-agent"}, {"n3", "action-webhook"}, {"n4", "action-script"}},
		[][2]string{{"n1", "n2"}, {"n1", "n3"}, {"n1", "n4"}},
	)

	sorted, err := g.TopologicalSort()
	require.NoError(t, err)
	assert.Len(t, sorted, 4)
	assert.Equal(t, "n1", sorted[0]) // n1 must be first
}

// ============================================================================
// IncomingNodes / OutgoingNodes
// ============================================================================

func TestIncomingNodes_NoIncoming(t *testing.T) {
	g := buildGraph(
		[]nodeSpec{{"n1", "trigger-manual"}, {"n2", "action-agent"}},
		[][2]string{{"n1", "n2"}},
	)

	assert.Empty(t, g.IncomingNodes("n1"))
	assert.Equal(t, []string{"n1"}, g.IncomingNodes("n2"))
}

func TestOutgoingNodes_MultipleTargets(t *testing.T) {
	g := buildGraph(
		[]nodeSpec{{"n1", "trigger-manual"}, {"n2", "action-agent"}, {"n3", "action-webhook"}},
		[][2]string{{"n1", "n2"}, {"n1", "n3"}},
	)

	assert.Equal(t, []string{"n2", "n3"}, g.OutgoingNodes("n1"))
}

func TestIncomingNodes_NonExistent(t *testing.T) {
	g := buildGraph(nil, nil)
	assert.Empty(t, g.IncomingNodes("does-not-exist"))
}

// ============================================================================
// ParseGraph round-trip: build graph JSON from real React Flow format
// ============================================================================

func TestParseGraph_RoundTrip(t *testing.T) {
	original := map[string]interface{}{
		"nodes": []interface{}{
			map[string]interface{}{
				"id":       "n1",
				"type":     "trigger-manual",
				"position": map[string]interface{}{"x": 0, "y": 0},
				"data": map[string]interface{}{
					"kind":   "trigger-manual",
					"label":  "Start",
					"config": map[string]interface{}{},
				},
			},
		},
		"edges": []interface{}{},
	}

	jsonBytes, err := json.Marshal(original)
	require.NoError(t, err)

	g, err := ParseGraph(string(jsonBytes))
	require.NoError(t, err)
	assert.Len(t, g.Nodes, 1)
	assert.Equal(t, "trigger-manual", g.Nodes["n1"].Kind)
}

// ============================================================================
// Test helpers
// ============================================================================

type nodeSpec struct {
	id   string
	kind string
}

func buildGraph(nodes []nodeSpec, edges [][2]string) *Graph {
	g := &Graph{
		Nodes:    make(map[string]*GraphNode),
		outgoing: make(map[string][]string),
		incoming: make(map[string][]string),
	}

	for _, n := range nodes {
		g.Nodes[n.id] = &GraphNode{
			ID:     n.id,
			Kind:   n.kind,
			Label:  n.id,
			Config: make(map[string]interface{}),
		}
	}

	for _, e := range edges {
		g.Edges = append(g.Edges, &GraphEdge{
			ID:     e[0] + "-" + e[1],
			Source: e[0],
			Target: e[1],
		})
		g.outgoing[e[0]] = append(g.outgoing[e[0]], e[1])
		g.incoming[e[1]] = append(g.incoming[e[1]], e[0])
	}

	return g
}
