// lib/components/finance/leadKit.ts
//
// What a lead is told apart by, shared by the Leads page and the "Lead" block of the Record Sale form: the places a
// customer can have come from. The keys are what the `leads` table stores (see 0029_leads.sql).
import type { Ionicons } from '@expo/vector-icons';
import { localTodayIso } from '../../utils/localDate';
import { toBsHistoryLabel } from '../../utils/nepaliDate';
import type { LeadHistoryEntry, LeadSource, LeadStatus } from '../../../types/database.types';

type IconName = keyof typeof Ionicons.glyphMap;

/** Where a lead is in following up (CRM). Converted is what a customer is once a sale stands. */
export const LEAD_STATUSES: { key: LeadStatus; label: string; color: string; bg: string }[] = [
  { key: 'new', label: 'New', color: '#047857', bg: '#ECFDF5' },
  { key: 'contacted', label: 'Contacted', color: '#1D4ED8', bg: '#EFF6FF' },
  { key: 'interested', label: 'Interested', color: '#C2410C', bg: '#FFF7ED' },
  { key: 'converted', label: 'Converted', color: '#065F46', bg: '#D1FAE5' },
  { key: 'lost', label: 'Lost', color: '#B91C1C', bg: '#FEF2F2' },
];

/** What can be logged by hand from a lead's history. A Sale line is written by the Record Sale form. */
export const CONTACT_KINDS: { key: LeadHistoryEntry['kind']; label: string; icon: IconName }[] = [
  { key: 'call', label: 'Call', icon: 'call' },
  { key: 'whatsapp', label: 'WhatsApp', icon: 'logo-whatsapp' },
  { key: 'visit', label: 'Visit', icon: 'storefront' },
  { key: 'note', label: 'Note', icon: 'document-text' },
];
export const HISTORY_KINDS: { key: LeadHistoryEntry['kind']; label: string; icon: IconName }[] = [
  ...CONTACT_KINDS,
  { key: 'sale', label: 'Sale', icon: 'bag-handle' },
];

/** Follow-up choices; `days` counts from today, null is none. */
export const FOLLOW_UPS: { label: string; days: number | null }[] = [
  { label: 'None', days: null },
  { label: 'Today', days: 0 },
  { label: 'Tomorrow', days: 1 },
  { label: 'In 3 days', days: 3 },
  { label: 'Next week', days: 7 },
  { label: 'In 2 weeks', days: 14 },
];

/** Today plus `n` days, as 'YYYY-MM-DD'. */
export function inDays(n: number): string {
  const [y, m, d] = localTodayIso().split('-').map(Number);
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

/** "Today", "Yesterday", "3 days ago" ... counted in calendar days, so a lead from last night is "Yesterday". */
export function dayLabel(iso: string): string {
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(new Date()) - start(new Date(iso))) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return days <= 30 ? `${days} days ago` : toBsHistoryLabel(iso);
}

/** Nepali mobile numbers are typed as 98XXXXXXXX; wa.me needs the country code. */
export function waNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 10 ? `977${digits}` : digits;
}

export const LEAD_SOURCES: { key: LeadSource; label: string; icon: keyof typeof Ionicons.glyphMap; color: string; bg: string }[] = [
  { key: 'walk_in', label: 'Walk-in', icon: 'walk', color: '#047857', bg: '#ECFDF5' },
  { key: 'website', label: 'Website', icon: 'globe', color: '#4338CA', bg: '#EEF2FF' },
  { key: 'facebook', label: 'Facebook', icon: 'logo-facebook', color: '#1D4ED8', bg: '#EFF6FF' },
  { key: 'tiktok', label: 'TikTok', icon: 'logo-tiktok', color: '#BE123C', bg: '#FFF1F2' },
  { key: 'referral', label: 'Referral', icon: 'people', color: '#B45309', bg: '#FFFBEB' },
  { key: 'other', label: 'Other', icon: 'ellipsis-horizontal', color: '#475569', bg: '#F1F5F9' },
];

/** Referral and Other each ask for a few words more: who referred them, or where else they came from. */
export const sourceNeedsNote = (source: LeadSource | ''): boolean => source === 'referral' || source === 'other';
