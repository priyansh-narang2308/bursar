import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface DarkArcBandsBackgroundProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

const DarkArcBandsBackground = forwardRef<HTMLDivElement, DarkArcBandsBackgroundProps>(
  ({ children, className, ...props }, ref) => {
    return (
      <div
        ref={ref}
        data-slot="dark-arc-bands-background"
        className={cn('dark-arc-bands-root', className)}
        {...props}
      >
        <div aria-hidden="true" className="dark-arc-bands-gradient" />
        <div aria-hidden="true" className="dark-arc-band-1" />
        <div aria-hidden="true" className="dark-arc-band-2" />
        <div aria-hidden="true" className="dark-arc-band-3" />
        <div aria-hidden="true" className="dark-arc-bands-dots" />

        {children}
      </div>
    );
  },
);

DarkArcBandsBackground.displayName = 'DarkArcBandsBackground';

export { DarkArcBandsBackground };
