import { useState } from 'react';
import type { GstreamerInstallStatus } from '@shared/types';

interface SetupScreenProps {
  status: GstreamerInstallStatus;
  onRetry: () => Promise<void> | void;
}

export function SetupScreen({ status, onRetry }: SetupScreenProps): JSX.Element {
  const [retrying, setRetrying] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied(null), 1400);
    } catch {
      // Clipboard may be denied in some environments — silent fail.
    }
  }

  async function handleRetry(): Promise<void> {
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  }

  const platformLabel = {
    darwin: 'macOS',
    linux: 'Linux',
    win32: 'Windows',
    unknown: 'your system',
  }[status.platform];

  return (
    <div className="setup-screen">
      <div className="setup-card">
        <div className="setup-icon">⚠</div>
        <h1>GStreamer is not installed</h1>
        <p>
          gst-graph drives video and audio pipelines through GStreamer. We couldn't find{' '}
          <code>gst-inspect-1.0</code> on {platformLabel}.
        </p>

        <h2>Install GStreamer</h2>
        <ol className="setup-steps">
          {status.installCommands.map((cmd) => (
            <li key={cmd.label} className="setup-step">
              <div className="setup-step-label">{cmd.label}</div>
              <div className="setup-cmd-row">
                <code className="setup-cmd">{cmd.command}</code>
                <button
                  className="ghost setup-copy"
                  onClick={() => copy(cmd.command)}
                  title="Copy command"
                >
                  {copied === cmd.command ? 'copied' : 'copy'}
                </button>
              </div>
            </li>
          ))}
        </ol>

        <p className="setup-link">
          Or download directly from{' '}
          <a href={status.downloadUrl} target="_blank" rel="noopener noreferrer">
            gstreamer.freedesktop.org ↗
          </a>
          .
        </p>

        <details className="setup-notes">
          <summary>Tips & required plugin packs</summary>
          <ul>
            <li>
              Most packages need the <strong>base</strong>, <strong>good</strong>, <strong>bad</strong>{' '}
              and <strong>ugly</strong> plugin sets. Install all four for the widest compatibility.
            </li>
            <li>
              On macOS, the Homebrew formula <code>gstreamer</code> pulls all four sets as
              dependencies.
            </li>
            <li>
              On Windows, choose the <strong>Complete</strong> feature set during the installer.
            </li>
            <li>
              On Linux, you may also want <code>gstreamer1.0-libav</code> (or the equivalent) for
              H.264 / AAC encode + decode.
            </li>
          </ul>
        </details>

        {status.diagnostic ? (
          <details className="setup-diag">
            <summary>Diagnostic details</summary>
            <pre>{status.diagnostic}</pre>
          </details>
        ) : null}

        <div className="setup-actions">
          <button className="primary" onClick={handleRetry} disabled={retrying}>
            {retrying ? 'Checking…' : 'Recheck installation'}
          </button>
          <a className="ghost" href="https://github.com/gak4u/gst-graph" target="_blank" rel="noopener noreferrer">
            Project README ↗
          </a>
        </div>
      </div>
    </div>
  );
}
