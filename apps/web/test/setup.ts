import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

// Mock IntersectionObserver for Framer Motion
global.IntersectionObserver = class IntersectionObserver {
  // biome-ignore lint/suspicious/noEmptyBlockStatements: mock
  observe() {}
  // biome-ignore lint/suspicious/noEmptyBlockStatements: mock
  unobserve() {}
  // biome-ignore lint/suspicious/noEmptyBlockStatements: mock
  disconnect() {}
  // biome-ignore lint/suspicious/noExplicitAny: mock
} as any;
