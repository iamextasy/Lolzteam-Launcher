import { Component, type ErrorInfo, type PropsWithChildren } from 'react';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<PropsWithChildren, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // surface in DevTools as well as on screen
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: '32px',
            fontFamily: 'JetBrains Mono, ui-monospace, monospace',
            color: '#eaeaea',
            background: '#141414',
            minHeight: '100vh',
            whiteSpace: 'pre-wrap',
          }}
        >
          <h2 style={{ color: '#ea4c4c', marginBottom: 16 }}>Renderer crash</h2>
          <div style={{ color: '#00ba78', marginBottom: 12 }}>{this.state.error.message}</div>
          <pre style={{ fontSize: 12, opacity: 0.8 }}>{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}
