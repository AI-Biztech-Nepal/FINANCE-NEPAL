// lib/components/finance/OffersScreen.tsx
//
// Offers (Marketing): a prize wheel for customers. The prizes - how likely each is and how many can still be won - are set
// here; customers spin it on the website's Spin & Win page (spin.html) with their name and mobile number, once per number,
// and every spin is listed below. The draw itself is done by the database (spin_wheel, see 0030_marketing.sql), so the
// stock can never go below zero and two people cannot win the last prize.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../hooks/useAuth';
import { useSupabaseDelete, useSupabaseInsert, useSupabaseQuery, useSupabaseUpdate } from '../../hooks/useSupabase';
import { BookPage, BookStat, BookStats, ToolbarButton, useBookLayout } from './BookKit';
import { dayLabel } from './leadKit';
import { localTodayIso } from '../../utils/localDate';
import { showAlert, getErrorMessage } from '../../utils/alert';
import type { OfferPrize, OfferSpin } from '../../../types/database.types';

const BLUE = '#2563EB';
const SPIN_PAGE = 'https://allinoneabroad.com/spin.html';

interface Row {
  id: string | null;
  name: string;
  weight: string;
  stock: string;
}
const rowOf = (p: OfferPrize): Row => ({ id: p.id, name: p.name, weight: String(p.weight), stock: String(p.stock) });

function Cell({ value, onChange, placeholder, numeric, width }: { value: string; onChange: (v: string) => void; placeholder?: string; numeric?: boolean; width?: number }) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      placeholder={placeholder}
      placeholderTextColor="#9CA3AF"
      keyboardType={numeric ? 'numeric' : undefined}
      className="rounded-lg bg-white px-3 py-2.5 text-sm text-gray-900"
      style={[{ borderWidth: 1, borderColor: focused ? BLUE : '#D1D5DB' }, width ? { width } : { flex: 1, minWidth: 0 }, { outlineStyle: 'none' } as object]}
    />
  );
}

export function OffersScreen() {
  const layout = useBookLayout();
  const userId = useAuthStore((state) => state.profile?.id);
  const filters: Record<string, string> = userId ? { owner_id: userId } : {};
  const prizesQ = useSupabaseQuery('offer_prizes', { filters, orderBy: { column: 'created_at' }, all: true, enabled: !!userId });
  const spinsQ = useSupabaseQuery('offer_spins', { filters, all: true, enabled: !!userId });
  const createPrize = useSupabaseInsert('offer_prizes');
  const updatePrize = useSupabaseUpdate('offer_prizes');
  const deletePrize = useSupabaseDelete('offer_prizes');

  const saved = useMemo(() => (prizesQ.data ?? []) as OfferPrize[], [prizesQ.data]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  // The editable list starts from what is saved, once, and is then only changed by the user (a refetch must not wipe edits).
  useEffect(() => {
    if (rows === null && !prizesQ.isLoading && prizesQ.data) setRows(saved.map(rowOf));
  }, [rows, prizesQ.isLoading, prizesQ.data, saved]);

  const spins = useMemo(() => [...((spinsQ.data ?? []) as OfferSpin[])].sort((a, b) => b.created_at.localeCompare(a.created_at)), [spinsQ.data]);
  const today = localTodayIso();
  const spunToday = spins.filter((s) => s.created_at.slice(0, 10) === today || new Date(s.created_at).toDateString() === new Date().toDateString()).length;
  const left = saved.reduce((sum, p) => sum + p.stock, 0);

  const list = rows ?? [];
  const inPlay = list.filter((r) => Number(r.stock) > 0 && Number(r.weight) > 0);
  const totalWeight = inPlay.reduce((sum, r) => sum + Number(r.weight), 0);
  const chance = (r: Row) => (Number(r.stock) > 0 && Number(r.weight) > 0 && totalWeight > 0 ? Math.round((Number(r.weight) / totalWeight) * 100) : 0);
  const edit = (i: number, patch: Partial<Row>) => setRows((prev) => (prev ? prev.map((r, j) => (j === i ? { ...r, ...patch } : r)) : prev));

  async function save() {
    if (!userId || saving || rows === null) return;
    for (const r of rows) {
      const weight = Number(r.weight);
      const stock = Number(r.stock);
      if (!r.name.trim()) return showAlert('Name every prize', 'Each prize needs a name.');
      if (!(weight >= 0) || !Number.isInteger(stock) || stock < 0) return showAlert('Check the numbers', `"${r.name.trim()}": the chance can be 0 or more, and the stock must be a whole number, 0 or more.`);
    }
    setSaving(true);
    try {
      const keep = new Set(rows.map((r) => r.id).filter(Boolean));
      for (const p of saved) if (!keep.has(p.id)) await deletePrize.mutateAsync(p.id);
      const next: Row[] = [];
      for (const r of rows) {
        const values = { name: r.name.trim(), weight: Number(r.weight), stock: Number(r.stock) };
        if (r.id) {
          await updatePrize.mutateAsync({ id: r.id, values });
          next.push({ ...r, name: values.name });
        } else {
          const created = await createPrize.mutateAsync({ owner_id: userId, ...values });
          next.push({ ...r, id: created.id, name: values.name });
        }
      }
      setRows(next);
      showAlert('Prizes saved', 'The wheel on the website uses these now.');
    } catch (err) {
      showAlert('Could not save', getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function copyLink() {
    if (Platform.OS === 'web' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(SPIN_PAGE);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        return;
      } catch {
        // fall through to showing the link
      }
    }
    showAlert('Spin page', SPIN_PAGE);
  }

  if (prizesQ.isLoading || spinsQ.isLoading || rows === null) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50">
        <ActivityIndicator size="large" color={BLUE} />
      </View>
    );
  }

  return (
    <BookPage wide={layout.wide}>
      <View className="flex-row flex-wrap items-center justify-between" style={{ gap: 12 }}>
        <Text className="text-sm text-gray-500">A prize wheel for your customers: Spin &amp; Win</Text>
        <ToolbarButton icon="add" label="Add Prize" onPress={() => setRows((prev) => [...(prev ?? []), { id: null, name: '', weight: '1', stock: '1' }])} />
      </View>

      <BookStats>
        <BookStat label="Spins" value={String(spins.length)} color="#374151" />
        <BookStat label="Spun today" value={String(spunToday)} color="#1D4ED8" />
        <BookStat label="Prizes left" value={String(left)} color={left > 0 ? '#047857' : '#B91C1C'} />
      </BookStats>

      <View className="rounded-xl border border-gray-200 bg-white p-4">
        <Text className="mb-1 text-sm font-bold text-gray-900">Spin page</Text>
        <Text className="mb-3 text-xs text-gray-500">Share this link, or print it as a QR code for the shop. A customer enters a name and mobile number and spins once.</Text>
        <View className="flex-row flex-wrap items-center" style={{ gap: 8 }}>
          <View className="rounded-lg bg-gray-50 px-3 py-2.5" style={{ flexShrink: 1 }}>
            <Text className="text-sm text-gray-700" numberOfLines={1} selectable>
              {SPIN_PAGE}
            </Text>
          </View>
          <Pressable onPress={copyLink} className="flex-row items-center rounded-lg border border-gray-300 bg-white px-3 py-2.5" style={{ gap: 6 }}>
            <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={15} color="#374151" />
            <Text className="text-xs font-bold text-gray-700">{copied ? 'Copied' : 'Copy'}</Text>
          </Pressable>
          <Pressable onPress={() => void Linking.openURL(SPIN_PAGE)} className="flex-row items-center rounded-lg border border-gray-300 bg-white px-3 py-2.5" style={{ gap: 6 }}>
            <Ionicons name="open-outline" size={15} color="#374151" />
            <Text className="text-xs font-bold text-gray-700">Open</Text>
          </Pressable>
        </View>
      </View>

      <View className="rounded-xl border border-gray-200 bg-white p-4">
        <Text className="mb-1 text-sm font-bold text-gray-900">Prizes</Text>
        <Text className="mb-3 text-xs text-gray-500">Chance: a prize of 2 comes up twice as often as a prize of 1. Stock: how many can still be won; at 0 it leaves the wheel.</Text>
        {list.length === 0 ? (
          <Text className="py-6 text-center text-sm text-gray-400">No prizes yet. Tap Add Prize.</Text>
        ) : (
          <View style={{ gap: 8 }}>
            <View className="flex-row" style={{ gap: 8 }}>
              <Text className="text-[11px] font-bold tracking-wide text-gray-500" style={{ flex: 1 }}>Prize</Text>
              <Text className="text-[11px] font-bold tracking-wide text-gray-500" style={{ width: 70 }}>Chance</Text>
              <Text className="text-[11px] font-bold tracking-wide text-gray-500" style={{ width: 70 }}>Stock</Text>
              <View style={{ width: 52 + 22 }} />
            </View>
            {list.map((r, i) => (
              <View key={r.id ?? `new-${i}`} className="flex-row items-center" style={{ gap: 8 }}>
                <Cell value={r.name} onChange={(v) => edit(i, { name: v })} placeholder="e.g. Rice cooker" />
                <Cell value={r.weight} onChange={(v) => edit(i, { weight: v })} numeric width={70} />
                <Cell value={r.stock} onChange={(v) => edit(i, { stock: v })} numeric width={70} />
                <Text className="text-xs font-semibold text-gray-400" style={{ width: 52, textAlign: 'right' }}>
                  {chance(r)}%
                </Text>
                <Pressable onPress={() => setRows((prev) => (prev ? prev.filter((_, j) => j !== i) : prev))} hitSlop={8} accessibilityLabel="Remove prize">
                  <Ionicons name="trash-outline" size={18} color="#9CA3AF" />
                </Pressable>
              </View>
            ))}
          </View>
        )}
        <View className="mt-4 flex-row">
          <Pressable onPress={save} disabled={saving} className="rounded-xl px-6 py-3 disabled:opacity-50" style={{ backgroundColor: '#1D4ED8' }}>
            <Text className="text-sm font-bold text-white">{saving ? 'Saving...' : 'Save prizes'}</Text>
          </Pressable>
        </View>
      </View>

      <View className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <Text className="px-4 pb-2 pt-3 text-sm font-bold text-gray-900">Who spun</Text>
        {spins.length === 0 ? (
          <Text className="px-4 pb-5 text-sm text-gray-400">No one has spun yet.</Text>
        ) : (
          spins.slice(0, 100).map((s, i) => (
            <View key={s.id} className="flex-row items-center px-4 py-3" style={{ gap: 12, borderTopWidth: 1, borderTopColor: i === 0 ? '#E5E7EB' : '#F3F4F6' }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text className="text-sm font-semibold text-gray-900" numberOfLines={1}>{s.name}</Text>
                <Text className="mt-0.5 text-xs text-gray-500">{s.phone} · {dayLabel(s.created_at)}</Text>
              </View>
              <View className="rounded-full bg-green-50 px-2.5 py-1" style={{ maxWidth: '45%' }}>
                <Text className="text-xs font-bold text-green-700" numberOfLines={1}>{s.prize}</Text>
              </View>
            </View>
          ))
        )}
      </View>
    </BookPage>
  );
}
