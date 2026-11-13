import { useEffect, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';

type AgentServerInfo = Awaited<ReturnType<typeof window.atlasApi.getAgentInfo>>;

export function SettingsPanel(props: IDockviewPanelProps) {
  const [info, setInfo] = useState<AgentServerInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void window.atlasApi.getAgentInfo().then(setInfo);
  }, []);

  const toggleEnabled = async () => {
    if (!info) return;
    const next = await window.atlasApi.setAgentEnabled(!info.enabled);
    setInfo(next);
  };

  const configSnippet = info
    ? JSON.stringify(
        {
          mcpServers: {
            'campaign-atlas': {
              url: info.url,
              headers: {
                Authorization: `Bearer ${info.token}`,
              },
            },
          },
        },
        null,
        2,
      )
    : '';

  const copySnippet = () => {
    if (!configSnippet) return;
    void navigator.clipboard.writeText(configSnippet).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div
      data-testid={`panel-${props.api.id}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        background: 'var(--atlas-bg)',
        color: 'var(--atlas-text)',
        fontSize: 12,
      }}
    >
      <div
        style={{
          padding: '6px 10px',
          borderBottom: '1px solid var(--atlas-border)',
          background: 'var(--atlas-surface)',
          fontWeight: 600,
        }}
      >
        Settings — Agent MCP Server
      </div>
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!info ? (
          <span>Loading…</span>
        ) : (
          <>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                data-testid="toggle-agent-server"
                checked={info.enabled}
                onChange={() => void toggleEnabled()}
              />
              <span>Enable localhost MCP agent server</span>
            </label>
            <div>
              <strong>URL:</strong> <code data-testid="agent-url">{info.url}</code>
            </div>
            <div>
              <strong>Token:</strong>{' '}
              <code data-testid="agent-token" style={{ wordBreak: 'break-all' }}>
                {info.token}
              </code>
            </div>
            <div>
              <div style={{ marginBottom: 4 }}>
                <strong>MCP Client Config:</strong>
              </div>
              <pre
                style={{
                  margin: 0,
                  padding: 8,
                  background: 'var(--atlas-surface)',
                  border: '1px solid var(--atlas-border)',
                  borderRadius: 4,
                  overflowX: 'auto',
                  fontSize: 11,
                }}
              >
                {configSnippet}
              </pre>
              <button
                type="button"
                style={{ marginTop: 6 }}
                onClick={copySnippet}
              >
                {copied ? 'Copied!' : 'Copy Config'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
