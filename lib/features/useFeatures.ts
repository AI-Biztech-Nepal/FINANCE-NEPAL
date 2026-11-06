// lib/features/useFeatures.ts
//
// The organization's Finance features, read once per session (right after sign-in, before any screen renders - see
// useAuth.ts) and kept here. The portal owns the data (core.org_features); this only reads it.
import { create } from 'zustand';
import { supabase } from '../supabase';
import { isDeevaBrand } from '../utils/accountFeatures';
import {
  CATALOGUE_DEFAULTS,
  resolveFeatures,
  type FeatureFlags,
  type FeatureSource,
  type FinanceFeature,
  type OrgFeatureRow,
} from './resolve';

interface FeatureState {
  /** The organization the flags below are for. */
  orgId: string | null;
  flags: FeatureFlags;
  /** False until the answer is in. Until then every flag reads as its catalogue default, so a screen that must not
   * guess (FeatureGate) waits for this instead of flashing the wrong page. */
  loaded: boolean;
  source: FeatureSource | null;
  load: (orgId: string, accountName: string | null | undefined) => Promise<void>;
  reset: () => void;
}

// Both calls go through an untyped client: the generated Database type only describes this app's own schema.
const db = supabase as any;

/** core.org_features(p_org), or null when it cannot be asked - the function is not deployed yet, the network failed, or
 * the answer is not a list. A missing answer is never taken to mean "everything off". */
async function fetchOrgFeatures(orgId: string): Promise<OrgFeatureRow[] | null> {
  try {
    const { data, error } = await db.schema('core').rpc('org_features', { p_org: orgId });
    return error || !Array.isArray(data) ? null : (data as OrgFeatureRow[]);
  } catch {
    return null;
  }
}

/** The switch the app used before flags: `finance.org_settings.sells_vehicles`, or a business name that reads
 * "Deeva Auto". Only consulted while the portal's feature functions are not there to ask. */
async function fetchLegacySellsVehicles(orgId: string, accountName: string | null | undefined): Promise<boolean> {
  if (isDeevaBrand(accountName)) return true;
  try {
    const { data } = await db.from('org_settings').select('sells_vehicles').eq('org_id', orgId).maybeSingle();
    return !!data?.sells_vehicles;
  } catch {
    return false;
  }
}

export const useFeatureStore = create<FeatureState>((set, get) => ({
  orgId: null,
  flags: CATALOGUE_DEFAULTS,
  loaded: false,
  source: null,
  load: async (orgId, accountName) => {
    // Once per session: sign-in fires this again on every token refresh, and the answer has not changed.
    if (get().loaded && get().orgId === orgId) return;
    const rows = await fetchOrgFeatures(orgId);
    const legacy = rows ? false : await fetchLegacySellsVehicles(orgId, accountName);
    const { flags, source } = resolveFeatures(rows, legacy);
    set({ orgId, flags, source, loaded: true });
  },
  reset: () => set({ orgId: null, flags: CATALOGUE_DEFAULTS, loaded: false, source: null }),
}));

/** Whether this organization has the feature on. False until the features have loaded. */
export function useFeature(key: FinanceFeature): boolean {
  return useFeatureStore((state) => state.flags[key]);
}

export function useFeaturesLoaded(): boolean {
  return useFeatureStore((state) => state.loaded);
}
