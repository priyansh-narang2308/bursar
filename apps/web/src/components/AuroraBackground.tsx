import type { HTMLAttributes, ReactNode } from 'react';

/*
 * A charcoal stage with soft teal, cyan and emerald blooms behind the page's first screen.
 * Adapted from DarkAuroraBackground by opensourceui.in (MIT, Copyright (c) 2026 Bidyut Kundu); the notice is in
 * THIRD_PARTY_NOTICES.md. It is plain CSS here (see `landing.css`) rather than Tailwind, and the blooms sit behind
 * the top of the page and fade out, so the rest of it stays flat and quiet.
 */
export function AuroraBackground({
  children,
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) {
  return (
    <div className={`aurora-stage ${className}`} data-slot="dark-aurora-background" {...props}>
      <div className="aurora" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      {children}
    </div>
  );
}
