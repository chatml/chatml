//go:build windows

package ai

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// ReadClaudeCodeOAuthToken reads the Claude Code OAuth access token from the
// Windows Credential Manager via PowerShell.
func ReadClaudeCodeOAuthToken() (string, error) {
	// Use PowerShell with the built-in Windows CredRead API via P/Invoke.
	// Get-StoredCredential requires a third-party module; this uses only .NET built-ins.
	// keytar stores credentials as Generic credentials with target name
	// "Claude Code-credentials/Claude Code-credentials".
	script := `
Add-Type -Namespace Win32 -Name Cred -MemberDefinition @'
[DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
public static extern bool CredRead(string target, int type, int flags, out IntPtr cred);
[DllImport("advapi32.dll")]
public static extern void CredFree(IntPtr cred);
[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
public struct CREDENTIAL {
    public int Flags; public int Type; public string TargetName; public string Comment;
    public long LastWritten; public int CredentialBlobSize; public IntPtr CredentialBlob;
    public int Persist; public int AttributeCount; public IntPtr Attributes;
    public string TargetAlias; public string UserName;
}
'@
function Read-Cred($target) {
    $ptr = [IntPtr]::Zero
    # type 1 = CRED_TYPE_GENERIC
    if ([Win32.Cred]::CredRead($target, 1, 0, [ref]$ptr)) {
        $c = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [Type][Win32.Cred+CREDENTIAL])
        $bytes = [byte[]]::new($c.CredentialBlobSize)
        [System.Runtime.InteropServices.Marshal]::Copy($c.CredentialBlob, $bytes, 0, $c.CredentialBlobSize)
        [Win32.Cred]::CredFree($ptr)
        return [System.Text.Encoding]::UTF8.GetString($bytes)
    }
    return $null
}
$pw = Read-Cred "Claude Code-credentials/Claude Code-credentials"
if (-not $pw) { $pw = Read-Cred "Claude Code-credentials" }
if (-not $pw) { exit 1 }
$pw
`
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", script)
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("reading credential manager: %w", err)
	}

	password := strings.TrimSpace(string(output))
	if password == "" {
		return "", fmt.Errorf("no credential found in Credential Manager")
	}

	var creds claudeCodeCredentials
	if err := json.Unmarshal([]byte(password), &creds); err != nil {
		return "", fmt.Errorf("parsing credentials JSON: %w", err)
	}

	if creds.ClaudeAiOAuth == nil {
		return "", fmt.Errorf("no claudeAiOauth field in credentials")
	}

	if creds.ClaudeAiOAuth.AccessToken == "" {
		return "", fmt.Errorf("empty access token in credentials")
	}

	if creds.ClaudeAiOAuth.ExpiresAt > 0 {
		expiresAt := time.UnixMilli(creds.ClaudeAiOAuth.ExpiresAt)
		if time.Now().After(expiresAt) {
			return "", fmt.Errorf("OAuth token expired at %s", expiresAt.Format(time.RFC3339))
		}
	}

	return creds.ClaudeAiOAuth.AccessToken, nil
}
