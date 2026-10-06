import { Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './components/Shell';
import { ErrorBoundary } from './components/ui';
import { RequireSession } from './lib/session';
import { Activity } from './pages/Activity';
import { Agents } from './pages/Agents';
import { Approvals } from './pages/Approvals';
import { Cockpit } from './pages/Cockpit';
import { Gallery } from './pages/Gallery';
import { Gauntlet } from './pages/Gauntlet';
import { Incidents } from './pages/Incidents';
import { Integrations } from './pages/Integrations';
import { Lab } from './pages/Lab';
import { Landing } from './pages/Landing';
import { Mandate } from './pages/Mandate';
import { MissionDetail, Missions } from './pages/Missions';
import { Overview } from './pages/Overview';
import { Policy } from './pages/Policy';
import { Limits, Security } from './pages/Public';
import { Schedule } from './pages/Schedule';

export function App() {
  return (
    <ErrorBoundary>
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
    </ErrorBoundary>
  );
}
