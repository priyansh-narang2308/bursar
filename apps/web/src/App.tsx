import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './components/Shell';
import { ErrorBoundary, Skeleton } from './components/ui';
import { RequireSession } from './lib/session';
import { Landing } from './pages/Landing';
import { Limits, Security } from './pages/Public';

/*
 * The landing page is what most visitors see first, so everything behind the dashboard loads when it is
 * opened: Studio and the Gantt are several megabytes the front page has no use for.
 */
const page = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));
const Activity = page(() => import('./pages/Activity'), 'Activity');
const Agents = page(() => import('./pages/Agents'), 'Agents');
const Approvals = page(() => import('./pages/Approvals'), 'Approvals');
const Cockpit = page(() => import('./pages/Cockpit'), 'Cockpit');
const Gallery = page(() => import('./pages/Gallery'), 'Gallery');
const Gauntlet = page(() => import('./pages/Gauntlet'), 'Gauntlet');
const Incidents = page(() => import('./pages/Incidents'), 'Incidents');
const Integrations = page(() => import('./pages/Integrations'), 'Integrations');
const Lab = page(() => import('./pages/Lab'), 'Lab');
const Mandate = page(() => import('./pages/Mandate'), 'Mandate');
const Overview = page(() => import('./pages/Overview'), 'Overview');
const Policy = page(() => import('./pages/Policy'), 'Policy');
const Schedule = page(() => import('./pages/Schedule'), 'Schedule');
const Missions = page(() => import('./pages/Missions'), 'Missions');
const MissionDetail = page(() => import('./pages/Missions'), 'MissionDetail');

export function App() {
  return (
    <ErrorBoundary>
      <Suspense
        fallback={
          <div className="content">
            <Skeleton width="30%" />
            <Skeleton width="60%" />
          </div>
        }
      >
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/security" element={<Security />} />
          <Route path="/limits" element={<Limits />} />
          <Route path="/_ui" element={<Gallery />} />
          <Route
            path="/dashboard"
            element={
              <RequireSession>
                <Shell />
              </RequireSession>
            }
          >
            <Route index element={<Overview />} />
            <Route path="missions" element={<Missions />} />
            <Route path="missions/:id" element={<MissionDetail />} />
            <Route path="approvals" element={<Approvals />} />
            <Route path="activity" element={<Activity />} />
            <Route path="mandate" element={<Mandate />} />
            <Route path="agents" element={<Agents />} />
            <Route path="policy" element={<Policy />} />
            <Route path="incidents" element={<Incidents />} />
            <Route path="integrations" element={<Integrations />} />
            <Route path="schedule" element={<Schedule />} />
            <Route path="gauntlet" element={<Gauntlet />} />
            <Route path="lab" element={<Lab />} />
            <Route path="studio" element={<Cockpit />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
