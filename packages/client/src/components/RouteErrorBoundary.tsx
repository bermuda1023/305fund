import React from 'react';

type Props = {
  children: React.ReactNode;
};

type State = {
  hasError: boolean;
};

export default class RouteErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error('Route render error:', error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{ padding: '2rem', maxWidth: 720, margin: '2rem auto', textAlign: 'center' }}>
        <h2>Something went wrong on this page</h2>
        <p style={{ opacity: 0.8 }}>Please refresh or navigate to another page.</p>
      </div>
    );
  }
}
