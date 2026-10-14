import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** Full-screen layout, for the meeting room. */
  fullScreen?: boolean;
};

type State = { failed: boolean };

/**
 * Catches a crash inside a page and shows a recovery screen instead of a blank page.
 * Give it a changing `key` (e.g. the current page) to clear the error on navigation.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Page crashed:", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div className={`page-error ${this.props.fullScreen ? "is-fullscreen" : ""}`} role="alert">
        <h2>Something went wrong</h2>
        <p>This page hit an unexpected problem. Your account and data are safe. Reloading usually fixes it.</p>
        <div className="page-error-actions">
          <button className="primary-button" onClick={() => window.location.reload()}>Reload page</button>
          <button className="secondary-button" onClick={() => (window.location.href = "/")}>Go to home</button>
        </div>
      </div>
    );
  }
}

export function PageLoading() {
  return (
    <div className="page-loading" role="status" aria-live="polite">
      <span className="banner-spinner" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
