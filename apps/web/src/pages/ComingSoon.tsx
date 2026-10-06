import { EmptyState } from '../components/ui';
import { PageHead } from './parts';

export function ComingSoon({ title, text }: { title: string; text: string }) {
  return (
    <div className="content">
      <PageHead title={title} sub={text} />
      <div className="panel">
        <EmptyState title="Not built yet">
          This part of the product is on the roadmap. The backend for it exists; the screen does
          not.
        </EmptyState>
      </div>
    </div>
  );
}
