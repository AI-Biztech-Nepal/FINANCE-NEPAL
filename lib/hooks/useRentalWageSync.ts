// lib/hooks/useRentalWageSync.ts
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';
import { useFeature } from '../features/useFeatures';

/**
 * Brings the employees' daily rental wages up to today (sync_rental_wages, 0015_rental_employee_wages.sql). The
 * database also does it every night, and whenever a rental changes; this catches up a missed night the moment
 * the Rent page or a ledger opens. Before that migration has run the call simply fails and nothing happens.
 *
 * Only while the organization has Rent on (finance.rent). Switched off, this does not call and the database would not
 * act on it either: the rent lines already on ledgers stay as they are, and the next call after Rent is switched on
 * brings them up to date again.
 */
export function useRentalWageSync(userId: string | undefined) {
  const queryClient = useQueryClient();
  const rentOn = useFeature('finance.rent');
  useEffect(() => {
    if (!userId || !rentOn) return;
    let live = true;
    // Called on the client itself: `rpc` reads the client's own settings, so it cannot be taken off it.
    const client = supabase as unknown as { rpc: (fn: string) => PromiseLike<{ error: unknown }> };
    client.rpc('sync_rental_wages').then(
      ({ error }) => {
        if (live && !error) {
          queryClient.invalidateQueries({ queryKey: ['customer_ledger_entries'] });
          queryClient.invalidateQueries({ queryKey: ['vendor_ledger_entries'] });
        }
      },
      () => {}
    );
    return () => {
      live = false;
    };
  }, [userId, rentOn, queryClient]);
}
