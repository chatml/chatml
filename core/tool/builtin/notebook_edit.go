package builtin

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/chatml/chatml-core/tool"
)

// NotebookEditTool modifies Jupyter notebook (.ipynb) cells.
type NotebookEditTool struct {
	workdir     string
	readTracker *tool.ReadTracker
}

// NewNotebookEditTool creates a NotebookEdit tool.
func NewNotebookEditTool(workdir string, tracker *tool.ReadTracker) *NotebookEditTool {
	return &NotebookEditTool{workdir: workdir, readTracker: tracker}
}

func (t *NotebookEditTool) Name() string { return "NotebookEdit" }
func (t *NotebookEditTool) Description() string {
	return `Modifies cells in Jupyter notebooks (.ipynb files). Supports replacing, inserting, and deleting cells.

Usage:
- Use edit_mode "replace" (default) to modify an existing cell's content
- Use edit_mode "insert" to add a new cell after the specified cell_id (requires cell_type)
- Use edit_mode "delete" to remove a cell
- Cell IDs use "cell-N" format (0-indexed) or the notebook's native cell ID
- You MUST read the notebook with the Read tool before editing it`
}

func (t *NotebookEditTool) InputSchema() json.RawMessage {
	return json.RawMessage(`{
		"type": "object",
		"properties": {
			"notebook_path": {
				"type": "string",
				"description": "Absolute path to the .ipynb file"
			},
			"cell_id": {
				"type": "string",
				"description": "Cell ID (cell-N format with 0-based index) or native notebook cell ID"
			},
			"new_source": {
				"type": "string",
				"description": "New content for the cell"
			},
			"cell_type": {
				"type": "string",
				"enum": ["code", "markdown"],
				"description": "Cell type (required for insert mode)"
			},
			"edit_mode": {
				"type": "string",
				"enum": ["replace", "insert", "delete"],
				"description": "Edit mode: replace (default), insert (add new cell after cell_id), or delete"
			}
		},
		"required": ["notebook_path"]
	}`)
}

func (t *NotebookEditTool) IsConcurrentSafe() bool { return false }

func (t *NotebookEditTool) Execute(ctx context.Context, input json.RawMessage) (*tool.Result, error) {
	var in struct {
		NotebookPath string `json:"notebook_path"`
		CellID       string `json:"cell_id"`
		NewSource    string `json:"new_source"`
		CellType     string `json:"cell_type"`
		EditMode     string `json:"edit_mode"`
	}
	if err := json.Unmarshal(input, &in); err != nil {
		return tool.ErrorResult("Invalid input: " + err.Error()), nil
	}

	if in.NotebookPath == "" {
		return tool.ErrorResult("notebook_path is required"), nil
	}

	// Resolve path
	nbPath := in.NotebookPath
	if !filepath.IsAbs(nbPath) {
		nbPath = filepath.Join(t.workdir, nbPath)
	}

	// Validate extension
	if !strings.HasSuffix(strings.ToLower(nbPath), ".ipynb") {
		return tool.ErrorResult("File must have .ipynb extension"), nil
	}

	// Enforce read-before-edit
	if t.readTracker != nil && !t.readTracker.HasBeenRead(nbPath) {
		return tool.ErrorResult("You must read the notebook with the Read tool before editing it"), nil
	}

	// Default mode
	mode := in.EditMode
	if mode == "" {
		mode = "replace"
	}

	// Read notebook
	data, err := os.ReadFile(nbPath)
	if err != nil {
		return tool.ErrorResult("Failed to read notebook: " + err.Error()), nil
	}

	var notebook map[string]interface{}
	if err := json.Unmarshal(data, &notebook); err != nil {
		return tool.ErrorResult("Invalid notebook JSON: " + err.Error()), nil
	}

	cellsRaw, ok := notebook["cells"]
	if !ok {
		return tool.ErrorResult("Notebook has no 'cells' field"), nil
	}
	cells, ok := cellsRaw.([]interface{})
	if !ok {
		return tool.ErrorResult("Invalid 'cells' field"), nil
	}

	switch mode {
	case "replace":
		return t.replaceCell(nbPath, notebook, cells, in.CellID, in.NewSource)
	case "insert":
		return t.insertCell(nbPath, notebook, cells, in.CellID, in.NewSource, in.CellType)
	case "delete":
		return t.deleteCell(nbPath, notebook, cells, in.CellID)
	default:
		return tool.ErrorResult(fmt.Sprintf("Unknown edit_mode: %q", mode)), nil
	}
}

func (t *NotebookEditTool) replaceCell(nbPath string, notebook map[string]interface{}, cells []interface{}, cellID, newSource string) (*tool.Result, error) {
	if cellID == "" {
		return tool.ErrorResult("cell_id is required for replace mode"), nil
	}

	idx, err := t.findCellIndex(cells, cellID)
	if err != nil {
		return tool.ErrorResult(err.Error()), nil
	}

	cell, ok := cells[idx].(map[string]interface{})
	if !ok {
		return tool.ErrorResult("Invalid cell format"), nil
	}

	// Update source (notebooks store source as array of lines)
	cell["source"] = sourceToLines(newSource)

	// Reset execution state for code cells
	if cellType, _ := cell["cell_type"].(string); cellType == "code" {
		cell["execution_count"] = nil
		cell["outputs"] = []interface{}{}
	}

	cells[idx] = cell
	notebook["cells"] = cells

	if err := t.writeNotebook(nbPath, notebook); err != nil {
		return tool.ErrorResult("Failed to write notebook: " + err.Error()), nil
	}

	cellType, _ := cell["cell_type"].(string)
	return tool.TextResult(fmt.Sprintf("Replaced %s cell %s (index %d) in %s", cellType, cellID, idx, nbPath)), nil
}

func (t *NotebookEditTool) insertCell(nbPath string, notebook map[string]interface{}, cells []interface{}, afterCellID, newSource, cellType string) (*tool.Result, error) {
	if cellType == "" {
		return tool.ErrorResult("cell_type is required for insert mode"), nil
	}
	if cellType != "code" && cellType != "markdown" {
		return tool.ErrorResult("cell_type must be 'code' or 'markdown'"), nil
	}

	insertIdx := len(cells) // Default: append at end
	if afterCellID != "" {
		idx, err := t.findCellIndex(cells, afterCellID)
		if err != nil {
			return tool.ErrorResult(err.Error()), nil
		}
		insertIdx = idx + 1
	}

	// Build new cell
	newCell := map[string]interface{}{
		"cell_type": cellType,
		"source":    sourceToLines(newSource),
		"metadata":  map[string]interface{}{},
	}

	if cellType == "code" {
		newCell["execution_count"] = nil
		newCell["outputs"] = []interface{}{}
	}

	// Check if notebook format supports cell IDs (nbformat >= 4.5)
	if nbformat, _ := notebook["nbformat"].(float64); nbformat >= 4 {
		if minor, _ := notebook["nbformat_minor"].(float64); minor >= 5 || nbformat > 4 {
			newCell["id"] = fmt.Sprintf("cell-%d", len(cells))
		}
	}

	// Insert at position
	updated := make([]interface{}, 0, len(cells)+1)
	updated = append(updated, cells[:insertIdx]...)
	updated = append(updated, newCell)
	updated = append(updated, cells[insertIdx:]...)
	notebook["cells"] = updated

	if err := t.writeNotebook(nbPath, notebook); err != nil {
		return tool.ErrorResult("Failed to write notebook: " + err.Error()), nil
	}

	return tool.TextResult(fmt.Sprintf("Inserted new %s cell at index %d in %s", cellType, insertIdx, nbPath)), nil
}

func (t *NotebookEditTool) deleteCell(nbPath string, notebook map[string]interface{}, cells []interface{}, cellID string) (*tool.Result, error) {
	if cellID == "" {
		return tool.ErrorResult("cell_id is required for delete mode"), nil
	}

	idx, err := t.findCellIndex(cells, cellID)
	if err != nil {
		return tool.ErrorResult(err.Error()), nil
	}

	cell, _ := cells[idx].(map[string]interface{})
	cellType, _ := cell["cell_type"].(string)

	// Remove cell — use a new slice to avoid mutating the original backing array
	updated := make([]interface{}, 0, len(cells)-1)
	updated = append(updated, cells[:idx]...)
	updated = append(updated, cells[idx+1:]...)
	notebook["cells"] = updated

	if err := t.writeNotebook(nbPath, notebook); err != nil {
		return tool.ErrorResult("Failed to write notebook: " + err.Error()), nil
	}

	return tool.TextResult(fmt.Sprintf("Deleted %s cell %s (index %d) from %s", cellType, cellID, idx, nbPath)), nil
}

// findCellIndex resolves a cell ID to an index. Supports:
// - "cell-N" format (0-indexed)
// - Native cell ID (matched against cell.id field)
// - Numeric string (treated as index)
func (t *NotebookEditTool) findCellIndex(cells []interface{}, cellID string) (int, error) {
	// Try cell-N format
	if strings.HasPrefix(cellID, "cell-") {
		idxStr := strings.TrimPrefix(cellID, "cell-")
		idx, err := strconv.Atoi(idxStr)
		if err == nil && idx >= 0 && idx < len(cells) {
			return idx, nil
		}
		return -1, fmt.Errorf("cell index %d out of range (notebook has %d cells)", idx, len(cells))
	}

	// Try numeric index
	if idx, err := strconv.Atoi(cellID); err == nil {
		if idx >= 0 && idx < len(cells) {
			return idx, nil
		}
		return -1, fmt.Errorf("cell index %d out of range (notebook has %d cells)", idx, len(cells))
	}

	// Try native cell ID
	for i, c := range cells {
		if cell, ok := c.(map[string]interface{}); ok {
			if id, ok := cell["id"].(string); ok && id == cellID {
				return i, nil
			}
		}
	}

	return -1, fmt.Errorf("cell %q not found", cellID)
}

// sourceToLines converts a source string to the notebook line format
// (array of strings, each ending with \n except possibly the last).
func sourceToLines(source string) []interface{} {
	if source == "" {
		return []interface{}{}
	}
	lines := strings.Split(source, "\n")
	result := make([]interface{}, len(lines))
	for i, line := range lines {
		if i < len(lines)-1 {
			result[i] = line + "\n"
		} else {
			result[i] = line
		}
	}
	return result
}

// writeNotebook serializes and writes the notebook back to disk.
// Uses single-space indent to match the ipynb convention.
func (t *NotebookEditTool) writeNotebook(path string, notebook map[string]interface{}) error {
	data, err := json.MarshalIndent(notebook, "", " ")
	if err != nil {
		return err
	}
	// Ensure trailing newline
	if len(data) > 0 && data[len(data)-1] != '\n' {
		data = append(data, '\n')
	}
	// Preserve original file permissions if the file already exists
	perm := os.FileMode(0644)
	if info, err := os.Stat(path); err == nil {
		perm = info.Mode().Perm()
	}
	return os.WriteFile(path, data, perm)
}
