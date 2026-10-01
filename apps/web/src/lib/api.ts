import type { Profile, ProfileUpdate } from '@splity/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`API ${status}`);
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: { ...(init?.body ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
  });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

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
    mutationFn: (update: ProfileUpdate) => api<Profile>('/me', { method: 'PATCH', body: JSON.stringify(update) }),
    onSuccess: (profile) => queryClient.setQueryData(['me'], profile),
  });
}

export function useAuthConfig() {
  return useQuery({
    queryKey: ['config'],
    queryFn: () => api<{ google: boolean }>('/config'),
    staleTime: Infinity,
  });
}
