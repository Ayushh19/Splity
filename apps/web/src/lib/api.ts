import type {
  AddPlaceholder,
  ApiErrorBody,
  CreateGroup,
  ExpenseDetail,
  ExpenseInput,
  ExpenseView,
  FriendDetail,
  FriendSummary,
  GroupBalances,
  GroupDetail,
  GroupSummary,
  InvitePreview,
  JoinInvite,
  Profile,
  ProfileUpdate,
  ReminderResult,
  ReminderView,
  SettlementDetail,
  SettlementInput,
  SettlementUpdate,
  SettlementView,
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
    queryFn: () => api<{ google: boolean; push: boolean; vapidPublicKey: string | null }>('/config'),
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

// ── Expenses ───────────────────────────────────────────────────

export function useExpenses(groupId: string, { deleted = false } = {}) {
  return useQuery({
    queryKey: ['groups', groupId, 'expenses', { deleted }],
    queryFn: () => api<ExpenseView[]>(`/groups/${groupId}/expenses${deleted ? '?deleted=1' : ''}`),
  });
}

export function useExpense(groupId: string, expenseId: string) {
  return useQuery({
    queryKey: ['groups', groupId, 'expense', expenseId],
    queryFn: () => api<ExpenseDetail>(`/groups/${groupId}/expenses/${expenseId}`),
  });
}

export function useBalances(groupId: string) {
  return useQuery({ queryKey: ['groups', groupId, 'balances'], queryFn: () => api<GroupBalances>(`/groups/${groupId}/balances`) });
}

/** After any expense or payment change: this group's data (balances, lists, activity, detail) and Home. */
function useMoneyMutation<V, R>(groupId: string, request: (vars: V) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['groups', groupId] });
      void queryClient.invalidateQueries({ queryKey: ['groups'], exact: true });
      void queryClient.invalidateQueries({ queryKey: ['friends'] });
    },
  });
}

export const useCreateExpense = (groupId: string) =>
  useMoneyMutation(groupId, (input: ExpenseInput) => api<ExpenseView>(`/groups/${groupId}/expenses`, json('POST', input)));

export const useUpdateExpense = (groupId: string, expenseId: string) =>
  useMoneyMutation(groupId, (input: ExpenseInput & { version: number }) =>
    api<ExpenseView>(`/groups/${groupId}/expenses/${expenseId}`, json('PUT', input)),
  );

export const useDeleteExpense = (groupId: string, expenseId: string) =>
  useMoneyMutation(groupId, (version: number) =>
    api<ExpenseView>(`/groups/${groupId}/expenses/${expenseId}/delete`, json('POST', { version })),
  );

export const useRestoreExpense = (groupId: string, expenseId: string) =>
  useMoneyMutation(groupId, (version: number) =>
    api<ExpenseView>(`/groups/${groupId}/expenses/${expenseId}/restore`, json('POST', { version })),
  );

/** The server's 409 body when someone else saved first. */
export function conflictOf(error: unknown): { changedBy: string; current: ExpenseView } | null {
  if (error instanceof ApiError && error.status === 409 && error.body && 'current' in error.body) {
    return error.body as unknown as { changedBy: string; current: ExpenseView };
  }
  return null;
}

// ── Settlements ────────────────────────────────────────────────

export function useSettlements(groupId: string, { deleted = false } = {}) {
  return useQuery({
    queryKey: ['groups', groupId, 'settlements', { deleted }],
    queryFn: () => api<SettlementView[]>(`/groups/${groupId}/settlements${deleted ? '?deleted=1' : ''}`),
  });
}

export function useSettlement(groupId: string, settlementId: string) {
  return useQuery({
    queryKey: ['groups', groupId, 'settlement', settlementId],
    queryFn: () => api<SettlementDetail>(`/groups/${groupId}/settlements/${settlementId}`),
  });
}

export const useRecordSettlement = (groupId: string) =>
  useMoneyMutation(groupId, (input: SettlementInput) => api<SettlementView>(`/groups/${groupId}/settlements`, json('POST', input)));

export const useUpdateSettlement = (groupId: string, id: string) =>
  useMoneyMutation(groupId, (input: SettlementUpdate) => api<SettlementView>(`/groups/${groupId}/settlements/${id}`, json('PUT', input)));

/** delete | restore | dispute | withdraw-dispute, all versioned. */
export const useSettlementAction = (groupId: string, id: string) =>
  useMoneyMutation(groupId, (vars: { action: 'delete' | 'restore' | 'dispute' | 'withdraw-dispute'; version: number; note?: string | null }) =>
    api<SettlementView>(
      `/groups/${groupId}/settlements/${id}/${vars.action}`,
      json('POST', vars.action === 'dispute' ? { version: vars.version, note: vars.note ?? null } : { version: vars.version }),
    ),
  );

// ── Notifications ──────────────────────────────────────────────

export const useMuteGroup = (groupId: string) =>
  useGroupMutation(groupId, (muted: boolean) => api<GroupDetail>(`/groups/${groupId}/mute`, json('PUT', { muted })));

/** Reminders I sent in this group in the last 24 hours. */
export function useReminders(groupId: string) {
  return useQuery({ queryKey: ['groups', groupId, 'reminders'], queryFn: () => api<ReminderView[]>(`/groups/${groupId}/reminders`) });
}

export function useSendReminder(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (toMember: string) => api<ReminderResult>(`/groups/${groupId}/reminders`, json('POST', { toMember })),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['groups', groupId, 'reminders'] }),
  });
}

// ── Group lifecycle & account ──────────────────────────────────

export const useMergeMember = (groupId: string) =>
  useGroupMutation(groupId, (vars: { memberId: string; intoMemberId: string }) =>
    api<GroupDetail>(`/groups/${groupId}/members/${vars.memberId}/merge`, json('POST', { intoMemberId: vars.intoMemberId })),
  );

function useArchiveMutation(groupId: string, action: 'archive' | 'unarchive') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<GroupDetail>(`/groups/${groupId}/${action}`, { method: 'POST' }),
    onSuccess: (detail) => {
      queryClient.setQueryData(['groups', groupId], detail);
      void queryClient.invalidateQueries({ queryKey: ['groups'], exact: true });
      void queryClient.invalidateQueries({ queryKey: ['archived-groups'] });
      void queryClient.invalidateQueries({ queryKey: ['groups', groupId, 'activity'] });
    },
  });
}
export const useArchiveGroup = (groupId: string) => useArchiveMutation(groupId, 'archive');
export const useUnarchiveGroup = (groupId: string) => useArchiveMutation(groupId, 'unarchive');

export function useArchivedGroups() {
  return useQuery({ queryKey: ['archived-groups'], queryFn: () => api<GroupSummary[]>('/groups?archived=1') });
}

export interface DeletionBlocker {
  groupId: string;
  name: string;
  currency: string;
  isDirect: boolean;
  netMinor: number;
}

export function useDeletionCheck(enabled: boolean) {
  return useQuery({
    queryKey: ['deletion-check'],
    queryFn: () => api<{ canDelete: boolean; blockers: DeletionBlocker[] }>('/me/deletion-check'),
    enabled,
    staleTime: 0,
  });
}

export function useDeleteAccount() {
  return useMutation({ mutationFn: () => api<null>('/me/delete', json('POST', { confirm: 'DELETE' })) });
}

// ── Friends ────────────────────────────────────────────────────

export function useFriends() {
  return useQuery({ queryKey: ['friends'], queryFn: () => api<FriendSummary[]>('/friends') });
}

export function useFriend(userId: string) {
  return useQuery({ queryKey: ['friends', userId], queryFn: () => api<FriendDetail>(`/friends/${userId}`) });
}

/** Your 1-on-1 group with a friend, created on first use. */
export function useOpenDirect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api<GroupDetail>(`/friends/${userId}/direct`, { method: 'POST' }),
    onSuccess: (detail) => {
      queryClient.setQueryData(['groups', detail.id], detail);
      void queryClient.invalidateQueries({ queryKey: ['friends'] });
    },
  });
}
