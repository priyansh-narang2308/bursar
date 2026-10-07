import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

// Mock framer-motion to prevent jsdom crashes on CI
import React from 'react';
import { vi } from 'vitest';

vi.mock('framer-motion', async (importOriginal) => {
  // biome-ignore lint/suspicious/noExplicitAny: mock
  const actual = await importOriginal<any>();
  return {
    ...actual,
    motion: new Proxy(
      {},
      {
        get: (_, key) => {
          // Return a proxy component that strips animation props
          // biome-ignore lint/suspicious/noExplicitAny: mock
          return React.forwardRef((props: any, ref) => {
            const {
              initial,
              animate,
              exit,
              transition,
              whileHover,
              whileTap,
              whileFocus,
              whileDrag,
              whileInView,
              viewport,
              variants,
              custom,
              layout,
              layoutId,
              onAnimationStart,
              onAnimationComplete,
              onUpdate,
              onDragStart,
              onDrag,
              onDragEnd,
              onDirectionLock,
              ...validProps
            } = props;
            return React.createElement(key as string, { ...validProps, ref });
          });
        },
      },
    ),
  };
});
