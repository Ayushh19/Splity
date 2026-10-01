import type {
  AddPlaceholder,
  ApiErrorBody,
  CreateGroup,
  GroupDetail,
  GroupSummary,
  InvitePreview,
  JoinInvite,
  Profile,
  ProfileUpdate,
  UpdateGroup,
} from '@splity/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: Partial<ApiErrorBody> | null,
  ) {
    super(body?.message ?? `Request failed (${status})`);
  }
}

/** Human-readable message for any error thrown by a query or mutation. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "Can't reach Splity right now. Check your connection and try again.";
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  });
  const text = await res.text();
  const body: unknown = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, body as ApiErrorBody | null);
  return body as T;
}

const json = (method: string, data: unknown): RequestInit => ({ method, body: JSON.stringify(data) });

// ── Profile ────────────────────────────────────────────────────

/** The signed-in user's profile, or null when signed out. */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api<Profile>('/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (update: ProfileUpdate) => api<Profile>('/me', json('PATCH', update)),
    onSuccess: (profile) => {
      queryClient.setQueryData(['me'], profile);
      // Names appear inside every group.
      void queryClient.invalidateQueries({ queryKey: ['groups'] });
    },
  });
}

export function useAuthConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: () => api<{ google: boolean }>('/config'),
    staleTime: Infinity,
  });
}

// ── Groups ─────────────────────────────────────────────────────

export interface ActivityEvent {
  id: string;
  type: string;
  actorName: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export function useGroups() {
  return useQuery({ queryKey: ['groups'], queryFn: () => api<GroupSummary[]>('/groups') });
}

export function useGroup(groupId: string) {
  return useQuery({ queryKey: ['groups', groupId], queryFn: () => api<GroupDetail>(`/groups/${groupId}`) });
}

export function useGroupActivity(groupId: string) {
  return useQuery({
    queryKey: ['groups', groupId, 'activity'],
    queryFn: () => api<ActivityEvent[]>(`/groups/${groupId}/activity`),
  });
}

/** Every group mutation returns the fresh GroupDetail; store it and refresh lists and activity. */
function useGroupMutation<V>(groupId: string, request: (vars: V) => Promise<GroupDetail>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: (detail) => {
      queryClient.setQueryData(['groups', groupId], detail);
      void queryClient.invalidateQueries({ queryKey: ['groups'], exact: true });
      void queryClient.invalidateQueries({ queryKey: ['groups', groupId, 'activity'] });
    },
  });
}

export function useCreateGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateGroup) => api<GroupDetail>('/groups', json('POST', input)),
    onSuccess: (detail) => {
      queryClient.setQueryData(['groups', detail.id], detail);
      void queryClient.invalidateQueries({ queryKey: ['groups'], exact: true });
    },
  });
}

export const useUpdateGroup = (groupId: string) =>
  useGroupMutation(groupId, (update: UpdateGroup) => api<GroupDetail>(`/groups/${groupId}`, json('PATCH', update)));

export const useAddPlaceholder = (groupId: string) =>
  useGroupMutation(groupId, (input: AddPlaceholder) =>
    api<GroupDetail>(`/groups/${groupId}/members`, json('POST', input)),
  );

export const usePromoteMember = (groupId: string) =>
  useGroupMutation(groupId, (memberId: string) =>
    api<GroupDetail>(`/groups/${groupId}/members/${memberId}/promote`, { method: 'POST' }),
  );

export const useUndoClaim = (groupId: string) =>
  useGroupMutation(groupId, (memberId: string) =>
    api<GroupDetail>(`/groups/${groupId}/members/${memberId}/undo-claim`, { method: 'POST' }),
  );

export const useRemoveMember = (groupId: string) =>
  useGroupMutation(groupId, (memberId: string) =>
    api<GroupDetail>(`/groups/${groupId}/members/${memberId}`, { method: 'DELETE' }),
  );

export const useResetInvite = (groupId: string) =>
  useGroupMutation(groupId, () => api<GroupDetail>(`/groups/${groupId}/invite/reset`, { method: 'POST' }));

export function useLeaveGroup(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<null>(`/groups/${groupId}/leave`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['groups', groupId] });
      void queryClient.invalidateQueries({ queryKey: ['groups'], exact: true });
    },
  });
}

// ── Invites ────────────────────────────────────────────────────

export function useInvite(token: string) {
  return useQuery({ queryKey: ['invite', token], queryFn: () => api<InvitePreview>(`/invites/${token}`), retry: false });
}

export function useJoinInvite(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: JoinInvite) => api<GroupDetail>(`/invites/${token}/join`, json('POST', input)),
    onSuccess: (detail) => {
      queryClient.setQueryData(['groups', detail.id], detail);
      void queryClient.invalidateQueries({ queryKey: ['groups'], exact: true });
      void queryClient.invalidateQueries({ queryKey: ['invite', token] });
    },
  });
}
