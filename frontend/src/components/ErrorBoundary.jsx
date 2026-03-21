import React from 'react';

/**
 * 捕获子树渲染错误，避免整页白屏；用于写作区等关键视图。
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { error, errorInfo: null };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ error, errorInfo });
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', this.props?.context || '', error, errorInfo);
    // #region agent log
    fetch('http://127.0.0.1:7911/ingest/d425475d-29d6-4d24-8a29-340d5c8049ce', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '1d3683' },
      body: JSON.stringify({
        sessionId: '1d3683',
        runId: 'post-fix-2',
        hypothesisId: 'H1',
        location: 'ErrorBoundary.jsx:componentDidCatch',
        message: 'boundary caught render error',
        data: {
          context: this.props?.context || '',
          err: error?.message || String(error),
          stack: (error?.stack || '').slice(0, 800),
        },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion
  }

  handleReset = () => {
    this.setState({ error: null, errorInfo: null });
  };

  render() {
    const { error, errorInfo } = this.state;
    const { children, context = '', fallback } = this.props;

    if (error) {
      if (typeof fallback === 'function') {
        return fallback({ error, errorInfo, reset: this.handleReset });
      }
      return (
        <div
          className="h-full min-h-[200px] w-full flex flex-col items-stretch justify-center p-4 bg-red-50 border-2 border-red-400 text-red-900 overflow-auto"
          role="alert"
        >
          <div className="text-sm font-bold mb-2">
            {context ? `${context} 渲染失败` : '组件渲染失败'}
          </div>
          <div className="text-xs font-mono bg-red-100/80 border border-red-300 rounded p-2 mb-2 break-words">
            {error?.message || String(error)}
          </div>
          {error?.stack && (
            <pre className="text-[10px] leading-snug whitespace-pre-wrap break-all bg-red-950/10 border border-red-300 rounded p-2 max-h-48 overflow-auto">
              {error.stack}
            </pre>
          )}
          {errorInfo?.componentStack && (
            <details className="mt-2 text-[10px] text-red-800">
              <summary className="cursor-pointer font-medium">组件栈</summary>
              <pre className="mt-1 whitespace-pre-wrap break-all max-h-32 overflow-auto">
                {errorInfo.componentStack}
              </pre>
            </details>
          )}
          <button
            type="button"
            onClick={this.handleReset}
            className="mt-3 self-start px-3 py-1.5 text-xs font-medium bg-red-600 text-white rounded hover:bg-red-700"
          >
            重试渲染
          </button>
        </div>
      );
    }

    return children;
  }
}
