// lib/components/finance/crmKit.ts
//
// What the CRM table and the customer profile (a drawer) both work with.
import type { Lead, LeadHistoryEntry, LeadSource, LeadStatus } from '../../../types/database.types';

export const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** One person in the CRM: a saved customer who has bought, or a lead being followed up (see CrmScreen). */
export interface CrmRow {
  key: string;
  lead: Lead | null;
  customerId: string | null;
  name: string;
  phone: string;
  address: string;
  source: LeadSource | null;
  sourceNote: string;
  /** Has a Sale bill: Converted, and it cannot be changed by hand. */
  bought: boolean;
  status: LeadStatus;
  followUp: string | null;
  last: LeadHistoryEntry | null;
  amount: number;
  createdAt: string;
  referred: number;
}

/** The profile's edit form, as text. */
export interface CrmForm {
  name: string;
  phone: string;
  address: string;
  source: LeadSource | '';
  source_note: string;
  interested_in: string;
  status: LeadStatus;
}

export const EMPTY_CRM_FORM: CrmForm = { name: '', phone: '', address: '', source: '', source_note: '', interested_in: '', status: 'new' };

export const crmFormOf = (r: CrmRow | null): CrmForm =>
  r
    ? { name: r.name, phone: r.phone, address: r.address, source: r.source ?? '', source_note: r.sourceNote, interested_in: r.lead?.interested_in ?? '', status: r.status }
    : EMPTY_CRM_FORM;
