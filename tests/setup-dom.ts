// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

/**
 * Global Vitest setup, loaded for every test file regardless of environment.
 * Core tests run under `environment: 'node'` (see vitest.config.ts) and never
 * touch `window`, so everything here is guarded and a no-op for them. UI
 * smoke tests (`tests/ui/*.test.tsx`) opt into a DOM by adding
 * `// @vitest-environment jsdom` as the first line of the file; these
 * polyfills fill the handful of browser APIs Radix UI components (used by
 * `@wealthfolio/ui`) touch that jsdom doesn't implement.
 */
import '@testing-library/jest-dom/vitest';

if (typeof window !== 'undefined') {
  const proto = window.HTMLElement.prototype as HTMLElement & Record<string, unknown>;
  if (typeof proto.hasPointerCapture !== 'function') {
    proto.hasPointerCapture = () => false;
  }
  if (typeof proto.setPointerCapture !== 'function') {
    proto.setPointerCapture = () => {};
  }
  if (typeof proto.releasePointerCapture !== 'function') {
    proto.releasePointerCapture = () => {};
  }
  if (typeof proto.scrollIntoView !== 'function') {
    proto.scrollIntoView = () => {};
  }
  if (typeof window.ResizeObserver === 'undefined') {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  }
}
