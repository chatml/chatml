package git

// PreflightStatus reports git state issues that block base session usage.
type PreflightStatus struct {
	OK               bool   `json:"ok"`
	ActiveRebase     bool   `json:"activeRebase,omitempty"`
	ActiveMerge      bool   `json:"activeMerge,omitempty"`
	ActiveCherryPick bool   `json:"activeCherryPick,omitempty"`
	DetachedHead     bool   `json:"detachedHead,omitempty"`
	CorruptedIndex   bool   `json:"corruptedIndex,omitempty"`
	ErrorMessage     string `json:"errorMessage,omitempty"`
}

// StashEntry represents a single git stash entry.
type StashEntry struct {
	Index   int    `json:"index"`
	Branch  string `json:"branch"`
	Message string `json:"message"`
}
