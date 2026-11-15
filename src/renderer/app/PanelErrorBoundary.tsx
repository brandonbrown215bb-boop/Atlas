import { Component, type ComponentType, type ErrorInfo, type FunctionComponent, type ReactNode } from 'react';

export class PanelErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Atlas panel failed:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <div role="alert" aria-label="Panel error" style={{ padding: 16, overflow: 'auto', height: '100%' }}>
      <p>This panel stopped because of an error. Your world is still open.</p>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{this.state.error.stack ?? this.state.error.message}</pre>
      <p>You can undo the last change or save from the toolbar, then retry this panel.</p>
      <button onClick={() => this.setState({ error: null })}>Retry panel</button>
    </div>;
  }
}

export function recoverablePanel<P extends object>(Panel: ComponentType<P>): FunctionComponent<P> {
  return function RecoverablePanel(props: P) {
    return <PanelErrorBoundary><Panel {...props} /></PanelErrorBoundary>;
  };
}
