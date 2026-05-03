import React from "react";

type ViewErrorBoundaryProps = {
  resetKey: string;
  children: React.ReactNode;
};

type ViewErrorBoundaryState = {
  error: Error | null;
};

export class ViewErrorBoundary extends React.Component<
  ViewErrorBoundaryProps,
  ViewErrorBoundaryState
> {
  state: ViewErrorBoundaryState = {
    error: null,
  };

  static getDerivedStateFromError(error: Error): ViewErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("View render failed", error, errorInfo);
  }

  componentDidUpdate(prevProps: ViewErrorBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <section className="panel error-panel">
          <div className="panel__title-row">
            <h2>View Failed to Render</h2>
          </div>
          <p className="error-panel__message">{this.state.error.message}</p>
          <p className="error-panel__hint">
            Switch tabs or refresh after the underlying issue is fixed.
          </p>
        </section>
      );
    }

    return this.props.children;
  }
}
