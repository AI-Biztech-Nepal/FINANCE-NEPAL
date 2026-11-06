// lib/features/resolve.ts
//
// Which Finance features an organization has, worked out from what the portal says. Pure (no React, no network) so it
// can be tested on its own - see resolve.test.mjs. The keys, names and defaults mirror supabase/feature-backfill/finance.json,
// which the portal loads into core.features; a test keeps the two in step.

export const FINANCE_FEATURES = ['finance.vehicles', 'finance.rent', 'finance.emi'] as const;
export type FinanceFeature = (typeof FINANCE_FEATURES)[number];
export type FeatureFlags = Record<FinanceFeature, boolean>;

/** The value for an org the portal has no row for (core.features.default_on). All three are off: they are for the
 * accounts that sell or rent out vehicles, which the backfill switches on by name. */
export const CATALOGUE_DEFAULTS: FeatureFlags = {
  'finance.vehicles': false,
  'finance.rent': false,
  'finance.emi': false,
};

/** What the owner sees for a feature: on the Features screen's switch, and on the page shown when a hidden URL is opened. */
export const FEATURE_NAMES: Record<FinanceFeature, string> = {
  'finance.vehicles': 'Vehicle accounts',
  'finance.rent': 'Rent',
  'finance.emi': 'EMI',
};

/** One row of core.org_features(p_org): the feature, whether it is on for this org, and its own options. */
export interface OrgFeatureRow {
  feature_key: string;
  enabled: boolean;
  config?: unknown;
}

/** Where the answer came from. 'portal' is the normal case. 'legacy' means the portal could not be asked (its feature
 * functions are not deployed yet), so the old per-account switch decided - see loadFeatures. */
export type FeatureSource = 'portal' | 'legacy';

/**
 * `rows` is what core.org_features returned, or null when it could not be asked (not deployed, offline, an error).
 *
 * - Rows came back: each feature takes its row's value; a feature with no row takes the catalogue default. The org's
 *   `finance.org_settings.sells_vehicles` is not read - the portal backfilled it into `finance.vehicles`.
 * - No rows (null): the app behaves exactly as it did before flags: vehicle accounts get the vehicle screens and,
 *   with them, Rent and EMI. `legacySellsVehicles` says whether this is one.
 */
export function resolveFeatures(
  rows: OrgFeatureRow[] | null | undefined,
  legacySellsVehicles: boolean
): { flags: FeatureFlags; source: FeatureSource } {
  if (!Array.isArray(rows)) {
    return {
      flags: { 'finance.vehicles': legacySellsVehicles, 'finance.rent': legacySellsVehicles, 'finance.emi': legacySellsVehicles },
      source: 'legacy',
    };
  }
  const flags: FeatureFlags = { ...CATALOGUE_DEFAULTS };
  for (const row of rows) {
    if ((FINANCE_FEATURES as readonly string[]).includes(row?.feature_key)) {
      flags[row.feature_key as FinanceFeature] = row.enabled === true;
    }
  }
  return { flags, source: 'portal' };
}
