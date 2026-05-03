import React from 'react';

interface Props {
  onRetry?: () => void;
  children: React.ReactNode;
}
interface State {
  err: Error | null;
}

/**
 * Catches any render-time crash inside the mind-map renderer (bad layout
 * input, NaN coordinates, etc.) so the whole lecture page doesn't go blank.
 */
export class MindMapErrorBoundary extends React.Component<Props, State> {
  state: State = { err: null };

  static getDerivedStateFromError(err: Error): State {
    return { err };
  }

  componentDidCatch(err: Error) {
    console.error('MindMap render crash:', err);
  }

  reset = () => {
    this.setState({ err: null });
    this.props.onRetry?.();
  };

  render() {
    if (this.state.err) {
      return (
        <div
          data-testid="mindmap-error"
          className="flex flex-col items-center justify-center py-12 gap-4 text-center"
        >
          <div className="text-3xl">🛟</div>
          <div>
            <p className="text-sm font-bold text-foreground mb-1">
              The mind map could not be drawn
            </p>
            <p className="text-xs text-muted-foreground max-w-xs">
              The cached structure was malformed. Try regenerating it.
            </p>
          </div>
          <button
            onClick={this.reset}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-primary text-white hover:opacity-90"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
