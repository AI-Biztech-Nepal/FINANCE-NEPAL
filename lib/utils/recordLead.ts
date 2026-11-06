// lib/utils/recordLead.ts
import { supabase } from '../supabase';
import type { Lead, LeadHistoryEntry, LeadSource } from '../../types/database.types';

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

/**
 * A sale is what makes a lead a customer, so saving a Sale with a "Lead from" answers writes the buyer into the Leads
 * page as Converted: the lead already kept for them (matched by the saved customer, else phone, else name) is brought
 * up to date, or a new one is made. The sale goes into its history. Call it after the bill is saved; if it fails the
 * bill stays saved, so the caller only has to tell the user.
 */
export async function recordLeadFromSale(sale: {
  ownerId: string;
  customerId: string | null;
  name: string;
  phone: string | null;
  source: LeadSource;
  sourceNote: string | null;
  /** The item names on the bill, "Rice cooker, Tiffin box". */
  items: string;
  amount: number;
  billNo: string | null;
  /** A new bill adds a line to the lead's history; changing the lead on an edited bill does not add it twice. */
  addHistory: boolean;
}): Promise<void> {
  const { data, error } = await supabase.from('leads').select('*').eq('owner_id', sale.ownerId);
  if (error) throw error;
  const leads = (data ?? []) as Lead[];

  const phone = digits(sale.phone);
  const existing =
    (sale.customerId ? leads.find((l) => l.customer_id === sale.customerId) : undefined) ??
    (phone ? leads.find((l) => digits(l.phone) === phone) : undefined) ??
    leads.find((l) => norm(l.name) === norm(sale.name));

  const entry: LeadHistoryEntry = {
    kind: 'sale',
    note: `Bought ${sale.items || 'items'} - NPR ${sale.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}${sale.billNo ? ` (bill ${sale.billNo})` : ''}`,
    at: new Date().toISOString(),
  };

  // The same loose typing the app's own hooks use (see useSupabase.ts): the hand-written Database type is minimal.
  const table = supabase.from('leads') as any;

  if (existing) {
    const { error: updateError } = await table
      .update({
        status: 'converted',
        source: sale.source,
        source_note: sale.sourceNote,
        customer_id: sale.customerId ?? existing.customer_id,
        phone: existing.phone ?? sale.phone,
        interested_in: existing.interested_in ?? (sale.items || null),
        follow_up_on: null,
        history: sale.addHistory ? [...(existing.history ?? []), entry] : existing.history ?? [],
      })
      .eq('id', existing.id);
    if (updateError) throw updateError;
    return;
  }

  const { error: insertError } = await table.insert({
    owner_id: sale.ownerId,
    name: sale.name,
    phone: sale.phone,
    customer_id: sale.customerId,
    source: sale.source,
    source_note: sale.sourceNote,
    interested_in: sale.items || null,
    status: 'converted',
    history: sale.addHistory ? [entry] : [],
  });
  if (insertError) throw insertError;
}
