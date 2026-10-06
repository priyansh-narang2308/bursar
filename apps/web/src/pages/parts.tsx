import type { ReactNode } from 'react';

export function PageHead({
  title,
  sub,
  action,
}: {
  title: string;
  sub?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <h1 className="page-title">{title}</h1>
        {sub !== undefined && <p className="page-sub">{sub}</p>}
      </div>
      {action}
    </div>
  );
}
