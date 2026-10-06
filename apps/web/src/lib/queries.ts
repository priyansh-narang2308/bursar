import type { Cockpit } from '@bursar/schemas';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from './api';
import type {
  ActionRow,
  Agent,
  ApprovalRow,
  AuditVerdict,
  Incident,
  IntegrationsView,
  Mandate,
  Me,
  Mission,
  PolicyView,
  Receipt,
  ScheduleView,
} from './types';

export const useMe = () =>
  useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<Me>('/v1/me'),
    retry: false,
    staleTime: 30_000,
  });
export const useWorkspace = () =>
  useQuery({
    queryKey: ['workspace'],
    queryFn: () => api.get<{ id: string; name: string }>('/v1/workspace'),
  });
export const useMandates = () =>
  useQuery({
    queryKey: ['mandates'],
    queryFn: () => api.get<{ items: Mandate[] }>('/v1/mandates').then((r) => r.items),
  });
export const useMissions = () =>
  useQuery({
    queryKey: ['missions'],
    queryFn: () => api.get<{ items: Mission[] }>('/v1/missions').then((r) => r.items),
  });
export const useActions = () =>
  useQuery({
    queryKey: ['actions'],
    queryFn: () => api.get<{ items: ActionRow[] }>('/v1/actions').then((r) => r.items),
  });
export const useApprovals = (enabled = true) =>
  useQuery({
    queryKey: ['approvals'],
    enabled,
    queryFn: () => api.get<{ items: ApprovalRow[] }>('/v1/approvals').then((r) => r.items),
  });
export const useAgents = () =>
  useQuery({
    queryKey: ['agents'],
    queryFn: () => api.get<{ items: Agent[] }>('/v1/agents').then((r) => r.items),
  });
export const useAuditVerdict = () =>
  useQuery({
    queryKey: ['audit-verify'],
    queryFn: () => api.get<AuditVerdict>('/v1/audit/verify'),
    retry: false,
  });
export const usePolicy = () =>
  useQuery({ queryKey: ['policy'], queryFn: () => api.get<PolicyView>('/v1/policy') });
export const useIncidents = () =>
  useQuery({
    queryKey: ['incidents'],
    queryFn: () => api.get<{ items: Incident[] }>('/v1/incidents').then((r) => r.items),
  });
export const useCockpit = () =>
  useQuery({
    queryKey: ['cockpit'],
    queryFn: () => api.get<Cockpit>('/v1/cockpit'),
    refetchInterval: 20_000,
  });
export const useIntegrations = () =>
  useQuery({
    queryKey: ['integrations'],
    queryFn: () => api.get<IntegrationsView>('/v1/integrations'),
  });
export const useSchedule = (missionId: string | undefined) =>
  useQuery({
    queryKey: ['schedule', missionId],
    enabled: missionId !== undefined,
    queryFn: () => api.get<ScheduleView>(`/v1/missions/${missionId}/schedule`),
  });
export const useReceipt = (actionId: string | null) =>
  useQuery({
    queryKey: ['receipt', actionId],
    enabled: actionId !== null,
    queryFn: () => api.get<Receipt>(`/v1/receipts/${actionId}`),
  });

/** The mandate that matters now: the active one, else a frozen one, else the latest. */
export function currentMandate(mandates: readonly Mandate[] | undefined): Mandate | undefined {
  return (
    mandates?.find((m) => m.status === 'ACTIVE') ??
    mandates?.find((m) => m.status === 'FROZEN') ??
    mandates?.[0]
  );
}

/**
 * Listens to the server's event stream and refreshes whatever the screens show when something happens.
 * The browser reconnects by itself and resumes from the last event it saw.
 */
export function useLiveEvents(enabled: boolean) {
  const client = useQueryClient();
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    const source = new EventSource('/v1/events');
    // A purchase emits a handful of events at once; refresh once, shortly after the last of them.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () =>
          void Promise.all(
            [
              'actions',
              'approvals',
              'mandates',
              'missions',
              'audit-verify',
              'receipt',
              'incidents',
              'schedule',
              'cockpit',
            ].map((key) => client.invalidateQueries({ queryKey: [key] })),
          ),
        300,
      );
    };
    source.onmessage = refresh;
    // Every topic is its own event name, so listen to the ones the money loop emits.
    for (const topic of [
      'action.proposed',
      'action.approved',
      'action.submitting',
      'action.submitted',
      'action.confirmed',
      'action.denied',
      'action.rejected',
      'action.awaiting_approval',
      'mandate.activated',
      'mandate.frozen',
      'mandate.active',
      'mandate.revoked',
      'incident.opened',
    ])
      source.addEventListener(topic, refresh);
    return () => {
      clearTimeout(timer);
      source.close();
    };
  }, [enabled, client]);
}
