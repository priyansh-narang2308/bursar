import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  Badge,
  Drawer,
  EmptyState,
  ErrorBoundary,
  IdChip,
  MoneyAmount,
  StateBadge,
  StateLadder,
  TableSkeleton,
  toneOf,
} from '../src/components/ui';

describe('state', () => {
  it('maps states to meaning: green healthy, amber waiting, red refused', () => {
    expect(toneOf('CONFIRMED')).toBe('ok');
    expect(toneOf('AWAITING_APPROVAL')).toBe('warn');
    expect(toneOf('DENIED')).toBe('bad');
    expect(toneOf('SOMETHING_NEW')).toBe('neutral');
    render(<StateBadge state="AWAITING_APPROVAL" />);
    expect(screen.getByText('Awaiting approval')).toHaveClass('badge-warn');
  });

  it('shows how far an action got, and says so to screen readers', () => {
    const { container, rerender } = render(<StateLadder state="CONFIRMED" />);
    expect(screen.getByRole('img', { name: 'Confirmed: step 4 of 4' })).toBeInTheDocument();
    expect(container.querySelectorAll('i[data-on="ok"]')).toHaveLength(4);
    rerender(<StateLadder state="DENIED" />);
    expect(container.querySelectorAll('i[data-on="bad"]')).toHaveLength(1);
    rerender(<StateLadder state="MYSTERY" />);
    expect(container.querySelectorAll('i[data-on]')).toHaveLength(0);
  });
});

describe('small components', () => {
  it('shows an amount exactly', () => {
    render(<MoneyAmount minor="63500" currency="USD" />);
    expect(screen.getByText('$635.00')).toBeInTheDocument();
  });

  it('copies an id when clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<IdChip id="act_01M47YN5EGCTWCXBJNJFGA7263" />);
    await userEvent.click(screen.getByRole('button', { name: 'act_01M4…7263' }));
    expect(writeText).toHaveBeenCalledWith('act_01M47YN5EGCTWCXBJNJFGA7263');
    expect(await screen.findByText('copied')).toBeInTheDocument();
  });

  it('renders empty and loading states', () => {
    render(
      <>
        <EmptyState title="Nothing here">Try this.</EmptyState>
        <TableSkeleton rows={2} />
        <Badge tone="bad">Bad</Badge>
      </>,
    );
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
  });

  it('closes a drawer with Escape and with its button', async () => {
    const onClose = vi.fn();
    render(
      <Drawer title="Receipt" onClose={onClose}>
        body
      </Drawer>,
    );
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getAllByRole('button', { name: 'Close' })[1] as HTMLElement); // the header button
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('shows an error note instead of a blank screen when a page throws', () => {
    const Boom = () => {
      throw new Error('boom');
    };
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('boom');
  });
});
