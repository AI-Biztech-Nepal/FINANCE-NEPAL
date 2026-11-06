// lib/components/finance/CrmScreen.tsx
//
// CRM (Marketing), laid out like Auto Stock Manager's: four stat cards, "Today's Follow-ups", a search bar with Lead Source
// and Lead Status dropdowns, quick source buttons with counts and sales, and one table of customers - each with a source
// dropdown, a status dropdown, last contact, next follow-up and what they have bought. Leads is a different page: only a
// name and how they came.
//
// The rows are every saved customer who has bought (their Sale bills give the amount and make them Converted) plus every
// lead being followed up. The CRM details - source, status, follow-up, history - live on the `leads` table; a customer
// with no row there is "Not tagged" until a source is picked. Tapping Call or WhatsApp logs it in the history.
import { useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../hooks/useAuth';
import { useSupabaseDelete, useSupabaseInsert, useSupabaseQuery, useSupabaseUpdate } from '../../hooks/useSupabase';
import { BookPage, BookTable, ToolbarButton, ToolbarSearch, money, useBookLayout, type BookColumn } from './BookKit';
import { SelectDropdown } from './SelectDropdown';
import { CONTACT_KINDS, FOLLOW_UPS, HISTORY_KINDS, LEAD_SOURCES, LEAD_STATUSES, dayLabel, inDays, sourceNeedsNote, waNumber } from './leadKit';
import { adStringToBs, bsDaysInMonth, bsToAdString, toBsHistoryLabel } from '../../utils/nepaliDate';
import { localTodayIso } from '../../utils/localDate';
import { showAlert, getErrorMessage } from '../../utils/alert';
import type { BusinessTransaction, Customer, Lead, LeadHistoryEntry, LeadSource, LeadStatus } from '../../../types/database.types';

const BLUE = '#2563EB';
type SourceFilter = 'all' | 'needs' | LeadSource;
type StatusFilter = 'all' | LeadStatus;

const STATUS = Object.fromEntries(LEAD_STATUSES.map((s) => [s.key, s])) as Record<LeadStatus, (typeof LEAD_STATUSES)[number]>;
const SOURCE = Object.fromEntries(LEAD_SOURCES.map((s) => [s.key, s])) as Record<LeadSource, (typeof LEAD_SOURCES)[number]>;
const SOURCE_OPTIONS = LEAD_SOURCES.map((s) => ({ key: s.key, label: s.label, icon: s.icon }));
const PICKABLE_STATUSES = LEAD_STATUSES.filter((s) => s.key !== 'converted'); // Converted is what a customer is once a sale stands
const CARD_SHADOW = { boxShadow: '0 1px 2px rgba(16,24,40,0.06)' } as object;

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
const isOpen = (status: LeadStatus) => status !== 'converted' && status !== 'lost';

/** A timestamp as the day it was on this computer, 'YYYY-MM-DD'. */
function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The Nepali (BS) month this one is `back` months before, as AD 'YYYY-MM-DD' days. */
function bsMonth(back: 0 | 1): { start: string; end: string } | null {
  const bs = adStringToBs(localTodayIso());
  if (!bs) return null;
  let year = bs.year;
  let month = bs.month - back;
  if (month < 0) {
    month += 12;
    year -= 1;
  }
  return { start: bsToAdString(year, month, 1), end: bsToAdString(year, month, bsDaysInMonth(year, month)) };
}

/** Short rupees for a chip: 4.5L, 1.2Cr, 12.5K. */
function shortNPR(n: number): string {
  const trim = (v: number) => String(Math.round(v * 10) / 10);
  if (n >= 1e7) return `${trim(n / 1e7)}Cr`;
  if (n >= 1e5) return `${trim(n / 1e5)}L`;
  if (n >= 1e3) return `${trim(n / 1e3)}K`;
  return String(Math.round(n));
}

interface CrmRow {
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

interface Form {
  name: string;
  phone: string;
  address: string;
  source: LeadSource | '';
  source_note: string;
  interested_in: string;
  status: LeadStatus;
  follow_up_on: string;
}
const EMPTY: Form = { name: '', phone: '', address: '', source: '', source_note: '', interested_in: '', status: 'new', follow_up_on: '' };
const formOf = (r: CrmRow | null): Form =>
  r
    ? { name: r.name, phone: r.phone, address: r.address, source: r.source ?? '', source_note: r.sourceNote, interested_in: r.lead?.interested_in ?? '', status: r.status, follow_up_on: r.followUp ?? '' }
    : EMPTY;

function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return (
    <View className="rounded-xl border border-gray-200 bg-white" style={[CARD_SHADOW, style]}>
      {children}
    </View>
  );
}

function SourcePill({ source, chevron }: { source: LeadSource | null; chevron?: boolean }) {
  const s = source ? SOURCE[source] : null;
  return (
    <View className="flex-row items-center rounded-full px-2.5 py-1" style={{ gap: 5, backgroundColor: s ? s.bg : '#FEF2F2' }}>
      {!!s && <Ionicons name={s.icon} size={12} color={s.color} />}
      <Text className="text-xs font-semibold" style={{ color: s ? s.color : '#DC2626' }}>
        {s ? s.label : 'Not tagged'}
      </Text>
      {chevron && <Ionicons name="chevron-down" size={12} color={s ? s.color : '#DC2626'} />}
    </View>
  );
}

function StatusPill({ status, chevron }: { status: LeadStatus; chevron?: boolean }) {
  const s = STATUS[status];
  return (
    <View className="flex-row items-center rounded-full px-2.5 py-1" style={{ gap: 4, backgroundColor: s.bg }}>
      <Text className="text-xs font-bold" style={{ color: s.color }}>
        {s.label}
      </Text>
      {chevron && <Ionicons name="chevron-down" size={12} color={s.color} />}
    </View>
  );
}

function FilterButton({ label, active }: { label: string; active?: boolean }) {
  return (
    <View className="h-9 flex-row items-center rounded-lg border bg-white px-3" style={{ gap: 6, borderColor: active ? BLUE : '#E5E7EB' }}>
      <Text className="text-[13px] font-semibold" style={{ color: active ? BLUE : '#374151' }}>
        {label}
      </Text>
      <Ionicons name="chevron-down" size={14} color="#9CA3AF" />
    </View>
  );
}

function Chip({ label, on, onPress, icon }: { label: string; on: boolean; onPress: () => void; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      className="flex-row items-center rounded-lg px-3 py-2"
      style={{ gap: 6, borderWidth: 1.5, borderColor: on ? BLUE : '#E5E7EB', backgroundColor: on ? '#EFF6FF' : '#fff' }}
    >
      {!!icon && <Ionicons name={icon} size={15} color={on ? BLUE : '#6B7280'} />}
      <Text className="text-xs font-bold" style={{ color: on ? BLUE : '#4B5563' }}>
        {label}
      </Text>
    </Pressable>
  );
}

function Field({ label, value, onChange, placeholder, phone, multiline }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; phone?: boolean; multiline?: boolean }) {
  const [focused, setFocused] = useState(false);
  return (
    <View className="mb-3">
      <Text className="mb-1 text-[11px] font-bold tracking-wide text-gray-500">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        placeholderTextColor="#9CA3AF"
        keyboardType={phone ? 'phone-pad' : undefined}
        multiline={multiline}
        className="rounded-lg bg-white px-3 py-2.5 text-sm text-gray-900"
        style={[{ borderWidth: 1, borderColor: focused ? BLUE : '#D1D5DB' }, multiline ? { minHeight: 64, textAlignVertical: 'top' } : null, { outlineStyle: 'none' } as object]}
      />
    </View>
  );
}

function IconButton({ icon, color, bg, label, onPress, disabled }: { icon: keyof typeof Ionicons.glyphMap; color: string; bg: string; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      className="items-center justify-center rounded-full"
      style={{ width: 32, height: 32, backgroundColor: bg, opacity: disabled ? 0.35 : 1 }}
    >
      <Ionicons name={icon} size={16} color={color} />
    </Pressable>
  );
}

export function CrmScreen() {
  const layout = useBookLayout();
  const profile = useAuthStore((state) => state.profile);
  const userId = profile?.id;
  const filters: Record<string, string> = userId ? { owner_id: userId } : {};
  const customersQ = useSupabaseQuery('customers', { filters, all: true, enabled: !!userId });
  const leadsQ = useSupabaseQuery('leads', { filters, all: true, enabled: !!userId });
  const salesQ = useSupabaseQuery('business_transactions', { filters, all: true, enabled: !!userId });
  const createLead = useSupabaseInsert('leads');
  const updateLead = useSupabaseUpdate('leads');
  const deleteLead = useSupabaseDelete('leads');
  const updateCustomer = useSupabaseUpdate('customers');

  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [referrer, setReferrer] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ row: CrmRow | null; form: Form; history: LeadHistoryEntry[] } | null>(null);
  const [logKind, setLogKind] = useState<LeadHistoryEntry['kind']>('call');
  const [logNote, setLogNote] = useState('');
  const [busy, setBusy] = useState(false);

  const today = localTodayIso();

  // ---- the rows -------------------------------------------------------------------------------------------------
  const rows: CrmRow[] = useMemo(() => {
    const customers = (customersQ.data ?? []) as Customer[];
    const leads = (leadsQ.data ?? []) as Lead[];
    const sales = ((salesQ.data ?? []) as BusinessTransaction[]).filter((t) => t.type === 'sale');
    const byId = new Map(customers.map((c) => [c.id, c]));
    const byName = new Map(customers.map((c) => [norm(c.name), c]));
    const spent = new Map<string, number>();
    for (const s of sales) if (s.customer_id) spent.set(s.customer_id, (spent.get(s.customer_id) ?? 0) + s.amount);

    const referredBy = (name: string) => leads.filter((l) => l.source === 'referral' && norm(l.source_note) === norm(name)).length;
    const covered = new Set<string>();
    const out: CrmRow[] = [];

    for (const l of leads) {
      const customer = (l.customer_id ? byId.get(l.customer_id) : undefined) ?? byName.get(norm(l.name));
      if (customer) covered.add(customer.id);
      const amount = customer ? spent.get(customer.id) ?? 0 : 0;
      const bought = amount > 0 || l.status === 'converted';
      out.push({
        key: `lead-${l.id}`,
        lead: l,
        customerId: customer?.id ?? null,
        name: customer?.name ?? l.name,
        phone: customer?.phone ?? l.phone ?? '',
        address: customer?.address ?? l.address ?? '',
        source: l.source,
        sourceNote: l.source_note ?? '',
        bought,
        status: bought ? 'converted' : l.status,
        followUp: l.follow_up_on,
        last: l.history?.[l.history.length - 1] ?? null,
        amount,
        createdAt: l.created_at,
        referred: referredBy(customer?.name ?? l.name),
      });
    }
    for (const c of customers) {
      const amount = spent.get(c.id) ?? 0;
      if (covered.has(c.id) || amount <= 0) continue;
      out.push({
        key: `customer-${c.id}`,
        lead: null,
        customerId: c.id,
        name: c.name,
        phone: c.phone ?? '',
        address: c.address ?? '',
        source: null,
        sourceNote: '',
        bought: true,
        status: 'converted',
        followUp: null,
        last: null,
        amount,
        createdAt: c.created_at,
        referred: referredBy(c.name),
      });
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [customersQ.data, leadsQ.data, salesQ.data]);

  // ---- the numbers on top ---------------------------------------------------------------------------------------
  const stats = useMemo(() => {
    const thisMonth = bsMonth(0);
    const lastMonth = bsMonth(1);
    const within = (r: CrmRow, w: { start: string; end: string } | null) => !!w && localDay(r.createdAt) >= w.start && localDay(r.createdAt) <= w.end;
    const added = rows.filter((r) => within(r, thisMonth)).length;
    const before = rows.filter((r) => within(r, lastMonth)).length;
    const due = rows.filter((r) => isOpen(r.status) && !!r.followUp && r.followUp <= today);
    const converted = rows.filter((r) => r.status === 'converted').length;
    return {
      total: rows.length,
      added,
      delta: before === 0 ? null : Math.round(((added - before) / before) * 100),
      before,
      due: due.length,
      overdue: due.filter((r) => (r.followUp ?? '') < today).length,
      convertedPct: rows.length ? Math.round((converted / rows.length) * 100) : 0,
    };
  }, [rows, today]);

  // ---- today's follow-ups: overdue, today, and the coming week --------------------------------------------------
  const followUps = useMemo(() => {
    const week = inDays(7);
    const due = rows.filter((r) => !!r.lead && isOpen(r.status) && !!r.followUp && r.followUp <= week).sort((a, b) => (a.followUp ?? '').localeCompare(b.followUp ?? ''));
    return {
      overdue: due.filter((r) => (r.followUp ?? '') < today),
      today: due.filter((r) => r.followUp === today),
      upcoming: due.filter((r) => (r.followUp ?? '') > today),
    };
  }, [rows, today]);
  const followUpTotal = followUps.overdue.length + followUps.today.length + followUps.upcoming.length;

  // ---- the list -------------------------------------------------------------------------------------------------
  const q = search.trim().toLowerCase();
  const matchesSource = (r: CrmRow, f: SourceFilter) => f === 'all' || (f === 'needs' ? r.source === null : r.source === f);
  const list = rows.filter((r) => {
    if (!matchesSource(r, sourceFilter)) return false;
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (referrer && !(r.source === null ? false : norm(r.sourceNote) === norm(referrer) && SOURCE[r.source].key === 'referral')) return false;
    return !q || [r.name, r.phone, r.address, r.lead?.interested_in ?? '', r.sourceNote].some((t) => t.toLowerCase().includes(q));
  });
  const chips: { key: SourceFilter; label: string; icon?: keyof typeof Ionicons.glyphMap }[] = [
    { key: 'all', label: 'All' },
    { key: 'needs', label: 'Not tagged' },
    ...LEAD_SOURCES.map((s) => ({ key: s.key as SourceFilter, label: s.label, icon: s.icon })),
  ];
  const chipRows = (k: SourceFilter) => rows.filter((r) => matchesSource(r, k));

  // ---- writing --------------------------------------------------------------------------------------------------
  const openDialog = (row: CrmRow | null, patch?: Partial<Form>) => {
    setLogKind('call');
    setLogNote('');
    setEditing({ row, form: { ...formOf(row), ...patch }, history: row?.lead?.history ?? [] });
  };

  /** Saves changes to a row's lead record. A customer with none gets one, but only once a source is chosen. */
  async function saveRow(row: CrmRow, patch: Partial<Lead>): Promise<boolean> {
    if (!userId) return false;
    try {
      if (row.lead) {
        await updateLead.mutateAsync({ id: row.lead.id, values: patch });
      } else if (patch.source) {
        await createLead.mutateAsync({
          owner_id: userId,
          customer_id: row.customerId,
          name: row.name,
          phone: row.phone || null,
          address: row.address || null,
          status: 'converted',
          history: [],
          ...patch,
        });
      }
      return true;
    } catch (err) {
      showAlert('Could not save', getErrorMessage(err));
      return false;
    }
  }

  const changeSource = (row: CrmRow, key: LeadSource) => {
    if (key === row.source) return;
    // Referral and Other need a few words more (who, or where), so they open the profile with the choice filled in.
    if (sourceNeedsNote(key)) openDialog(row, { source: key });
    else void saveRow(row, { source: key, source_note: null });
  };

  const markDone = (row: CrmRow) =>
    void saveRow(row, { follow_up_on: null, history: [...(row.lead?.history ?? []), { kind: 'note', note: 'Follow-up done', at: new Date().toISOString() }] });

  /** A call or WhatsApp tap goes into the history, and a New lead that was reached is Contacted. */
  const reach = (row: CrmRow, kind: 'call' | 'whatsapp') => {
    if (!row.phone) return;
    if (kind === 'call') void Linking.openURL(`tel:${row.phone}`);
    else {
      const first = row.name.trim().split(/\s+/)[0];
      const text = `Hello ${first}, this is ${profile?.business_name?.trim() || 'All In One Abroad'}. How can we help you?`;
      void Linking.openURL(`https://wa.me/${waNumber(row.phone)}?text=${encodeURIComponent(text)}`);
    }
    if (row.lead) {
      void saveRow(row, {
        history: [...(row.lead.history ?? []), { kind, note: '', at: new Date().toISOString() }],
        ...(row.lead.status === 'new' ? { status: 'contacted' as const } : null),
      });
    }
  };

  async function saveDialog() {
    if (!editing || !userId || busy) return;
    const f = editing.form;
    if (!f.name.trim()) return showAlert('Add a name', 'Enter the customer’s name.');
    if (!f.source) return showAlert('Pick where they came from', 'Choose how this customer found the shop under Lead from.');
    setBusy(true);
    try {
      const values = {
        name: f.name.trim(),
        phone: f.phone.trim() || null,
        address: f.address.trim() || null,
        source: f.source,
        source_note: sourceNeedsNote(f.source) ? f.source_note.trim() || null : null,
        interested_in: f.interested_in.trim() || null,
        status: editing.row?.bought ? ('converted' as const) : f.status,
        follow_up_on: f.follow_up_on || null,
      };
      if (editing.row?.lead) await updateLead.mutateAsync({ id: editing.row.lead.id, values });
      else await createLead.mutateAsync({ owner_id: userId, customer_id: editing.row?.customerId ?? null, ...values, history: [] });
      // A saved customer's own details stay one record: changing them here changes them in the Ledger too.
      if (editing.row?.customerId && (values.name !== editing.row.name || (values.phone ?? '') !== editing.row.phone || (values.address ?? '') !== editing.row.address)) {
        await updateCustomer.mutateAsync({ id: editing.row.customerId, values: { name: values.name, phone: values.phone, address: values.address } });
      }
      setEditing(null);
    } catch (err) {
      showAlert('Could not save', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function logContact() {
    const lead = editing?.row?.lead;
    if (!editing || !lead || busy) return;
    const note = logNote.trim();
    if (logKind === 'note' && !note) return showAlert('Write a note', 'Type what you want to remember.');
    const history = [...editing.history, { kind: logKind, note, at: new Date().toISOString() }];
    const status: LeadStatus = editing.form.status === 'new' && logKind !== 'note' ? 'contacted' : editing.form.status;
    setBusy(true);
    try {
      await updateLead.mutateAsync({ id: lead.id, values: { history, status } });
      setEditing((e) => (e ? { ...e, history, form: { ...e.form, status } } : e));
      setLogNote('');
    } catch (err) {
      showAlert('Could not add to history', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete() {
    const lead = editing?.row?.lead;
    if (!lead) return;
    showAlert('Remove from the CRM?', `${lead.name} and their follow-ups and history will be removed. Their sales and Ledger entry are not affected.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteLead.mutateAsync(lead.id);
            setEditing(null);
          } catch (err) {
            showAlert('Could not remove', getErrorMessage(err));
          }
        },
      },
    ]);
  }

  function exportCsv() {
    if (Platform.OS !== 'web') return;
    const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
    const head = ['Customer', 'Phone', 'Address', 'Lead source', 'Referred by / details', 'Lead status', 'Next follow-up', 'Transaction amount'];
    const body = list.map((r) => [r.name, r.phone, r.address, r.source ? SOURCE[r.source].label : 'Not tagged', r.sourceNote, STATUS[r.status].label, r.followUp ?? '', r.amount]);
    const blob = new Blob([[head, ...body].map((line) => line.map(cell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'crm-customers.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  if (customersQ.isLoading || leadsQ.isLoading || salesQ.isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50">
        <ActivityIndicator size="large" color={BLUE} />
      </View>
    );
  }

  // ---- table cells ----------------------------------------------------------------------------------------------
  const nameCell = (r: CrmRow) => (
    <View style={{ gap: 4 }}>
      <Text className="text-sm font-bold text-gray-900" numberOfLines={1}>
        {r.name}
      </Text>
      {r.referred > 0 && (
        <Pressable onPress={() => setReferrer(r.name)} accessibilityLabel={`Show everyone ${r.name} referred`} className="self-start rounded-full bg-amber-50 px-1.5 py-px">
          <Text className="text-[10px] font-bold text-amber-700">Referred {r.referred}</Text>
        </Pressable>
      )}
    </View>
  );
  const sourceCell = (r: CrmRow) => (
    <View style={{ gap: 4 }}>
      <SelectDropdown value={r.source} options={SOURCE_OPTIONS} onChange={(key) => changeSource(r, key)} accessibilityLabel={`Lead source, ${r.name}`} trigger={() => <SourcePill source={r.source} chevron />} />
      {!!r.sourceNote && (
        <Text className="text-[11px] text-gray-500" numberOfLines={1}>
          {r.sourceNote}
        </Text>
      )}
    </View>
  );
  const statusCell = (r: CrmRow) =>
    r.bought || !r.lead ? (
      <StatusPill status="converted" />
    ) : (
      <SelectDropdown
        value={r.status}
        options={PICKABLE_STATUSES.map((s) => ({ key: s.key, label: s.label }))}
        onChange={(key) => void saveRow(r, { status: key })}
        width={170}
        accessibilityLabel={`Lead status, ${r.name}`}
        trigger={() => <StatusPill status={r.status} chevron />}
      />
    );
  const lastCell = (r: CrmRow) =>
    r.last ? (
      <Text className="text-xs text-gray-600" numberOfLines={2}>
        {HISTORY_KINDS.find((k) => k.key === r.last?.kind)?.label} · {dayLabel(r.last.at)}
      </Text>
    ) : (
      <Text className="text-xs text-gray-300">—</Text>
    );
  const nextCell = (r: CrmRow) => {
    if (!r.followUp || !isOpen(r.status)) return <Text className="text-xs text-gray-300">—</Text>;
    const overdue = r.followUp < today;
    return (
      <View className="flex-row items-center" style={{ gap: 4 }}>
        <Ionicons name="alarm-outline" size={13} color={overdue ? '#B91C1C' : '#6B7280'} />
        <Text className="text-xs font-semibold" style={{ color: overdue ? '#B91C1C' : '#4B5563' }}>
          {r.followUp === today ? 'Today' : toBsHistoryLabel(r.followUp)}
        </Text>
      </View>
    );
  };
  const actionsCell = (r: CrmRow) => (
    <View className="flex-row" style={{ gap: 6 }}>
      <IconButton icon="call" color="#0369A1" bg="#E0F2FE" label={`Call ${r.name}`} onPress={() => reach(r, 'call')} disabled={!r.phone} />
      <IconButton icon="logo-whatsapp" color="#15803D" bg="#DCFCE7" label={`WhatsApp ${r.name}`} onPress={() => reach(r, 'whatsapp')} disabled={!r.phone} />
      <IconButton icon="eye-outline" color="#4B5563" bg="#F3F4F6" label={`View ${r.name}`} onPress={() => openDialog(r)} />
    </View>
  );

  const columns: BookColumn<CrmRow>[] = [
    { key: 'sn', label: 'SN', width: 44, render: (_r, i) => <Text className="text-xs text-gray-500">{i + 1}</Text> },
    { key: 'name', label: 'Customer', width: 150, grow: 1.4, render: nameCell },
    {
      key: 'contact',
      label: 'Contact',
      width: 130,
      grow: 1,
      render: (r) => (
        <View>
          <Text className="text-xs font-semibold text-gray-800" numberOfLines={1}>{r.phone || '—'}</Text>
          {!!r.address && <Text className="text-[11px] text-gray-400" numberOfLines={1}>{r.address}</Text>}
        </View>
      ),
    },
    { key: 'source', label: 'Lead Source', width: 150, grow: 1, render: sourceCell },
    { key: 'status', label: 'Lead Status', width: 120, render: statusCell },
    { key: 'last', label: 'Last Contact', width: 110, render: lastCell },
    { key: 'next', label: 'Next Follow-up', width: 120, render: nextCell },
    { key: 'amount', label: 'Transaction Amount', width: 120, align: 'right', render: (r) => <Text className="text-xs font-bold text-gray-900">{r.amount > 0 ? `NPR ${money(r.amount)}` : '—'}</Text> },
    { key: 'actions', label: '', width: 118, render: actionsCell },
  ];

  const sectionMeta = [
    { key: 'overdue' as const, label: 'Overdue', color: '#B91C1C', bg: '#FEF2F2' },
    { key: 'today' as const, label: 'Today', color: '#1D4ED8', bg: '#EFF6FF' },
    { key: 'upcoming' as const, label: 'Upcoming', color: '#475569', bg: '#F1F5F9' },
  ];
  const form = editing?.form;
  const sourceLabel = sourceFilter === 'all' ? 'Lead Source' : sourceFilter === 'needs' ? 'Not tagged' : SOURCE[sourceFilter].label;
  const statusLabel = statusFilter === 'all' ? 'Lead Status' : STATUS[statusFilter].label;

  return (
    <BookPage wide={layout.wide}>
      {/* Add Customer, and Export on the web */}
      <View className="flex-row flex-wrap items-center justify-end" style={{ gap: 8 }}>
        {Platform.OS === 'web' && (
          <Pressable onPress={exportCsv} disabled={list.length === 0} className="h-9 flex-row items-center rounded-lg border border-gray-200 bg-white px-3.5 disabled:opacity-50" style={{ gap: 6 }}>
            <Ionicons name="download-outline" size={15} color="#374151" />
            <Text className="text-[13px] font-semibold text-gray-700">Export</Text>
          </Pressable>
        )}
        <ToolbarButton icon="add" label="Add Customer" onPress={() => openDialog(null)} />
      </View>

      {/* Stat cards */}
      <View className="flex-row flex-wrap" style={{ gap: layout.wide ? 12 : 8 }}>
        {[
          { label: 'Total Customers', value: String(stats.total), icon: 'people' as const, tint: '#DBEAFE', color: '#2563EB', trend: `+${stats.added} this month`, good: stats.added > 0 ? true : null },
          {
            label: 'New This Month',
            value: String(stats.added),
            icon: 'person-add' as const,
            tint: '#D1FAE5',
            color: '#16A34A',
            trend: stats.delta === null ? (stats.before === 0 ? 'Nothing last month to compare' : '') : `${stats.delta >= 0 ? '+' : ''}${stats.delta}% vs last month`,
            good: stats.delta === null ? null : stats.delta >= 0,
          },
          {
            label: 'Follow-ups Due',
            value: String(stats.due),
            icon: 'alarm' as const,
            tint: '#FFEDD5',
            color: '#EA580C',
            trend: stats.overdue > 0 ? `${stats.overdue} overdue` : stats.due === 0 ? 'Nothing waiting' : 'None overdue',
            good: stats.overdue > 0 ? false : true,
          },
          { label: 'Converted Leads', value: `${stats.convertedPct}%`, icon: 'checkmark-circle' as const, tint: '#D1FAE5', color: '#10B981', trend: `${rows.filter((r) => r.status === 'converted').length} of ${stats.total} customers`, good: null },
        ].map((c) => (
          <Card key={c.label} style={{ flexGrow: 1, flexBasis: 200, padding: 16 }}>
            <View className="flex-row items-start" style={{ gap: 12 }}>
              <View className="items-center justify-center rounded-2xl" style={{ width: 46, height: 46, backgroundColor: c.tint }}>
                <Ionicons name={c.icon} size={22} color={c.color} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text className="text-[13px] font-medium text-gray-500" numberOfLines={1}>{c.label}</Text>
                <Text className="text-[26px] font-extrabold leading-8 text-gray-900">{c.value}</Text>
                {!!c.trend && (
                  <Text className="mt-0.5 text-[11px] font-semibold" style={{ color: c.good === true ? '#059669' : c.good === false ? '#DC2626' : '#9CA3AF' }} numberOfLines={1}>
                    {c.trend}
                  </Text>
                )}
              </View>
            </View>
          </Card>
        ))}
      </View>

      {/* Today's follow-ups */}
      <Card>
        <View className="flex-row flex-wrap items-center justify-between px-4 pb-2 pt-4" style={{ gap: 8 }}>
          <View className="flex-row items-center" style={{ gap: 8 }}>
            <View className="items-center justify-center rounded-lg bg-blue-50" style={{ width: 32, height: 32 }}>
              <Ionicons name="calendar" size={17} color={BLUE} />
            </View>
            <Text className="text-base font-bold text-gray-900">Today's Follow-ups</Text>
          </View>
          <View className="flex-row flex-wrap" style={{ gap: 6 }}>
            {sectionMeta.map((s) => followUps[s.key].length > 0 && (
              <View key={s.key} className="rounded-full px-2 py-1" style={{ backgroundColor: s.bg }}>
                <Text className="text-[11px] font-bold" style={{ color: s.color }}>{s.label} {followUps[s.key].length}</Text>
              </View>
            ))}
          </View>
        </View>
        {followUpTotal === 0 ? (
          <Text className="px-4 pb-4 text-sm text-gray-500">Nothing scheduled for today or the coming week.</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingHorizontal: 16, paddingBottom: 16, paddingTop: 4 }}>
            {sectionMeta.flatMap((s) =>
              followUps[s.key].map((r) => (
                <View key={r.key} className="rounded-xl border border-gray-200 bg-white px-3 py-2.5" style={{ width: 252, borderLeftWidth: 4, borderLeftColor: s.color }}>
                  <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
                    <Text className="text-[11px] font-semibold text-gray-500">{r.followUp === today ? 'Today' : toBsHistoryLabel(r.followUp ?? today)}</Text>
                    <View className="rounded-full px-1.5 py-0.5" style={{ backgroundColor: s.bg }}>
                      <Text className="text-[10px] font-bold" style={{ color: s.color }}>{s.label}</Text>
                    </View>
                  </View>
                  <Pressable onPress={() => openDialog(r)}>
                    <Text className="mt-1 text-sm font-bold text-gray-900" numberOfLines={1}>{r.name}</Text>
                  </Pressable>
                  <Text className="text-xs text-gray-500" numberOfLines={1}>{r.lead?.interested_in || 'Follow up'}</Text>
                  <View className="mt-2 flex-row" style={{ gap: 6 }}>
                    <IconButton icon="checkmark" color="#047857" bg="#ECFDF5" label={`Mark follow-up with ${r.name} done`} onPress={() => markDone(r)} />
                    <IconButton icon="calendar-outline" color="#4B5563" bg="#F3F4F6" label={`Reschedule ${r.name}`} onPress={() => openDialog(r)} />
                    <IconButton icon="eye-outline" color="#4B5563" bg="#F3F4F6" label={`View ${r.name}`} onPress={() => openDialog(r)} />
                  </View>
                </View>
              ))
            )}
          </ScrollView>
        )}
      </Card>

      {/* Search, Lead Source and Lead Status */}
      <View className="flex-row flex-wrap items-center" style={{ gap: 8 }}>
        <ToolbarSearch value={search} onChange={setSearch} placeholder="Search name, phone or address" wide={false} />
        <SelectDropdown<SourceFilter>
          value={sourceFilter}
          options={[{ key: 'all', label: 'All lead sources' }, { key: 'needs', label: 'Not tagged' }, ...SOURCE_OPTIONS]}
          onChange={setSourceFilter}
          accessibilityLabel="Lead source"
          trigger={() => <FilterButton label={sourceLabel} active={sourceFilter !== 'all'} />}
        />
        <SelectDropdown<StatusFilter>
          value={statusFilter}
          options={[{ key: 'all', label: 'All lead statuses' }, ...LEAD_STATUSES.map((s) => ({ key: s.key, label: s.label }))]}
          onChange={setStatusFilter}
          width={190}
          accessibilityLabel="Lead status"
          trigger={() => <FilterButton label={statusLabel} active={statusFilter !== 'all'} />}
        />
      </View>

      {/* Quick filter by lead source: how many customers and what they have bought */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {chips.map((c) => {
          const on = sourceFilter === c.key;
          const group = chipRows(c.key);
          const amount = group.reduce((sum, r) => sum + r.amount, 0);
          const warn = c.key === 'needs' && group.length > 0;
          return (
            <Pressable
              key={c.key}
              onPress={() => setSourceFilter(c.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              className="flex-row items-center rounded-full px-3.5"
              style={{ height: 40, gap: 6, backgroundColor: on ? BLUE : '#FFFFFF', borderWidth: 1, borderColor: on ? BLUE : '#E5E7EB' }}
            >
              {!!c.icon && <Ionicons name={c.icon} size={14} color={on ? '#fff' : '#374151'} />}
              <Text className="text-sm font-semibold" style={{ color: on ? '#fff' : '#374151' }}>{c.label}</Text>
              <View className="items-center justify-center rounded-full px-1.5" style={{ minWidth: 22, height: 20, backgroundColor: on ? 'rgba(255,255,255,0.28)' : warn ? '#FEF3C7' : '#F1F5F9' }}>
                <Text className="text-[11px] font-bold" style={{ color: on ? '#fff' : warn ? '#B45309' : '#475569' }}>{group.length}</Text>
              </View>
              {amount > 0 && <Text className="text-xs font-medium" style={{ color: on ? 'rgba(255,255,255,0.85)' : '#9CA3AF' }}>{shortNPR(amount)}</Text>}
            </Pressable>
          );
        })}
      </ScrollView>

      {!!referrer && (
        <View className="flex-row items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5" style={{ gap: 10 }}>
          <Text className="flex-1 text-sm text-amber-900">
            Customers referred by <Text className="font-bold">{referrer}</Text> ({list.length})
          </Text>
          <Pressable onPress={() => setReferrer(null)} hitSlop={8} className="flex-row items-center" style={{ gap: 4 }}>
            <Ionicons name="close" size={14} color="#92400E" />
            <Text className="text-sm font-semibold text-amber-800">Show all</Text>
          </Pressable>
        </View>
      )}

      {/* The customers */}
      {list.length === 0 ? (
        <Card style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24 }}>
          <Ionicons name="heart-outline" size={34} color="#D1D5DB" />
          <Text className="mt-2 font-medium text-gray-500">{rows.length === 0 ? 'No customers yet' : 'No customers match'}</Text>
          <Text className="mt-1 text-center text-xs text-gray-400">
            {rows.length === 0 ? 'Customers appear here once they have bought, or add one with Add Customer.' : 'Try clearing the search or the filters.'}
          </Text>
        </Card>
      ) : layout.full ? (
        <BookTable columns={columns} rows={list} rowKey={(r) => r.key} onRowPress={(r) => openDialog(r)} dense />
      ) : (
        <View style={{ gap: 10 }}>
          {list.map((r) => (
            <Pressable key={r.key} onPress={() => openDialog(r)} className="rounded-xl border border-gray-200 bg-white p-3.5" style={CARD_SHADOW}>
              <View className="flex-row items-start justify-between" style={{ gap: 8 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text className="text-[15px] font-bold text-gray-900" numberOfLines={1}>{r.name}</Text>
                  <Text className="mt-0.5 text-xs text-gray-500" numberOfLines={1}>{[r.phone, r.address].filter(Boolean).join(' · ') || 'No phone yet'}</Text>
                </View>
                {statusCell(r)}
              </View>
              <View className="mt-2.5 flex-row flex-wrap items-center" style={{ gap: 10 }}>
                {sourceCell(r)}
                {nextCell(r)}
                {r.referred > 0 && <Pressable onPress={() => setReferrer(r.name)}><Text className="text-[11px] font-bold text-amber-700">Referred {r.referred}</Text></Pressable>}
              </View>
              <View className="mt-3 flex-row items-center justify-between" style={{ gap: 8 }}>
                <Text className="text-sm font-bold text-gray-900">{r.amount > 0 ? `NPR ${money(r.amount)}` : ''}</Text>
                {actionsCell(r)}
              </View>
            </Pressable>
          ))}
        </View>
      )}

      {/* A customer's profile: details, status, follow-up and the history of contacts */}
      <Modal visible={!!editing} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View className="flex-1 items-center justify-center bg-black/40 px-3 sm:px-6">
          {editing && form && (
            <View className="w-full rounded-2xl bg-white" style={{ maxWidth: 560, maxHeight: '92%', padding: 20, boxShadow: '0 20px 50px rgba(16,24,40,0.25)' } as object}>
              <View className="mb-3 flex-row items-center justify-between">
                <Text className="text-lg font-extrabold text-gray-900">{editing.row ? editing.row.name : 'Add Customer'}</Text>
                <Pressable onPress={() => setEditing(null)} hitSlop={8} accessibilityLabel="Close">
                  <Ionicons name="close" size={24} color="#374151" />
                </Pressable>
              </View>
              <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
                <Field label="Name" value={form.name} onChange={(v) => setEditing((e) => (e ? { ...e, form: { ...e.form, name: v } } : e))} placeholder="Full name" />
                <View className="flex-row" style={{ gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Field label="Phone" value={form.phone} onChange={(v) => setEditing((e) => (e ? { ...e, form: { ...e.form, phone: v } } : e))} placeholder="98XXXXXXXX" phone />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field label="Address" value={form.address} onChange={(v) => setEditing((e) => (e ? { ...e, form: { ...e.form, address: v } } : e))} placeholder="Optional" />
                  </View>
                </View>
                <Field label="Interested in" value={form.interested_in} onChange={(v) => setEditing((e) => (e ? { ...e, form: { ...e.form, interested_in: v } } : e))} placeholder="e.g. 3-piece luggage set, rice cooker" multiline />

                <Text className="mb-1.5 text-[11px] font-bold tracking-wide text-gray-500">Lead from</Text>
                <View className="mb-3 flex-row flex-wrap" style={{ gap: 8 }}>
                  {LEAD_SOURCES.map((s) => (
                    <Chip key={s.key} label={s.label} icon={s.icon} on={form.source === s.key} onPress={() => setEditing((e) => (e ? { ...e, form: { ...e.form, source: s.key } } : e))} />
                  ))}
                </View>
                {sourceNeedsNote(form.source) && (
                  <Field
                    label={form.source === 'referral' ? 'Referred by' : 'Details'}
                    value={form.source_note}
                    onChange={(v) => setEditing((e) => (e ? { ...e, form: { ...e.form, source_note: v } } : e))}
                    placeholder={form.source === 'referral' ? 'Who sent them' : 'e.g. signboard, Instagram'}
                  />
                )}

                <Text className="mb-1.5 text-[11px] font-bold tracking-wide text-gray-500">Lead status</Text>
                {editing.row?.bought ? (
                  <Text className="mb-3 text-xs text-gray-500">Converted: this customer has bought, so the status is set automatically.</Text>
                ) : (
                  <View className="mb-3 flex-row flex-wrap" style={{ gap: 8 }}>
                    {PICKABLE_STATUSES.map((s) => (
                      <Chip key={s.key} label={s.label} on={form.status === s.key} onPress={() => setEditing((e) => (e ? { ...e, form: { ...e.form, status: s.key } } : e))} />
                    ))}
                  </View>
                )}

                <Text className="mb-1.5 text-[11px] font-bold tracking-wide text-gray-500">Follow up</Text>
                <View className="mb-4 flex-row flex-wrap" style={{ gap: 8 }}>
                  {FOLLOW_UPS.map((f) => {
                    const iso = f.days == null ? '' : inDays(f.days);
                    return <Chip key={f.label} label={f.label} on={form.follow_up_on === iso} onPress={() => setEditing((e) => (e ? { ...e, form: { ...e.form, follow_up_on: iso } } : e))} />;
                  })}
                  {!!form.follow_up_on && !FOLLOW_UPS.some((f) => f.days != null && inDays(f.days) === form.follow_up_on) && <Chip label={toBsHistoryLabel(form.follow_up_on)} on onPress={() => {}} />}
                </View>

                {!!editing.row?.lead && (
                  <View className="mb-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
                    <Text className="mb-2 text-[11px] font-bold tracking-wide text-gray-500">Contact history</Text>
                    <View className="mb-2 flex-row flex-wrap" style={{ gap: 8 }}>
                      {CONTACT_KINDS.map((k) => (
                        <Chip key={k.key} label={k.label} icon={k.icon} on={logKind === k.key} onPress={() => setLogKind(k.key)} />
                      ))}
                    </View>
                    <View className="flex-row items-center" style={{ gap: 8 }}>
                      <TextInput
                        value={logNote}
                        onChangeText={setLogNote}
                        placeholder={logKind === 'note' ? 'What do you want to remember?' : 'What was said (optional)'}
                        placeholderTextColor="#9CA3AF"
                        className="flex-1 rounded-lg bg-white px-3 py-2.5 text-sm text-gray-900"
                        style={[{ borderWidth: 1, borderColor: '#D1D5DB' }, { outlineStyle: 'none' } as object]}
                        onSubmitEditing={logContact}
                      />
                      <Pressable onPress={logContact} disabled={busy} className="rounded-lg px-3.5 py-2.5 disabled:opacity-50" style={{ backgroundColor: BLUE }}>
                        <Text className="text-xs font-bold text-white">Add</Text>
                      </Pressable>
                    </View>
                    {editing.history.length === 0 ? (
                      <Text className="mt-3 text-xs text-gray-400">No contact logged yet.</Text>
                    ) : (
                      <View className="mt-3" style={{ gap: 8 }}>
                        {[...editing.history].reverse().map((h, i) => {
                          const kind = HISTORY_KINDS.find((k) => k.key === h.kind);
                          return (
                            <View key={`${h.at}-${i}`} className="flex-row" style={{ gap: 8 }}>
                              <Ionicons name={kind?.icon ?? 'document-text'} size={15} color="#6B7280" style={{ marginTop: 1 }} />
                              <View style={{ flex: 1 }}>
                                <Text className="text-xs font-semibold text-gray-700">{kind?.label} · {dayLabel(h.at)}</Text>
                                {!!h.note && <Text className="text-xs text-gray-500">{h.note}</Text>}
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </View>
                )}
              </ScrollView>
              <View className="mt-3 flex-row items-center border-t border-gray-100 pt-3" style={{ gap: 10 }}>
                {!!editing.row?.lead && (
                  <Pressable onPress={confirmDelete} className="rounded-xl border border-red-200 px-4 py-3">
                    <Text className="text-sm font-bold text-red-600">Remove</Text>
                  </Pressable>
                )}
                <View className="flex-1" />
                <Pressable onPress={() => setEditing(null)} className="rounded-xl border border-gray-300 bg-white px-5 py-3">
                  <Text className="text-sm font-bold text-gray-600">Cancel</Text>
                </Pressable>
                <Pressable onPress={saveDialog} disabled={busy} className="rounded-xl px-6 py-3 disabled:opacity-50" style={{ backgroundColor: '#1D4ED8' }}>
                  <Text className="text-sm font-bold text-white">Save</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </Modal>
    </BookPage>
  );
}
