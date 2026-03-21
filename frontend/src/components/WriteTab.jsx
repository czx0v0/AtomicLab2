import React from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import { RightColumn } from './RightColumn';

/**
 * 写作界面入口：用错误边界包裹，避免子组件抛错导致整页白屏。
 */
export function WriteTab() {
  return (
    <div className="flex-1 min-h-0 h-full flex flex-col bg-white overflow-hidden">
      <ErrorBoundary context="WriteTab / RightColumn">
        <RightColumn />
      </ErrorBoundary>
    </div>
  );
}
