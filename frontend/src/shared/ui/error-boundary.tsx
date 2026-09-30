'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  /** Rendered instead of the children after an error; `reset` renders them again. */
  fallback: (error: unknown, reset: () => void) => ReactNode;
  onError?: (error: unknown, info: ErrorInfo) => void;
  children: ReactNode;
};

/** Catches render errors below it (react-pdf 11 reports load errors this way). */
export class ErrorBoundary extends Component<Props, { error: unknown; failed: boolean }> {
  state = { error: null as unknown, failed: false };

  static getDerivedStateFromError(error: unknown) {
    return { error, failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    this.props.onError?.(error, info);
  }

  reset = () => this.setState({ error: null, failed: false });

  render() {
    return this.state.failed ? this.props.fallback(this.state.error, this.reset) : this.props.children;
  }
}
