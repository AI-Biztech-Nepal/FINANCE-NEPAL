// lib/components/finance/CrmScreen.tsx
//
// CRM (Marketing): the people the shop is following up. One card per person with a status, how they found the shop, what
// they want, the day to follow up and a history of every contact; call and WhatsApp are on the left of each card. Tap a
// card to change it or log a contact. Leads (the simple name-and-source list) shows the same people.
import { useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../hooks/useAuth';
import { useSupabaseDelete, useSupabaseInsert, useSupabaseQuery, useSupabaseUpdate } from '../../hooks/useSupabase';
import { BookPage, ToolbarButton, ToolbarSearch, useBookLayout } from './BookKit';
import {
  CONTACT_KINDS,
  FOLLOW_UPS,
  HISTORY_KINDS,
  LEAD_SOURCES,
  LEAD_STATUSES,
  dayLabel,
  inDays,
  sourceNeedsNote,
  waNumber,
} from './leadKit';
import { toBsHistoryLabel } from '../../utils/nepaliDate';
import { localTodayIso } from '../../utils/localDate';
import { showAlert, getErrorMessage } from '../../utils/alert';
import type { Lead, LeadHistoryEntry, LeadSource, LeadStatus } from '../../../types/database.types';

type Tab = 'all' | LeadStatus;
const BLUE = '#2563EB';
const STATUS = Object.fromEntries(LEAD_STATUSES.map((s) => [s.key, s])) as Record<LeadStatus, (typeof LEAD_STATUSES)[number]>;
const SOURCE = Object.fromEntries(LEAD_SOURCES.map((s) => [s.key, s])) as Record<LeadSource, (typeof LEAD_SOURCES)[number]>;

interface Form {
  name: string;
  phone: string;
  address: string;
  source: LeadSource;
  source_note: string;
  interested_in: string;
  status: LeadStatus;
  follow_up_on: string;
}
const EMPTY: Form = { name: '', phone: '', address: '', source: 'walk_in', source_note: '', interested_in: '', status: 'new', follow_up_on: '' };
const formOf = (l: Lead): Form => ({
  name: l.name,
  phone: l.phone ?? '',
  address: l.address ?? '',
  source: l.source,
  source_note: l.source_note ?? '',
  interested_in: l.interested_in ?? '',
  status: l.status,
  follow_up_on: l.follow_up_on ?? '',
});

const isOpen = (l: Lead) => l.status !== 'converted' && l.status !== 'lost';

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

export function CrmScreen() {
  const layout = useBookLayout();
  const profile = useAuthStore((state) => state.profile);
  const userId = profile?.id;
  const { data, isLoading } = useSupabaseQuery('leads', { filters: userId ? { owner_id: userId } : {}, all: true, enabled: !!userId });
  const createLead = useSupabaseInsert('leads');
  const updateLead = useSupabaseUpdate('leads');
  const deleteLead = useSupabaseDelete('leads');

  const [tab, setTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<{ id: string | null; form: Form; history: LeadHistoryEntry[] } | null>(null);
  const [logKind, setLogKind] = useState<LeadHistoryEntry['kind']>('call');
  const [logNote, setLogNote] = useState('');
  const [busy, setBusy] = useState(false);

  const today = localTodayIso();
  const leads: Lead[] = useMemo(() => [...((data ?? []) as Lead[])].sort((a, b) => b.created_at.localeCompare(a.created_at)), [data]);
  const dueCount = leads.filter((l) => isOpen(l) && !!l.follow_up_on && l.follow_up_on <= today).length;
  const q = search.trim().toLowerCase();
  const shown = leads.filter(
    (l) =>
      (tab === 'all' || l.status === tab) &&
      (!q || [l.name, l.phone ?? '', l.address ?? '', l.interested_in ?? '', l.source_note ?? ''].some((t) => t.toLowerCase().includes(q)))
  );
  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: leads.length },
    ...LEAD_STATUSES.map((s) => ({ key: s.key as Tab, label: s.label, count: leads.filter((l) => l.status === s.key).length })),
  ];

  const set = <K extends keyof Form>(key: K) => (value: Form[K]) => setEditing((e) => (e ? { ...e, form: { ...e.form, [key]: value } } : e));
  const open = (l: Lead | null) => {
    setLogKind('call');
    setLogNote('');
    setEditing(l ? { id: l.id, form: formOf(l), history: l.history ?? [] } : { id: null, form: EMPTY, history: [] });
  };

  const valuesOf = (f: Form) => ({
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
      showAlert('Add a name', 'Enter the name.');
      return;
    }
    setBusy(true);
    try {
      const values = valuesOf(editing.form);
      if (editing.id) await updateLead.mutateAsync({ id: editing.id, values });
      else await createLead.mutateAsync({ owner_id: userId, ...values, history: [] });
      setEditing(null);
    } catch (err) {
      showAlert('Could not save', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // A contact goes into the history straight away. A New lead that was called, messaged or visited is Contacted.
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
    showAlert('Delete this person?', `${editing?.form.name} and their history will be removed.`, [
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

  const greeting = (l: Lead) =>
    `Hello ${l.name.trim().split(/\s+/)[0]}, this is ${profile?.business_name?.trim() || 'All In One Abroad'}. Thank you for contacting us${l.interested_in ? ` about ${l.interested_in}` : ''}. How can we help you?`;
  const callTo = (l: Lead) => l.phone && void Linking.openURL(`tel:${l.phone}`);
  const whatsappTo = (l: Lead) => l.phone && void Linking.openURL(`https://wa.me/${waNumber(l.phone)}?text=${encodeURIComponent(greeting(l))}`);

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50">
        <ActivityIndicator size="large" color={BLUE} />
      </View>
    );
  }
  const form = editing?.form;

  return (
    <BookPage wide={layout.wide}>
      <View className="flex-row flex-wrap items-center justify-between" style={{ gap: 12 }}>
        <Text className="text-sm text-gray-500">
          {leads.length} {leads.length === 1 ? 'person' : 'people'}
          {dueCount > 0 ? ` · ${dueCount} to follow up` : ''}
        </Text>
        <View className="flex-row flex-wrap items-center" style={{ gap: 8 }}>
          <ToolbarSearch value={search} onChange={setSearch} placeholder="Search name, phone, interest..." wide={layout.wide} />
          <ToolbarButton icon="add" label="Add Prospect" onPress={() => open(null)} />
        </View>
      </View>

      <View className="flex-row flex-wrap" style={{ gap: 8 }}>
        {tabs.map((t) => {
          const on = t.key === tab;
          return (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              className="flex-row items-center rounded-full px-4"
              style={{ height: 40, gap: 7, backgroundColor: on ? BLUE : '#FFFFFF', borderWidth: 1, borderColor: on ? BLUE : '#E5E7EB' }}
            >
              <Text className="text-sm font-semibold" style={{ color: on ? '#FFFFFF' : '#374151' }}>
                {t.label}
              </Text>
              <View className="items-center justify-center rounded-full px-1.5" style={{ minWidth: 22, height: 20, backgroundColor: on ? 'rgba(255,255,255,0.28)' : '#F1F5F9' }}>
                <Text className="text-[11px] font-bold" style={{ color: on ? '#FFFFFF' : '#475569' }}>
                  {t.count}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {shown.length === 0 ? (
        <View className="items-center rounded-xl border border-gray-200 bg-white py-12">
          <Ionicons name="heart-outline" size={34} color="#D1D5DB" />
          <Text className="mt-2 font-medium text-gray-500">{leads.length === 0 ? 'No one to follow up yet' : 'No one here'}</Text>
          <Text className="mt-1 px-6 text-center text-xs text-gray-400">
            {leads.length === 0 ? 'Add a prospect, or record a sale with a Lead: buyers appear here as Converted.' : 'Try another tab or clear the search'}
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
              <Pressable key={l.id} onPress={() => open(l)} className="flex-row rounded-xl border border-gray-200 bg-white p-3.5" style={{ gap: 12 }}>
                <View style={{ gap: 8 }}>
                  {(['call', 'whatsapp'] as const).map((k) => (
                    <Pressable
                      key={k}
                      onPress={() => (k === 'call' ? callTo(l) : whatsappTo(l))}
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
                      <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: day === 'Today' ? BLUE : day === 'Yesterday' ? '#FEF3C7' : '#F3F4F6' }}>
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
            <View className="w-full rounded-2xl bg-white" style={{ maxWidth: 560, maxHeight: '92%', padding: 20, boxShadow: '0 20px 50px rgba(16,24,40,0.25)' } as object}>
              <View className="mb-3 flex-row items-center justify-between">
                <Text className="text-lg font-extrabold text-gray-900">{editing.id ? 'Edit' : 'New prospect'}</Text>
                <Pressable onPress={() => setEditing(null)} hitSlop={8} accessibilityLabel="Close">
                  <Ionicons name="close" size={24} color="#374151" />
                </Pressable>
              </View>
              <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
                <Field label="Name" value={form.name} onChange={set('name')} placeholder="Full name" />
                <View className="flex-row" style={{ gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Field label="Phone" value={form.phone} onChange={set('phone')} placeholder="98XXXXXXXX" phone />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field label="Address" value={form.address} onChange={set('address')} placeholder="Optional" />
                  </View>
                </View>
                <Field label="Interested in" value={form.interested_in} onChange={set('interested_in')} placeholder="e.g. 3-piece luggage set, rice cooker" multiline />

                <Text className="mb-1.5 text-[11px] font-bold tracking-wide text-gray-500">Lead from</Text>
                <View className="mb-3 flex-row flex-wrap" style={{ gap: 8 }}>
                  {LEAD_SOURCES.map((s) => (
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
                  {LEAD_STATUSES.map((s) => (
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
