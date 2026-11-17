// lib/utils/purchaseSource.ts
import type { LeadHistoryEntry, LeadSource } from '../../types/database.types';

/**
 * How the customer found the shop when one particular sale was saved (All In One Abroad's Leads page), or null when that
 * sale did not keep it.
 *
 * The Record Sale form writes it onto that sale's history line (`sale_id`, `source`, `source_note`; see recordLeadFromSale).
 * Sales saved before that kept nothing, so there is nothing to show for them. The lead on file now is not a stand-in: it is
 * only the answer given at the person's latest sale, so it is right for at most one of their purchases, and showing it on
 * every row (as an earlier version did) made all of them read the same.
 */
export function sourceOfPurchase(
  history: LeadHistoryEntry[] | null | undefined,
  saleId: string
): { source: LeadSource; note: string | null } | null {
  const own = (history ?? []).find((h) => h.sale_id === saleId && h.source);
  return own?.source ? { source: own.source, note: own.source_note ?? null } : null;
}
