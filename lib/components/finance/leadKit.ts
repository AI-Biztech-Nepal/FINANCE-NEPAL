// lib/components/finance/leadKit.ts
//
// What a lead is told apart by, shared by the Leads page and the "Lead" block of the Record Sale form: the places a
// customer can have come from. The keys are what the `leads` table stores (see 0029_leads.sql).
import type { Ionicons } from '@expo/vector-icons';
import type { LeadSource } from '../../../types/database.types';

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
