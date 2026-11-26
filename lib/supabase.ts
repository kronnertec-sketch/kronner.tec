'use client';
import { useMemo, useCallback } from 'react';
import { useSession } from '@clerk/react';
import { createClient } from '@supabase/supabase-js';

/** Only surface intentional Postgres P0001 business exceptions to the browser UI. */
export function formatRpcError(error: { code?: string | null; message?: string | null }): Error {
  const msg = typeof error.message === 'string' ? error.message.trim() : '';
  const isSafeBusinessError =
    error.code === 'P0001' &&
    msg.length > 0 &&
    !/kroner_private|violates|syntax error|relation "|column "|operator does not exist/i.test(msg);
  return new Error(
    isSafeBusinessError
      ? msg
      : 'Não foi possível concluir a operação. Revise os dados e tente novamente.'
  );
}

/** Supabase validates the Clerk JWT through its registered third-party provider. */
export function useApi() {
  const { session } = useSession();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  const client = useMemo(() => {
    if (!url || !key) return null;
    return createClient(url, key, {
      accessToken: async () =>
        session
          ? await session.getToken({ template: 'kroner_claims' }).catch(() => session.getToken())
          : null,
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }, [session, url, key]);

  return useCallback(
    async (action: string, payload: Record<string, unknown> = {}) => {
      if (!client) {
        throw new Error('Configuração do serviço de dados ausente.');
      }
      if (action === 'client_reschedule') {
        const { data, error } = await client.rpc('kroner_client_reschedule', payload);
        if (error) throw formatRpcError(error);
        return data;
      }
      if (action === 'client_profile') {
        const { data, error } = await client.rpc('kroner_client_profile', payload);
        if (error) throw formatRpcError(error);
        return data;
      }
      if (action === 'release_buffer') {
        const { data, error } = await client.rpc('kroner_release_buffer', payload);
        if (error) throw formatRpcError(error);
        return data;
      }
      const { data, error } = await client.rpc(
        action.startsWith('team:')
          ? 'kroner_team'
          : action.startsWith('pos:')
            ? 'kroner_pos'
            : action.startsWith('manage:')
              ? 'kroner_management'
              : action.startsWith('notify:')
                ? 'kroner_notifications'
                : 'kroner_api',
        { action: action.replace(/^(team|pos|manage|notify):/, ''), payload }
      );
      if (error) throw formatRpcError(error);
      return data;
    },
    [client]
  );
}
