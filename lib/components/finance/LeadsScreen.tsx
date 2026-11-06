// lib/components/finance/LeadsScreen.tsx
//
// Leads, kept the way Auto Stock Manager keeps its CRM leads: one card per person with a status (New, Contacted,
// Interested, Converted, Lost), where they came from, what they want, the day to follow up, and a history of every
// contact. Call and WhatsApp are on the left of every card. Tap a card to edit it and log a contact.
import { useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../hooks/useAuth';
import { useSupabaseDelete, useSupabaseQuery, useSupabaseUpdate } from '../../hooks/useSupabase';
import { BookPage, BookStat, BookStats, ToolbarSearch, useBookLayout } from './BookKit';
import { LEAD_SOURCES, sourceNeedsNote } from './leadKit';
import { toBsHistoryLabel } from '../../utils/nepaliDate';
import { localTodayIso } from '../../utils/localDate';
import { showAlert, getErrorMessage } from '../../utils/alert';
import type { Lead, LeadHistoryEntry, LeadSource, LeadStatus } from '../../../types/database.types';

type IconName = keyof typeof Ionicons.glyphMap;
type Tab = 'all' | LeadStatus;

const ACCENT = '#2563EB';

const STATUSES: { key: LeadStatus; label: string; color: string; bg: string }[] = [
  { key: 'new', label: 'New', color: '#047857', bg: '#ECFDF5' },
  { key: 'contacted', label: 'Contacted', color: '#1D4ED8', bg: '#EFF6FF' },
  { key: 'interested', label: 'Interested', color: '#C2410C', bg: '#FFF7ED' },
  { key: 'converted', label: 'Converted', color: '#065F46', bg: '#D1FAE5' },
  { key: 'lost', label: 'Lost', color: '#B91C1C', bg: '#FEF2F2' },
];
const STATUS = Object.fromEntries(STATUSES.map((s) => [s.key, s])) as Record<LeadStatus, (typeof STATUSES)[number]>;

const SOURCES = LEAD_SOURCES;
const SOURCE = Object.fromEntries(SOURCES.map((s) => [s.key, s])) as Record<LeadSource, (typeof SOURCES)[number]>;

// What can be logged by hand from a lead; a Sale line is written by the Record Sale form, so it has no button here.
const KINDS: { key: LeadHistoryEntry['kind']; label: string; icon: IconName }[] = [
  { key: 'call', label: 'Call', icon: 'call' },
  { key: 'whatsapp', label: 'WhatsApp', icon: 'logo-whatsapp' },
  { key: 'visit', label: 'Visit', icon: 'storefront' },
  { key: 'note', label: 'Note', icon: 'document-text' },
];
const HISTORY_KINDS: { key: LeadHistoryEntry['kind']; label: string; icon: IconName }[] = [
  ...KINDS,
  { key: 'sale', label: 'Sale', icon: 'bag-handle' },
];

interface LeadForm {
  name: string;
  phone: string;
  address: string;
  source: LeadSource;
  source_note: string;
  interested_in: string;
  status: LeadStatus;
  follow_up_on: string;
}

const formOf = (l: Lead): LeadForm => ({
  name: l.name,
  phone: l.phone ?? '',
  address: l.address ?? '',
  source: l.source,
  source_note: l.source_note ?? '',
  interested_in: l.interested_in ?? '',
  status: l.status,
  follow_up_on: l.follow_up_on ?? '',
});

const pad = (n: number) => String(n).padStart(2, '0');
/** Today plus `n` days, as 'YYYY-MM-DD'. */
function inDays(n: number): string {
  const [y, m, d] = localTodayIso().split('-').map(Number);
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

const FOLLOW_UPS = [
  { label: 'None', days: null },
  { label: 'Today', days: 0 },
  { label: 'Tomorrow', days: 1 },
  { label: 'In 3 days', days: 3 },
  { label: 'Next week', days: 7 },
  { label: 'In 2 weeks', days: 14 },
] as const;

/** "Today", "Yesterday", "3 days ago" ... counted in calendar days, so a lead from last night is "Yesterday". */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(new Date()) - start(d)) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return days <= 30 ? `${days} days ago` : toBsHistoryLabel(iso);
}

/** Nepali mobile numbers are typed as 98XXXXXXXX; wa.me needs the country code. */
function waNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 10 ? `977${digits}` : digits;
}

const isOpen = (l: Lead) => l.status !== 'converted' && l.status !== 'lost';

function Chip({ label, on, onPress, icon }: { label: string; on: boolean; onPress: () => void; icon?: IconName }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      className="flex-row items-center rounded-lg px-3 py-2"
      style={{ gap: 6, borderWidth: 1.5, borderColor: on ? ACCENT : '#E5E7EB', backgroundColor: on ? '#EFF6FF' : '#fff' }}
    >
      {!!icon && <Ionicons name={icon} size={15} color={on ? ACCENT : '#6B7280'} />}
      <Text className="text-xs font-bold" style={{ color: on ? ACCENT : '#4B5563' }}>
        {label}
      </Text>
    </Pressable>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'phone-pad';
  multiline?: boolean;
}) {
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
        keyboardType={keyboardType}
        multiline={multiline}
        className="rounded-lg bg-white px-3 py-2.5 text-sm text-gray-900"
        style={[{ borderWidth: 1, borderColor: focused ? ACCENT : '#D1D5DB' }, multiline ? { minHeight: 64, textAlignVertical: 'top' } : null, { outlineStyle: 'none' } as object]}
      />
    </View>
  );
}

export function LeadsScreen() {
  const layout = useBookLayout();
  const profile = useAuthStore((state) => state.profile);
  const userId = profile?.id;
  const { data, isLoading } = useSupabaseQuery('leads', {
    filters: userId ? { owner_id: userId } : {},
    all: true,
    enabled: !!userId,
  });
  const updateLead = useSupabaseUpdate('leads');
  const deleteLead = useSupabaseDelete('leads');

  const [tab, setTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<{ id: string; form: LeadForm; history: LeadHistoryEntry[] } | null>(null);
  const [logKind, setLogKind] = useState<LeadHistoryEntry['kind']>('call');
  const [logNote, setLogNote] = useState('');
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<TextInput>(null);

  const today = localTodayIso();
  const leads: Lead[] = useMemo(
    () => [...((data ?? []) as Lead[])].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [data]
  );
  const count = (status: LeadStatus) => leads.filter((l) => l.status === status).length;
  const dueCount = leads.filter((l) => isOpen(l) && !!l.follow_up_on && l.follow_up_on <= today).length;

  const q = search.trim().toLowerCase();
  const shown = leads.filter((l) => {
    if (tab !== 'all' && l.status !== tab) return false;
    if (!q) return true;
    return [l.name, l.phone ?? '', l.address ?? '', l.interested_in ?? '', l.source_note ?? '', SOURCE[l.source].label].some((t) => t.toLowerCase().includes(q));
  });

  const tabs: { key: Tab; label: string }[] = [
    { key: 'all', label: `All (${leads.length})` },
    ...STATUSES.map((s) => ({ key: s.key as Tab, label: `${s.label} (${count(s.key)})` })),
  ];

  const set = <K extends keyof LeadForm>(key: K) => (value: LeadForm[K]) =>
    setEditing((e) => (e ? { ...e, form: { ...e.form, [key]: value } } : e));

  const openEdit = (l: Lead) => {
    setLogKind('call');
    setLogNote('');
    setEditing({ id: l.id, form: formOf(l), history: l.history ?? [] });
  };

  const valuesOf = (f: LeadForm) => ({
    name: f.name.trim(),
    phone: f.phone.trim() || null,
    address: f.address.trim() || null,
    source: f.source,
    source_note: sourceNeedsNote(f.source) ? f.source_note.trim() || null : null,
    interested_in: f.interested_in.trim() || null,
    status: f.status,
    follow_up_on: f.follow_up_on || null,
  });

  async function save() {
    if (!editing || !userId || busy) return;
    if (!editing.form.name.trim()) {
      showAlert('Add a name', 'Enter the lead’s name.');
      nameRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const values = valuesOf(editing.form);
      await updateLead.mutateAsync({ id: editing.id, values });
      setEditing(null);
    } catch (err) {
      showAlert('Could not save', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Writes a contact into the lead's history straight away. A New lead that was called, messaged or visited is Contacted.
  async function logContact() {
    if (!editing?.id || busy) return;
    const note = logNote.trim();
    if (logKind === 'note' && !note) {
      showAlert('Write a note', 'Type what you want to remember.');
      return;
    }
    const history = [...editing.history, { kind: logKind, note, at: new Date().toISOString() }];
    const status: LeadStatus = editing.form.status === 'new' && logKind !== 'note' ? 'contacted' : editing.form.status;
    setBusy(true);
    try {
      await updateLead.mutateAsync({ id: editing.id, values: { history, status } });
      setEditing((e) => (e ? { ...e, history, form: { ...e.form, status } } : e));
      setLogNote('');
    } catch (err) {
      showAlert('Could not add to history', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete() {
    const id = editing?.id;
    if (!id) return;
    showAlert('Delete this lead?', `${editing?.form.name} and the history of contacts with them will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteLead.mutateAsync(id);
            setEditing(null);
          } catch (err) {
            showAlert('Could not delete', getErrorMessage(err));
          }
        },
      },
    ]);
  }

  const greeting = (l: Lead) => {
    const first = l.name.trim().split(/\s+/)[0];
    const about = l.interested_in ? ` about ${l.interested_in}` : '';
    return `Hello ${first}, this is ${profile?.business_name?.trim() || 'All In One Abroad'}. Thank you for contacting us${about}. How can we help you?`;
  };
  const call = (l: Lead) => l.phone && void Linking.openURL(`tel:${l.phone}`);
  const whatsapp = (l: Lead) => l.phone && void Linking.openURL(`https://wa.me/${waNumber(l.phone)}?text=${encodeURIComponent(greeting(l))}`);

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50">
        <ActivityIndicator size="large" color={ACCENT} />
      </View>
    );
  }

  const form = editing?.form;

  return (
    <BookPage wide={layout.wide}>
      <View className="flex-row flex-wrap items-center justify-between" style={{ gap: 12 }}>
        <Text className="text-sm text-gray-500">
          {leads.length} {leads.length === 1 ? 'lead' : 'leads'} kept
          {dueCount > 0 ? ` · ${dueCount} to follow up` : ''}
        </Text>
        <View className="flex-row flex-wrap items-center" style={{ gap: 8 }}>
          <ToolbarSearch value={search} onChange={setSearch} placeholder="Search name, phone, interest..." wide={layout.wide} />
        </View>
      </View>

      <BookStats>
        <BookStat label="Total leads" value={String(leads.length)} color="#374151" />
        <BookStat label="New" value={String(count('new'))} color="#047857" onPress={() => setTab('new')} active={tab === 'new'} />
        <BookStat label="To follow up" value={String(dueCount)} color={dueCount ? '#B91C1C' : '#374151'} />
        <BookStat label="Converted" value={String(count('converted'))} color="#065F46" onPress={() => setTab('converted')} active={tab === 'converted'} />
      </BookStats>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {tabs.map((t) => {
          const on = t.key === tab;
          return (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              className="rounded-full px-3.5 py-2"
              style={{ backgroundColor: on ? ACCENT : '#fff', borderWidth: 1, borderColor: on ? ACCENT : '#E5E7EB' }}
            >
              <Text className="text-xs font-bold" style={{ color: on ? '#fff' : '#4B5563' }}>
                {t.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {shown.length === 0 ? (
        <View className="items-center rounded-xl border border-gray-200 bg-white py-12">
          <Ionicons name="megaphone-outline" size={34} color="#D1D5DB" />
          <Text className="mt-2 font-medium text-gray-500">{leads.length === 0 ? 'No leads yet' : 'No leads here'}</Text>
          <Text className="mt-1 px-6 text-center text-xs text-gray-400">
            {leads.length === 0 ? 'Leads come from sales: on Record Sale, pick where the customer found the shop under Lead.' : 'Try another tab or clear the search'}
          </Text>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          {shown.map((l) => {
            const status = STATUS[l.status];
            const source = SOURCE[l.source];
            const day = dayLabel(l.created_at);
            const overdue = isOpen(l) && !!l.follow_up_on && l.follow_up_on <= today;
            const last = l.history?.[l.history.length - 1];
            return (
              <Pressable
                key={l.id}
                onPress={() => openEdit(l)}
                className="flex-row rounded-xl border border-gray-200 bg-white p-3.5"
                style={{ gap: 12, boxShadow: '0 1px 2px rgba(16,24,40,0.06)' } as object}
              >
                <View style={{ gap: 8 }}>
                  {(['call', 'whatsapp'] as const).map((k) => (
                    <Pressable
                      key={k}
                      onPress={() => (k === 'call' ? call(l) : whatsapp(l))}
                      disabled={!l.phone}
                      accessibilityLabel={`${k === 'call' ? 'Call' : 'WhatsApp'} ${l.name}`}
                      className="items-center justify-center rounded-full"
                      style={{ width: 38, height: 38, backgroundColor: k === 'call' ? '#E0F2FE' : '#DCFCE7', opacity: l.phone ? 1 : 0.35 }}
                    >
                      <Ionicons name={k === 'call' ? 'call' : 'logo-whatsapp'} size={18} color={k === 'call' ? '#0369A1' : '#15803D'} />
                    </Pressable>
                  ))}
                </View>

                <View style={{ flex: 1, minWidth: 0 }}>
                  <View className="flex-row items-start justify-between" style={{ gap: 8 }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text className="text-[15px] font-bold text-gray-900" numberOfLines={1}>
                        {l.name}
                      </Text>
                      <Text className="mt-0.5 text-xs text-gray-500" numberOfLines={1}>
                        {[l.phone, l.address].filter(Boolean).join(' · ') || 'No phone yet'}
                      </Text>
                    </View>
                    <View className="items-end" style={{ gap: 4 }}>
                      <View className="rounded-full px-2.5 py-0.5" style={{ backgroundColor: status.bg }}>
                        <Text className="text-[11px] font-bold" style={{ color: status.color }}>
                          {status.label}
                        </Text>
                      </View>
                      <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: day === 'Today' ? ACCENT : day === 'Yesterday' ? '#FEF3C7' : '#F3F4F6' }}>
                        <Text className="text-[10.5px] font-semibold" style={{ color: day === 'Today' ? '#fff' : day === 'Yesterday' ? '#92400E' : '#6B7280' }}>
                          {day}
                        </Text>
                      </View>
                    </View>
                  </View>

                  {!!l.interested_in && (
                    <Text className="mt-1.5 text-sm text-gray-700" numberOfLines={2}>
                      {l.interested_in}
                    </Text>
                  )}

                  <View className="mt-2 flex-row flex-wrap items-center" style={{ gap: 8 }}>
                    <View className="flex-row items-center rounded-full px-2 py-0.5" style={{ gap: 4, backgroundColor: source.bg }}>
                      <Ionicons name={source.icon} size={11} color={source.color} />
                      <Text className="text-[11px] font-semibold" style={{ color: source.color }}>
                        {source.label}
                        {l.source_note ? ` · ${l.source_note}` : ''}
                      </Text>
                    </View>
                    {!!l.follow_up_on && isOpen(l) && (
                      <View className="flex-row items-center" style={{ gap: 4 }}>
                        <Ionicons name="alarm-outline" size={13} color={overdue ? '#B91C1C' : '#6B7280'} />
                        <Text className="text-[11.5px] font-semibold" style={{ color: overdue ? '#B91C1C' : '#6B7280' }}>
                          {l.follow_up_on === today ? 'Follow up today' : `${overdue ? 'Was due' : 'Follow up'} ${toBsHistoryLabel(l.follow_up_on)}`}
                        </Text>
                      </View>
                    )}
                  </View>

                  {!!last && (
                    <Text className="mt-2 text-xs text-gray-400" numberOfLines={1}>
                      {HISTORY_KINDS.find((k) => k.key === last.kind)?.label} · {dayLabel(last.at)}
                      {last.note ? ` · ${last.note}` : ''}
                    </Text>
                  )}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      <Modal visible={!!editing} transparent animationType="fade" onRequestClose={() => setEditing(null)}>
        <View className="flex-1 items-center justify-center bg-black/40 px-3 sm:px-6">
          {editing && form && (
            <View
              className="w-full rounded-2xl bg-white"
              style={{ maxWidth: 560, maxHeight: '92%', padding: 20, boxShadow: '0 20px 50px rgba(16,24,40,0.25)' } as object}
            >
              <View className="mb-3 flex-row items-center justify-between">
                <Text className="text-lg font-extrabold text-gray-900">Edit lead</Text>
                <Pressable onPress={() => setEditing(null)} hitSlop={8} accessibilityLabel="Close">
                  <Ionicons name="close" size={24} color="#374151" />
                </Pressable>
              </View>

              <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
                <View className="mb-3">
                  <Text className="mb-1 text-[11px] font-bold tracking-wide text-gray-500">Name</Text>
                  <TextInput
                    ref={nameRef}
                    value={form.name}
                    onChangeText={set('name')}
                    placeholder="Full name"
                    placeholderTextColor="#9CA3AF"
                    className="rounded-lg bg-white px-3 py-2.5 text-sm text-gray-900"
                    style={[{ borderWidth: 1, borderColor: '#D1D5DB' }, { outlineStyle: 'none' } as object]}
                  />
                </View>
                <View className="flex-row" style={{ gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Field label="Phone" value={form.phone} onChange={set('phone')} placeholder="98XXXXXXXX" keyboardType="phone-pad" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field label="Address" value={form.address} onChange={set('address')} placeholder="Optional" />
                  </View>
                </View>
                <Field label="Interested in" value={form.interested_in} onChange={set('interested_in')} placeholder="e.g. 3-piece luggage set, rice cooker" multiline />

                <Text className="mb-1.5 text-[11px] font-bold tracking-wide text-gray-500">Lead from</Text>
                <View className="mb-3 flex-row flex-wrap" style={{ gap: 8 }}>
                  {SOURCES.map((s) => (
                    <Chip key={s.key} label={s.label} icon={s.icon} on={form.source === s.key} onPress={() => set('source')(s.key)} />
                  ))}
                </View>
                {sourceNeedsNote(form.source) && (
                  <Field
                    label={form.source === 'referral' ? 'Referred by' : 'Details'}
                    value={form.source_note}
                    onChange={set('source_note')}
                    placeholder={form.source === 'referral' ? 'Who sent them' : 'e.g. signboard, Instagram'}
                  />
                )}

                <Text className="mb-1.5 text-[11px] font-bold tracking-wide text-gray-500">Status</Text>
                <View className="mb-3 flex-row flex-wrap" style={{ gap: 8 }}>
                  {STATUSES.map((s) => (
                    <Chip key={s.key} label={s.label} on={form.status === s.key} onPress={() => set('status')(s.key)} />
                  ))}
                </View>

                <Text className="mb-1.5 text-[11px] font-bold tracking-wide text-gray-500">Follow up</Text>
                <View className="mb-4 flex-row flex-wrap" style={{ gap: 8 }}>
                  {FOLLOW_UPS.map((f) => {
                    const iso = f.days == null ? '' : inDays(f.days);
                    return <Chip key={f.label} label={f.label} on={form.follow_up_on === iso} onPress={() => set('follow_up_on')(iso)} />;
                  })}
                  {!!form.follow_up_on && !FOLLOW_UPS.some((f) => f.days != null && inDays(f.days) === form.follow_up_on) && (
                    <Chip label={toBsHistoryLabel(form.follow_up_on)} on onPress={() => {}} />
                  )}
                </View>

                {!!editing.id && (
                  <View className="mb-2 rounded-xl border border-gray-200 bg-gray-50 p-3">
                    <Text className="mb-2 text-[11px] font-bold tracking-wide text-gray-500">Contact history</Text>
                    <View className="mb-2 flex-row flex-wrap" style={{ gap: 8 }}>
                      {KINDS.map((k) => (
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
                      <Pressable onPress={logContact} disabled={busy} className="rounded-lg px-3.5 py-2.5 disabled:opacity-50" style={{ backgroundColor: ACCENT }}>
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
                                <Text className="text-xs font-semibold text-gray-700">
                                  {kind?.label} · {dayLabel(h.at)}
                                </Text>
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
                {!!editing.id && (
                  <Pressable onPress={confirmDelete} className="rounded-xl border border-red-200 px-4 py-3">
                    <Text className="text-sm font-bold text-red-600">Delete</Text>
                  </Pressable>
                )}
                <View className="flex-1" />
                <Pressable onPress={() => setEditing(null)} className="rounded-xl border border-gray-300 bg-white px-5 py-3">
                  <Text className="text-sm font-bold text-gray-600">Cancel</Text>
                </Pressable>
                <Pressable onPress={save} disabled={busy} className="rounded-xl px-6 py-3 disabled:opacity-50" style={{ backgroundColor: '#1D4ED8' }}>
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
