import { useEffect, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';

export function PanelHeaderBar(props: {
  title: string;
  panelProps: IDockviewPanelProps;
}) {
  const [isPopout, setIsPopout] = useState(
    () => props.panelProps.api.location.type === 'popout',
  );

  useEffect(() => {
    const disposable = props.panelProps.api.onDidLocationChange((event) => {
      setIsPopout(event.location.type === 'popout');
    });
    return () => disposable.dispose();
  }, [props.panelProps.api]);

  const handlePopout = () => {
    const panel = props.panelProps.containerApi.getPanel(props.panelProps.api.id);
    if (panel) {
      void props.panelProps.containerApi.addPopoutGroup(panel);
    }
  };

  const handleDockBack = () => {
    const mainGroup = props.panelProps.containerApi.groups.find(
      (g) => g.api.location.type === 'grid',
    );
    if (mainGroup) {
      props.panelProps.api.moveTo({ group: mainGroup });
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 10px',
        borderBottom: '1px solid var(--atlas-border)',
        background: 'var(--atlas-surface)',
        fontSize: 12,
      }}
    >
      <strong>{props.title}</strong>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
        {!isPopout ? (
          <button
            type="button"
            data-testid={`popout-btn-${props.panelProps.api.id}`}
            onClick={handlePopout}
          >
            Pop out
          </button>
        ) : (
          <button
            type="button"
            data-testid={`dockback-btn-${props.panelProps.api.id}`}
            onClick={handleDockBack}
          >
            Dock back
          </button>
        )}
      </div>
    </div>
  );
}
