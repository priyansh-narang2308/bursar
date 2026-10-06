import { Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './components/Shell';
import { ErrorBoundary } from './components/ui';
import { RequireSession } from './lib/session';
import { Activity } from './pages/Activity';
import { Agents } from './pages/Agents';
import { Approvals } from './pages/Approvals';
import { ComingSoon } from './pages/ComingSoon';
import { Gallery } from './pages/Gallery';
import { Gauntlet } from './pages/Gauntlet';
import { Incidents } from './pages/Incidents';
import { Integrations } from './pages/Integrations';
import { Landing } from './pages/Landing';
import { Mandate } from './pages/Mandate';
import { MissionDetail, Missions } from './pages/Missions';
import { Overview } from './pages/Overview';
import { Policy } from './pages/Policy';
import { Schedule } from './pages/Schedule';

const SOON: [string, string, string][] = [
  [
    'policy',
    'Policy',
    'The rules that decide every proposal, with their parameters and the version in force.',
  ],
  [
    'incidents',
    'Incidents',
    'Anything that moved money outside an approved action, and how it was contained.',
  ],
  [
    'studio',
    'Studio',
    'A workbench to talk to the agents and see their work as tables and charts.',
  ],
  [
    'schedule',
    'Schedule',
    'The delivery plan as a Gantt chart, and recovery when a carrier is late.',
  ],
  [
    'lab',
    'Policy lab',
    'Adversarial scenarios run against the policy, with what broke and how it was fixed.',
  ],
];

export function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/" element={<Landing />} />
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
          {SOON.map(([path, title, text]) => (
            <Route key={path} path={path} element={<ComingSoon title={title} text={text} />} />
          ))}
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
