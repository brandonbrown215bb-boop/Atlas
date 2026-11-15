import { Component, type ErrorInfo, type ReactNode } from 'react';
import { flushDirtyWorld } from '../model/persistence';
import { worldStore } from '../model/store';
import { viewStore } from '../model/viewStore';

/** Keep an error outside the individual panels from leaving an empty window. */
export class AppErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null; saveStatus: string }
> {
  state = { error: null as Error | null, saveStatus: '' };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Atlas interface failed:', error, info.componentStack);
  }

  private save = async () => {
    this.setState({ saveStatus: 'Saving…' });
    try {
      await flushDirtyWorld();
      this.setState({ saveStatus: 'World saved.' });
    } catch (error) {
      this.setState({ saveStatus: `Save failed: ${String(error)}` });
    }
  };

  private retry = () => {
    const view = viewStore.getState();
    viewStore.setState({
      panels: Object.fromEntries(Object.entries(view.panels).map(([id, panel]) => [id, { ...panel, camera: null }])),
      selectedEntityIds: [], diagnosticEntityIds: [], fitRequest: null,
    });
    this.setState({ error: null, saveStatus: '' });
  };

  render() {
    if (!this.state.error) return this.props.children;
    const canSave = Boolean(worldStore.getState().worldPath);
    return <main role="alert" aria-label="Atlas error" style={{ padding: 24, height: '100%', boxSizing: 'border-box', overflow: 'auto' }}>
      <h1>Atlas hit an error</h1>
      <p>The interface stopped. Your open world is still in memory.</p>
      <p>
        <button disabled={!canSave} onClick={() => void this.save()}>Save world</button>{' '}
        <button onClick={this.retry}>Reset view and retry</button>
      </p>
      {this.state.saveStatus && <p role="status">{this.state.saveStatus}</p>}
      <pre style={{ whiteSpace: 'pre-wrap' }}>{this.state.error.stack ?? this.state.error.message}</pre>
    </main>;
  }
}
