package automation

import (
	"encoding/json"
	"fmt"
)

// GraphNode represents a parsed React Flow node.
type GraphNode struct {
	ID     string
	Kind   string
	Label  string
	Config map[string]interface{}
}

// GraphEdge represents a parsed React Flow edge.
type GraphEdge struct {
	ID     string
	Source string
	Target string
	Label  string // e.g. "true"/"false" for conditional edges
}

// Graph is the parsed DAG from a workflow's graphJson.
type Graph struct {
	Nodes map[string]*GraphNode
	Edges []*GraphEdge
	// adjacency: nodeID -> list of target nodeIDs
	outgoing map[string][]string
	// reverse adjacency: nodeID -> list of source nodeIDs
	incoming map[string][]string
}

// reactFlowGraph is the JSON shape stored by React Flow.
type reactFlowGraph struct {
	Nodes []reactFlowNode `json:"nodes"`
	Edges []reactFlowEdge `json:"edges"`
}

type reactFlowNode struct {
	ID   string                 `json:"id"`
	Type string                 `json:"type"`
	Data map[string]interface{} `json:"data"`
}

type reactFlowEdge struct {
	ID           string                 `json:"id"`
	Source       string                 `json:"source"`
	Target       string                 `json:"target"`
	SourceHandle string                 `json:"sourceHandle,omitempty"`
	TargetHandle string                 `json:"targetHandle,omitempty"`
	Data         map[string]interface{} `json:"data,omitempty"`
	Label        string                 `json:"label,omitempty"`
}

// ParseGraph converts a React Flow graphJson string into a Graph.
func ParseGraph(graphJSON string) (*Graph, error) {
	var rf reactFlowGraph
	if err := json.Unmarshal([]byte(graphJSON), &rf); err != nil {
		return nil, fmt.Errorf("unmarshal graph: %w", err)
	}

	g := &Graph{
		Nodes:    make(map[string]*GraphNode, len(rf.Nodes)),
		outgoing: make(map[string][]string),
		incoming: make(map[string][]string),
	}

	for _, n := range rf.Nodes {
		kind, _ := n.Data["kind"].(string)
		if kind == "" {
			kind = n.Type
		}
		label, _ := n.Data["label"].(string)
		config, _ := n.Data["config"].(map[string]interface{})
		if config == nil {
			config = make(map[string]interface{})
		}

		g.Nodes[n.ID] = &GraphNode{
			ID:     n.ID,
			Kind:   kind,
			Label:  label,
			Config: config,
		}
	}

	for _, e := range rf.Edges {
		if _, ok := g.Nodes[e.Source]; !ok {
			return nil, fmt.Errorf("edge %s references non-existent source node %s", e.ID, e.Source)
		}
		if _, ok := g.Nodes[e.Target]; !ok {
			return nil, fmt.Errorf("edge %s references non-existent target node %s", e.ID, e.Target)
		}

		edgeLabel := e.Label
		if edgeLabel == "" {
			if data, ok := e.Data["label"].(string); ok {
				edgeLabel = data
			}
		}

		g.Edges = append(g.Edges, &GraphEdge{
			ID:     e.ID,
			Source: e.Source,
			Target: e.Target,
			Label:  edgeLabel,
		})
		g.outgoing[e.Source] = append(g.outgoing[e.Source], e.Target)
		g.incoming[e.Target] = append(g.incoming[e.Target], e.Source)
	}

	return g, nil
}

// IncomingNodes returns the IDs of nodes that have edges leading into nodeID.
func (g *Graph) IncomingNodes(nodeID string) []string {
	return g.incoming[nodeID]
}

// OutgoingNodes returns the IDs of nodes that nodeID has edges leading to.
func (g *Graph) OutgoingNodes(nodeID string) []string {
	return g.outgoing[nodeID]
}

// TopologicalSort returns node IDs in execution order using Kahn's algorithm.
// Returns an error if the graph contains a cycle.
func (g *Graph) TopologicalSort() ([]string, error) {
	// Compute in-degree for each node
	inDegree := make(map[string]int, len(g.Nodes))
	for id := range g.Nodes {
		inDegree[id] = 0
	}
	for _, targets := range g.outgoing {
		for _, t := range targets {
			inDegree[t]++
		}
	}

	// Start with all nodes that have zero in-degree
	var queue []string
	for id, deg := range inDegree {
		if deg == 0 {
			queue = append(queue, id)
		}
	}

	var sorted []string
	for len(queue) > 0 {
		node := queue[0]
		queue = queue[1:]
		sorted = append(sorted, node)

		for _, target := range g.outgoing[node] {
			inDegree[target]--
			if inDegree[target] == 0 {
				queue = append(queue, target)
			}
		}
	}

	if len(sorted) != len(g.Nodes) {
		return nil, fmt.Errorf("graph contains a cycle (%d nodes sorted out of %d)", len(sorted), len(g.Nodes))
	}

	return sorted, nil
}
