'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { type WorkflowJobDTO, type CIAnalysisResult, getCIJobLogs } from '@/lib/api';
import { copyToClipboard } from '@/lib/tauri';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import {
  X,
  ChevronDown,
  ChevronRight,
  Loader2,
  FileCode,
  AlertTriangle,
  Lightbulb,
  ClipboardCopy,
  Check,
  RotateCcw,
} from 'lucide-react';

interface CIFailureAnalysisProps {
  workspaceId: string;
  sessionId: string;
  runId: number;
  job: WorkflowJobDTO;
  onClose: () => void;
  onAnalyze: (runId: number, jobId: number) => Promise<unknown>;
}

export function CIFailureAnalysis({
  workspaceId,
  sessionId,
  runId,
  job,
  onClose,
  onAnalyze,
}: CIFailureAnalysisProps) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<CIAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  // Use ref to avoid stale closure issues with onAnalyze callback
  const onAnalyzeRef = useRef(onAnalyze);
  onAnalyzeRef.current = onAnalyze;

  // Shared fetch logic for both initial load and retry
  const fetchAnalysisData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch logs and analysis in parallel
      const [logsResult, analysisResult] = await Promise.all([
        getCIJobLogs(workspaceId, sessionId, job.id),
        onAnalyzeRef.current(runId, job.id),
      ]);

      setLogs(logsResult.logs);
      setAnalysis(analysisResult as CIAnalysisResult);
    } catch (err) {
      console.error('Failed to fetch CI data:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch CI data');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, sessionId, runId, job.id]);

  // Fetch logs and analysis on mount
  useEffect(() => {
    fetchAnalysisData();
  }, [fetchAnalysisData]);

  const handleCopyLogs = async () => {
    if (!logs) return;
    const success = await copyToClipboard(logs);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      toast.error('Failed to copy logs to clipboard');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border rounded-lg shadow-lg w-full max-w-3xl max-h-[80vh] flex flex-col m-4">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            <h2 className="font-semibold">CI Failure Analysis</h2>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {/* Job info */}
          <div className="text-sm">
            <span className="text-muted-foreground">Job:</span>{' '}
            <span className="font-medium">{job.name}</span>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin mb-4" />
              <p>Analyzing failure...</p>
              <p className="text-xs mt-1">Fetching logs and generating analysis</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12">
              <p className="text-destructive mb-4">{error}</p>
              <Button variant="outline" size="sm" onClick={fetchAnalysisData}>
                <RotateCcw className="h-3 w-3 mr-1" />
                Retry
              </Button>
            </div>
          ) : (
            <>
              {/* Analysis summary */}
              {analysis && (
                <div className="space-y-3">
                  {/* Summary */}
                  <div className="bg-surface-1 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <AlertTriangle className="h-4 w-4 text-red-500" />
                      <span className="font-medium text-sm">Summary</span>
                    </div>
                    <p className="text-sm">{analysis.summary || 'No summary available'}</p>
                  </div>

                  {/* Root cause */}
                  {analysis.rootCause && (
                    <div className="bg-surface-1 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Lightbulb className="h-4 w-4 text-yellow-500" />
                        <span className="font-medium text-sm">Root Cause</span>
                      </div>
                      <p className="text-sm">{analysis.rootCause}</p>
                    </div>
                  )}

                  {/* Affected files */}
                  {analysis.affectedFiles && analysis.affectedFiles.length > 0 && (
                    <div className="bg-surface-1 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <FileCode className="h-4 w-4 text-blue-500" />
                        <span className="font-medium text-sm">Affected Files</span>
                      </div>
                      <div className="space-y-1">
                        {analysis.affectedFiles.map((file, i) => (
                          <div key={i} className="text-xs text-muted-foreground font-mono">
                            {file}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Suggested fix */}
                  {analysis.suggestedFix && (
                    <div className="bg-surface-1 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Lightbulb className="h-4 w-4 text-green-500" />
                        <span className="font-medium text-sm">Suggested Fix</span>
                      </div>
                      <p className="text-sm mb-2">{analysis.suggestedFix.description}</p>
                      {analysis.suggestedFix.patches.length > 0 && (
                        <div className="space-y-2">
                          {analysis.suggestedFix.patches.map((patch, i) => (
                            <div key={i} className="text-xs">
                              <div className="font-mono text-muted-foreground mb-1">
                                {patch.file}
                              </div>
                              <pre className="bg-surface-2 p-2 rounded text-xs overflow-x-auto">
                                {patch.diff}
                              </pre>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Confidence */}
                  {analysis.confidence > 0 && (
                    <div className="text-xs text-muted-foreground">
                      Analysis confidence: {Math.round(analysis.confidence * 100)}%
                    </div>
                  )}
                </div>
              )}

              {/* Raw logs (collapsible) */}
              {logs && (
                <div className="border rounded-lg">
                  <div
                    role="button"
                    tabIndex={0}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-surface-1 cursor-pointer"
                    onClick={() => setLogsExpanded(!logsExpanded)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setLogsExpanded(!logsExpanded);
                      }
                    }}
                  >
                    {logsExpanded ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                    <span className="font-medium">Raw Logs</span>
                    <span className="text-xs text-muted-foreground">
                      ({logs.split('\n').length} lines)
                    </span>
                    <div className="flex-1" />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopyLogs();
                      }}
                    >
                      {copied ? (
                        <>
                          <Check className="h-3 w-3 mr-1" />
                          Copied
                        </>
                      ) : (
                        <>
                          <ClipboardCopy className="h-3 w-3 mr-1" />
                          Copy
                        </>
                      )}
                    </Button>
                  </div>
                  {logsExpanded && (
                    <div className="border-t">
                      <pre className="p-3 text-xs font-mono overflow-auto max-h-64 bg-surface-1">
                        {logs}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
