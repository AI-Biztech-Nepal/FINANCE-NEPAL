// lib/components/finance/CustomerProfile.tsx
//
// A customer in full, as a drawer from the right - laid out like Auto Stock Manager's: who they are with their status,
// source and phone, the things you can do to them (call, WhatsApp, add a note, schedule a follow-up, edit, remove), and
// three tabs. Overview = who they are (and Edit, right here with Save / Cancel); Activity = what is scheduled and what
// happened (contacts, notes, sales); Purchases = the sales they made. All saving is done by the CRM page, which hands in
// what to call.
import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SelectDropdown } from './SelectDropdown';
import { CONTACT_KINDS, FOLLOW_UPS, HISTORY_KINDS, LEAD_SOURCES, LEAD_STATUSES, dayLabel, inDays, sourceNeedsNote } from './leadKit';
import { crmFormOf, norm, type CrmForm, type CrmRow } from './crmKit';
import { money } from './BookKit';
import { toBsHistoryLabel } from '../../utils/nepaliDate';
import { localTodayIso } from '../../utils/localDate';
import { itemNamesOf } from '../../utils/accountFeatures';
import { showAlert } from '../../utils/alert';
import type { BusinessTransaction, LeadHistoryEntry, LeadStatus } from '../../../types/database.types';

const BLUE = '#2563EB';
type Tab = 'overview' | 'activity' | 'purchases';
const SOURCE = Object.fromEntries(LEAD_SOURCES.map((s) => [s.key, s]));
const STATUS = Object.fromEntries(LEAD_STATUSES.map((s) => [s.key, s]));
const PICKABLE = LEAD_STATUSES.filter((s) => s.key !== 'converted');
const AVATARS = [
  ['#DBEAFE', '#1D4ED8'],
  ['#D1FAE5', '#047857'],
  ['#FFEDD5', '#C2410C'],
  ['#EDE9FE', '#6D28D9'],
  ['#FCE7F3', '#BE185D'],
  ['#E0F2FE', '#0369A1'],
];

function Avatar({ name }: { name: string }) {
  const [bg, fg] = AVATARS[[...name].reduce((n, ch) => n + ch.charCodeAt(0), 0) % AVATARS.length];
  const initials = name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
  return (
    <View className="items-center justify-center rounded-full" style={{ width: 48, height: 48, backgroundColor: bg }}>
      <Text className="text-base font-bold" style={{ color: fg }}>{initials}</Text>
    </View>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ flexBasis: '46%', flexGrow: 1, minWidth: 0 }}>
      <Text className="text-[11px] font-semibold tracking-wider text-gray-400">{label}</Text>
      <View className="mt-0.5">{children || <Text className="text-sm text-gray-300">—</Text>}</View>
    </View>
  );
}
const Value = ({ children }: { children?: React.ReactNode }) =>
  children ? <Text className="text-sm text-gray-800">{children}</Text> : <Text className="text-sm text-gray-300">—</Text>;

function ActionButton({ icon, color, label, onPress, disabled }: { icon: keyof typeof Ionicons.glyphMap; color: string; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} className="h-9 flex-row items-center rounded-lg border border-gray-200 bg-white px-2.5" style={{ gap: 6, opacity: disabled ? 0.45 : 1 }}>
      <Ionicons name={icon} size={14} color={color} />
      <Text className="text-[13px] font-semibold text-gray-700">{label}</Text>
    </Pressable>
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
      <Text className="text-xs font-bold" style={{ color: on ? BLUE : '#4B5563' }}>{label}</Text>
    </Pressable>
  );
}

function Field({ label, value, onChange, placeholder, phone, multiline }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; phone?: boolean; multiline?: boolean }) {
  const [focused, setFocused] = useState(false);
  return (
    <View className="mb-3">
      <Text className="mb-1 text-[11px] font-semibold tracking-wider text-gray-400">{label}</Text>
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

const SmallIcon = ({ icon, color, bg, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; color: string; bg: string; label: string; onPress: () => void }) => (
  <Pressable onPress={onPress} accessibilityLabel={label} className="items-center justify-center rounded-lg" style={{ width: 32, height: 32, backgroundColor: bg }}>
    <Ionicons name={icon} size={16} color={color} />
  </Pressable>
);

const SectionTitle = ({ children, count }: { children: string; count?: number }) => (
  <View className="mb-2 flex-row items-center" style={{ gap: 6 }}>
    <Text className="text-sm font-bold text-gray-900">{children}</Text>
    {count != null && count > 0 && (
      <View className="rounded-full bg-gray-100 px-1.5 py-0.5">
        <Text className="text-[11px] font-semibold text-gray-500">{count}</Text>
      </View>
    )}
  </View>
);

export function CustomerProfile({
  row,
  rows,
  purchases,
  startEditing,
  patch,
  busy,
  onClose,
  onOpen,
  onSave,
  onStatus,
  onContact,
  onLog,
  onSchedule,
  onDone,
  onClearFollowUp,
  onRemoveEntry,
  onRemove,
  onOpenBill,
}: {
  /** null: a new customer is being added. */
  row: CrmRow | null;
  rows: CrmRow[];
  purchases: BusinessTransaction[];
  startEditing: boolean;
  /** A choice made before the profile opened (Referral or Other picked in the table). */
  patch?: Partial<CrmForm>;
  busy: boolean;
  onClose: () => void;
  onOpen: (row: CrmRow) => void;
  onSave: (form: CrmForm) => Promise<boolean>;
  onStatus: (status: LeadStatus) => void;
  onContact: (kind: 'call' | 'whatsapp') => void;
  onLog: (kind: LeadHistoryEntry['kind'], note: string) => Promise<boolean>;
  onSchedule: (iso: string) => Promise<boolean>;
  onDone: () => void;
  onClearFollowUp: () => void;
  onRemoveEntry: (index: number) => void;
  onRemove: () => void;
  onOpenBill: (tx: BusinessTransaction) => void;
}) {
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(startEditing || !row);
  const initial: CrmForm = { ...crmFormOf(row), ...patch };
  const [form, setForm] = useState<CrmForm>(initial);
  const [mode, setMode] = useState<'log' | 'followup'>('log');
  const [logKind, setLogKind] = useState<LeadHistoryEntry['kind']>('note');
  const [logNote, setLogNote] = useState('');
  const [fuDate, setFuDate] = useState('');
  const set = <K extends keyof CrmForm>(key: K) => (value: CrmForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const today = localTodayIso();
  const lead = row?.lead ?? null;
  const history = lead?.history ?? [];
  const dirty = editing && JSON.stringify(form) !== JSON.stringify(initial);

  const requestClose = () => {
    if (!dirty) return onClose();
    showAlert('Discard your changes?', 'What you typed has not been saved yet.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onClose },
    ]);
  };

  const referredList = row ? rows.filter((r) => r.source === 'referral' && norm(r.sourceNote) === norm(row.name)) : [];
  const referrer = row?.source === 'referral' && row.sourceNote ? rows.find((r) => norm(r.name) === norm(row.sourceNote) && r.key !== row.key) : undefined;

  const save = async () => {
    if (await onSave(form)) setEditing(false);
  };
  const startEdit = () => {
    setEditing(true);
    setTab('overview');
  };
  const goActivity = (m: 'log' | 'followup', kind?: LeadHistoryEntry['kind']) => {
    setTab('activity');
    setMode(m);
    if (kind) setLogKind(kind);
  };
  const addLog = async () => {
    if (logKind === 'note' && !logNote.trim()) return showAlert('Write a note', 'Type what you want to remember.');
    if (await onLog(logKind, logNote.trim())) setLogNote('');
  };
  const schedule = async () => {
    if (!fuDate) return showAlert('Pick a day', 'Choose when to follow up.');
    if (await onSchedule(fuDate)) setFuDate('');
  };
  const askRemove = (index: number) =>
    showAlert('Delete this entry?', 'It will be removed from the history.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => onRemoveEntry(index) },
    ]);

  const status = row ? STATUS[row.status] : STATUS.new;
  const source = row?.source ? SOURCE[row.source] : null;
  const pending = row?.followUp && row.status !== 'converted' && row.status !== 'lost' ? 1 : 0;
  const tabs: [Tab, string, number][] = [
    ['overview', 'Overview', 0],
    ['activity', 'Activity', pending],
    ['purchases', 'Purchases', purchases.length],
  ];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={requestClose}>
      <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.4)' }}>
        <Pressable style={{ flex: 1 }} onPress={requestClose} accessibilityLabel="Close profile" />
        <View style={{ width: Math.min(640, width), height: '100%', backgroundColor: '#fff', boxShadow: '-12px 0 40px rgba(15,23,42,0.18)' } as object}>
          {/* Header: who, their badges, and what can be done */}
          <View className="border-b border-gray-100 px-5 pb-3 pt-5">
            <View className="flex-row items-start" style={{ gap: 12 }}>
              {row ? <Avatar name={row.name} /> : <View className="items-center justify-center rounded-full bg-blue-50" style={{ width: 48, height: 48 }}><Ionicons name="person-add" size={20} color={BLUE} /></View>}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text className="text-xl font-extrabold text-gray-900" numberOfLines={1}>{row ? row.name : 'Add Customer'}</Text>
                {!!row && (
                  <View className="mt-1 flex-row flex-wrap items-center" style={{ gap: 6 }}>
                    <View className="rounded-full px-2.5 py-0.5" style={{ backgroundColor: status.bg }}>
                      <Text className="text-[11px] font-semibold" style={{ color: status.color }}>{status.label}</Text>
                    </View>
                    {!!source && (
                      <View className="rounded-full px-2.5 py-0.5" style={{ backgroundColor: source.bg }}>
                        <Text className="text-[11px] font-semibold" style={{ color: source.color }}>{source.label}</Text>
                      </View>
                    )}
                    {!!row.phone && <Text className="text-xs text-gray-500">{row.phone}</Text>}
                  </View>
                )}
              </View>
              <Pressable onPress={requestClose} hitSlop={8} accessibilityLabel="Close profile" className="items-center justify-center rounded-lg" style={{ width: 36, height: 36 }}>
                <Ionicons name="close" size={22} color="#9CA3AF" />
              </Pressable>
            </View>
            {!!row && (
              <View className="mt-3 flex-row flex-wrap items-center" style={{ gap: 8 }}>
                <ActionButton icon="call" color="#0284C7" label="Call" onPress={() => onContact('call')} disabled={!row.phone} />
                <ActionButton icon="logo-whatsapp" color="#16A34A" label="WhatsApp" onPress={() => onContact('whatsapp')} disabled={!row.phone} />
                <ActionButton icon="document-text" color="#D97706" label="Add note" onPress={() => goActivity('log', 'note')} />
                <ActionButton icon="calendar" color={BLUE} label="Follow-up" onPress={() => goActivity('followup')} />
                <ActionButton icon="pencil" color="#4B5563" label="Edit" onPress={startEdit} disabled={editing} />
                <View style={{ flex: 1 }} />
                {!!lead && (
                  <Pressable onPress={onRemove} className="h-9 flex-row items-center rounded-lg px-2.5" style={{ gap: 6 }}>
                    <Ionicons name="trash-outline" size={14} color="#DC2626" />
                    <Text className="text-[13px] font-semibold text-red-600">Remove</Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>

          {/* Tabs */}
          {!!row && (
            <View className="flex-row border-b border-gray-100 px-4 pt-1" style={{ gap: 4 }}>
              {tabs.map(([key, label, n]) => {
                const on = tab === key;
                return (
                  <Pressable key={key} onPress={() => setTab(key)} accessibilityRole="tab" accessibilityState={{ selected: on }} className="flex-row items-center px-3 py-2.5" style={{ gap: 6, borderBottomWidth: 2, borderBottomColor: on ? BLUE : 'transparent' }}>
                    <Text className="text-sm font-semibold" style={{ color: on ? '#1D4ED8' : '#6B7280' }}>{label}</Text>
                    {n > 0 && (
                      <View className="rounded-full px-1.5 py-0.5" style={{ backgroundColor: key === 'activity' ? '#EFF6FF' : '#F3F4F6' }}>
                        <Text className="text-[11px] font-semibold" style={{ color: key === 'activity' ? '#1D4ED8' : '#6B7280' }}>{n}</Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          )}

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 28 }} keyboardShouldPersistTaps="handled">
            {/* OVERVIEW: edit form, or who they are */}
            {(!row || tab === 'overview') &&
              (editing ? (
                <View>
                  <Field label="Name" value={form.name} onChange={set('name')} placeholder="Full name" />
                  <View className="flex-row" style={{ gap: 12 }}>
                    <View style={{ flex: 1 }}><Field label="Phone" value={form.phone} onChange={set('phone')} placeholder="98XXXXXXXX" phone /></View>
                    <View style={{ flex: 1 }}><Field label="Address" value={form.address} onChange={set('address')} placeholder="Optional" /></View>
                  </View>
                  <Field label="Interested in" value={form.interested_in} onChange={set('interested_in')} placeholder="e.g. 3-piece luggage set, rice cooker" multiline />
                  <Text className="mb-1.5 text-[11px] font-semibold tracking-wider text-gray-400">Lead from</Text>
                  <View className="mb-3 flex-row flex-wrap" style={{ gap: 8 }}>
                    {LEAD_SOURCES.map((s) => <Chip key={s.key} label={s.label} icon={s.icon} on={form.source === s.key} onPress={() => set('source')(s.key)} />)}
                  </View>
                  {sourceNeedsNote(form.source) && (
                    <Field label={form.source === 'referral' ? 'Referred by' : 'Details'} value={form.source_note} onChange={set('source_note')} placeholder={form.source === 'referral' ? 'Who sent them' : 'e.g. signboard, Instagram'} />
                  )}
                  {row?.bought ? (
                    <Text className="text-xs text-gray-500">Converted: this customer has bought, so the lead status is set automatically.</Text>
                  ) : (
                    <>
                      <Text className="mb-1.5 text-[11px] font-semibold tracking-wider text-gray-400">Lead status</Text>
                      <View className="mb-3 flex-row flex-wrap" style={{ gap: 8 }}>
                        {PICKABLE.map((s) => <Chip key={s.key} label={s.label} on={form.status === s.key} onPress={() => set('status')(s.key)} />)}
                      </View>
                    </>
                  )}
                </View>
              ) : (
                !!row && (
                  <View style={{ gap: 20 }}>
                    <View className="flex-row flex-wrap" style={{ columnGap: 16, rowGap: 16 }}>
                      <Info label="PHONE"><Value>{row.phone}</Value></Info>
                      <Info label="ADDRESS"><Value>{row.address}</Value></Info>
                      <Info label="CUSTOMER SINCE"><Value>{toBsHistoryLabel(row.createdAt)}</Value></Info>
                      <Info label="INTERESTED IN"><Value>{lead?.interested_in}</Value></Info>
                      <Info label="LEAD SOURCE"><Value>{row.source ? SOURCE[row.source].label : ''}</Value></Info>
                      <Info label={row.source === 'other' ? 'DETAIL' : 'REFERRED BY'}>
                        {referrer ? (
                          <Pressable onPress={() => onOpen(referrer)}><Text className="text-sm font-semibold" style={{ color: BLUE }}>{referrer.name}</Text></Pressable>
                        ) : (
                          <Value>{row.sourceNote}</Value>
                        )}
                      </Info>
                      <Info label="TRANSACTION AMOUNT">
                        {row.amount > 0 ? <Text className="text-sm font-bold text-gray-900">NPR {money(row.amount)}<Text className="text-xs font-normal text-gray-400"> · {purchases.length} {purchases.length === 1 ? 'sale' : 'sales'}</Text></Text> : null}
                      </Info>
                      <Info label="LAST CONTACT">
                        <Value>{row.last ? `${HISTORY_KINDS.find((k) => k.key === row.last?.kind)?.label} · ${dayLabel(row.last.at)}` : ''}</Value>
                      </Info>
                    </View>
                    <View>
                      <Text className="mb-1 text-[11px] font-semibold tracking-wider text-gray-400">LEAD STATUS</Text>
                      {row.bought || !lead ? (
                        <View className="flex-row items-center" style={{ gap: 8, height: 36 }}>
                          <View className="rounded-full px-2.5 py-0.5" style={{ backgroundColor: STATUS.converted.bg }}><Text className="text-[11px] font-semibold" style={{ color: STATUS.converted.color }}>Converted</Text></View>
                          <Text className="text-xs text-gray-400">has bought</Text>
                        </View>
                      ) : (
                        <SelectDropdown
                          value={row.status}
                          options={PICKABLE.map((s) => ({ key: s.key, label: s.label }))}
                          onChange={onStatus}
                          width={220}
                          accessibilityLabel="Lead status"
                          trigger={() => (
                            <View className="h-9 flex-row items-center justify-between rounded-lg border border-gray-200 bg-white px-3" style={{ minWidth: 220, gap: 8 }}>
                              <Text className="text-sm font-semibold text-gray-800">{STATUS[row.status].label}</Text>
                              <Ionicons name="chevron-down" size={14} color="#9CA3AF" />
                            </View>
                          )}
                        />
                      )}
                    </View>
                    {referredList.length > 0 && (
                      <View>
                        <View className="mb-1.5 flex-row items-center" style={{ gap: 4 }}>
                          <Ionicons name="link" size={12} color="#9CA3AF" />
                          <Text className="text-[11px] font-semibold tracking-wider text-gray-400">REFERRED {referredList.length} {referredList.length === 1 ? 'CUSTOMER' : 'CUSTOMERS'}</Text>
                        </View>
                        <View className="flex-row flex-wrap" style={{ gap: 6 }}>
                          {referredList.map((r) => (
                            <Pressable key={r.key} onPress={() => onOpen(r)} className="rounded-full bg-amber-50 px-2.5 py-1"><Text className="text-xs font-semibold text-amber-800">{r.name}</Text></Pressable>
                          ))}
                        </View>
                      </View>
                    )}
                  </View>
                )
              ))}

            {/* ACTIVITY: log a contact or schedule a follow-up, what is scheduled, and the history */}
            {!!row && tab === 'activity' && (
              <View style={{ gap: 20 }}>
                {!lead ? (
                  <View className="items-center rounded-xl bg-gray-50 px-5 py-8">
                    <Ionicons name="time-outline" size={30} color="#D1D5DB" />
                    <Text className="mt-2 text-center text-sm text-gray-500">Pick where this customer came from (Edit, Lead from) to start their history and follow-ups.</Text>
                  </View>
                ) : (
                  <View className="overflow-hidden rounded-xl border border-gray-200">
                    <View className="flex-row border-b border-gray-100 p-1" style={{ gap: 4 }}>
                      {([['log', 'Log contact', 'document-text'], ['followup', 'Schedule follow-up', 'calendar']] as const).map(([k, label, icon]) => (
                        <Pressable key={k} onPress={() => setMode(k)} className="h-9 flex-1 flex-row items-center justify-center rounded-lg" style={{ gap: 6, backgroundColor: mode === k ? '#EFF6FF' : 'transparent' }}>
                          <Ionicons name={icon} size={14} color={mode === k ? '#1D4ED8' : '#6B7280'} />
                          <Text className="text-sm font-semibold" style={{ color: mode === k ? '#1D4ED8' : '#6B7280' }}>{label}</Text>
                        </Pressable>
                      ))}
                    </View>
                    <View className="p-3" style={{ gap: 10 }}>
                      {mode === 'log' ? (
                        <>
                          <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                            {CONTACT_KINDS.map((k) => <Chip key={k.key} label={k.label} icon={k.icon} on={logKind === k.key} onPress={() => setLogKind(k.key)} />)}
                          </View>
                          <TextInput
                            value={logNote}
                            onChangeText={setLogNote}
                            multiline
                            placeholder={logKind === 'note' ? 'What do you want to remember?' : 'What happened? (optional)'}
                            placeholderTextColor="#9CA3AF"
                            className="rounded-lg bg-white px-3 py-2.5 text-sm text-gray-900"
                            style={[{ borderWidth: 1, borderColor: '#D1D5DB', minHeight: 64, textAlignVertical: 'top' }, { outlineStyle: 'none' } as object]}
                          />
                          <View className="flex-row justify-end">
                            <Pressable onPress={addLog} disabled={busy} className="h-9 justify-center rounded-lg px-4 disabled:opacity-50" style={{ backgroundColor: '#1D4ED8' }}>
                              <Text className="text-sm font-bold text-white">{busy ? 'Saving...' : 'Add to history'}</Text>
                            </Pressable>
                          </View>
                        </>
                      ) : (
                        <>
                          <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                            {FOLLOW_UPS.filter((f) => f.days != null).map((f) => {
                              const iso = inDays(f.days as number);
                              return <Chip key={f.label} label={f.label} on={fuDate === iso} onPress={() => setFuDate(iso)} />;
                            })}
                          </View>
                          <View className="flex-row justify-end">
                            <Pressable onPress={schedule} disabled={busy} className="h-9 justify-center rounded-lg px-4 disabled:opacity-50" style={{ backgroundColor: '#1D4ED8' }}>
                              <Text className="text-sm font-bold text-white">{busy ? 'Saving...' : 'Schedule follow-up'}</Text>
                            </Pressable>
                          </View>
                        </>
                      )}
                    </View>
                  </View>
                )}

                {!!lead && !!row.followUp && (
                  <View>
                    <SectionTitle count={1}>Scheduled</SectionTitle>
                    <View className="flex-row items-center rounded-xl border border-gray-200 p-3" style={{ gap: 10, borderLeftWidth: 4, borderLeftColor: row.followUp < today ? '#DC2626' : row.followUp === today ? '#2563EB' : '#94A3B8' }}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text className="text-sm font-bold text-gray-900">Follow up {row.followUp === today ? 'today' : toBsHistoryLabel(row.followUp)}</Text>
                        <Text className="text-xs" style={{ color: row.followUp < today ? '#B91C1C' : '#6B7280' }}>{row.followUp < today ? 'Overdue' : row.followUp === today ? 'Due today' : 'Coming up'}</Text>
                      </View>
                      <SmallIcon icon="checkmark" color="#047857" bg="#ECFDF5" label="Mark done" onPress={onDone} />
                      <SmallIcon icon="trash-outline" color="#9CA3AF" bg="#F3F4F6" label="Remove the follow-up" onPress={onClearFollowUp} />
                    </View>
                  </View>
                )}

                <View>
                  <SectionTitle>History</SectionTitle>
                  {history.length === 0 ? (
                    <View className="items-center rounded-xl bg-gray-50 px-5 py-8">
                      <Ionicons name="time-outline" size={28} color="#D1D5DB" />
                      <Text className="mt-2 font-semibold text-gray-500">Nothing yet</Text>
                      <Text className="mt-0.5 text-center text-xs text-gray-400">Calls, chats, visits, notes and sales will build up here.</Text>
                    </View>
                  ) : (
                    <View style={{ gap: 8 }}>
                      {history.map((h, index) => ({ h, index })).reverse().map(({ h, index }) => {
                        const kind = HISTORY_KINDS.find((k) => k.key === h.kind);
                        return (
                          <View key={`${h.at}-${index}`} className="flex-row items-start rounded-xl border border-gray-200 p-3" style={{ gap: 10 }}>
                            <View className="items-center justify-center rounded-lg bg-gray-100" style={{ width: 32, height: 32 }}>
                              <Ionicons name={kind?.icon ?? 'document-text'} size={16} color="#4B5563" />
                            </View>
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text className="text-sm text-gray-800">{h.note || kind?.label}</Text>
                              <Text className="mt-0.5 text-[11px] text-gray-400">{kind?.label} · {dayLabel(h.at)}</Text>
                            </View>
                            {h.kind !== 'sale' && <SmallIcon icon="trash-outline" color="#9CA3AF" bg="#F9FAFB" label="Delete this entry" onPress={() => askRemove(index)} />}
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              </View>
            )}

            {/* PURCHASES: the sales they made */}
            {!!row && tab === 'purchases' &&
              (purchases.length === 0 ? (
                <View className="items-center rounded-xl bg-gray-50 px-5 py-10">
                  <Ionicons name="bag-handle-outline" size={30} color="#D1D5DB" />
                  <Text className="mt-2 font-semibold text-gray-500">No purchases yet</Text>
                  <Text className="mt-0.5 text-center text-xs text-gray-400">When this customer buys, the sale shows up here.</Text>
                </View>
              ) : (
                <View>
                  <SectionTitle>Sales</SectionTitle>
                  <View style={{ gap: 8 }}>
                    {purchases.map((tx) => (
                      <View key={tx.id} className="rounded-xl border border-gray-200 p-3">
                        <View className="flex-row items-start justify-between" style={{ gap: 12 }}>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text className="text-sm font-semibold text-gray-900">{itemNamesOf(tx.items) || 'Sale'}</Text>
                            <Text className="text-xs text-gray-500">{toBsHistoryLabel(tx.bill_date ?? tx.created_at)}{tx.bill_no ? ` · Bill ${tx.bill_no}` : ''}</Text>
                            <Pressable onPress={() => onOpenBill(tx)} className="mt-1 flex-row items-center" style={{ gap: 4 }}>
                              <Ionicons name="open-outline" size={11} color={BLUE} />
                              <Text className="text-xs font-semibold" style={{ color: BLUE }}>Open the bill</Text>
                            </Pressable>
                          </View>
                          <View className="items-end">
                            <Text className="text-sm font-bold text-gray-900">NPR {money(tx.amount)}</Text>
                            {tx.payment_mode === 'credit' && <Text className="text-[11px] font-semibold text-red-600">On credit</Text>}
                          </View>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>
              ))}
          </ScrollView>

          {/* Save / Cancel while editing */}
          {editing && (!row || tab === 'overview') && (
            <View className="flex-row items-center justify-end border-t border-gray-100 bg-gray-50 px-5 py-3" style={{ gap: 8 }}>
              <Pressable onPress={() => (row ? (setForm(initial), setEditing(false)) : onClose())} className="h-10 justify-center rounded-lg border border-gray-300 bg-white px-4">
                <Text className="text-sm font-bold text-gray-600">Cancel</Text>
              </Pressable>
              <Pressable onPress={save} disabled={busy} className="h-10 justify-center rounded-lg px-5 disabled:opacity-50" style={{ backgroundColor: '#1D4ED8' }}>
                <Text className="text-sm font-bold text-white">{busy ? 'Saving...' : row ? 'Save changes' : 'Add customer'}</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}
