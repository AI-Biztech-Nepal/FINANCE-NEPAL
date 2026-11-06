// lib/components/finance/SalesListScreen.tsx
//
// The Sales page in the layout of Auto Stock Manager's: a line saying how many sales there are with a period
// filter and the Record Sale button, four summary cards, a search bar with a payment filter, then one list of
// sales - a table on a wide screen, cards on a phone. It reads this account's Sale bills; Record Sale opens the
// usual sale form and a row opens that bill.
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../hooks/useAuth';
import { useSupabaseQuery } from '../../hooks/useSupabase';
import { BookPage, FilterTabs, ToolbarButton, money, useBookLayout } from './BookKit';
import { adStringToBs, bsDaysInMonth, bsToAdString, toBsHistoryLabel } from '../../utils/nepaliDate';
import { localTodayIso } from '../../utils/localDate';
import { entryDay } from '../../utils/ledgerStatement';
import { itemNamesOf } from '../../utils/accountFeatures';
import type { BusinessTransaction, PaymentMode } from '../../../types/database.types';

type Period = 'all' | 'today' | 'week' | 'month';
type PayFilter = 'all' | PaymentMode;

const PERIODS: { key: Period; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
];

const PAY_FILTERS: { key: PayFilter; label: string }[] = [
  { key: 'all', label: 'All sales' },
  { key: 'cash', label: 'Cash' },
  { key: 'bank', label: 'Bank' },
  { key: 'credit', label: 'On credit' },
];

// Cash and bank are plain blue pills; a sale on credit stands out, as a due does in Auto Stock Manager.
const PAYMENT: Record<PaymentMode, { label: string; color: string; bg: string }> = {
  cash: { label: 'Cash', color: '#1D4ED8', bg: '#EFF6FF' },
  bank: { label: 'Bank', color: '#1D4ED8', bg: '#EFF6FF' },
  credit: { label: 'On credit', color: '#B91C1C', bg: '#FEF2F2' },
};

const CARD_SHADOW = { boxShadow: '0 1px 2px rgba(16,24,40,0.06)' } as object;

const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The days a period covers, as 'YYYY-MM-DD' - the month is the Nepali (BS) one, like the rest of the app. */
function rangeOf(period: Exclude<Period, 'all'>): { start: string; end: string } | null {
  const today = localTodayIso();
  if (period === 'today') return { start: today, end: today };
  if (period === 'week') {
    const [y, m, d] = today.split('-').map(Number);
    const sunday = new Date(y, m - 1, d - new Date(y, m - 1, d).getDay());
    return { start: isoOf(sunday), end: today };
  }
  const bs = adStringToBs(today);
  if (!bs) return null;
  return { start: bsToAdString(bs.year, bs.month, 1), end: bsToAdString(bs.year, bs.month, bsDaysInMonth(bs.year, bs.month)) };
}

interface SaleRow {
  tx: BusinessTransaction;
  day: string;
  items: string;
  customer: string;
  payment: (typeof PAYMENT)[PaymentMode];
}

const hovered = (state: unknown) => !!(state as { hovered?: boolean }).hovered;

function SummaryCard({ label, value, icon, color }: { label: string; value: string; icon: keyof typeof Ionicons.glyphMap; color: string }) {
  return (
    <View
      className="flex-row items-center rounded-xl border border-gray-200 bg-white px-3 py-3 sm:px-4"
      style={[{ flexGrow: 1, flexBasis: 150, gap: 12 }, CARD_SHADOW]}
    >
      <View className="items-center justify-center rounded-lg" style={{ width: 36, height: 36, backgroundColor: color }}>
        <Ionicons name={icon} size={17} color="#FFFFFF" />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text className="text-xs font-medium text-gray-500" numberOfLines={1}>
          {label}
        </Text>
        <Text className="text-[17px] font-extrabold leading-tight text-gray-900" numberOfLines={1}>
          {value}
        </Text>
      </View>
    </View>
  );
}

function PayPill({ payment }: { payment: SaleRow['payment'] }) {
  return (
    <View className="self-start rounded-full px-2 py-0.5" style={{ backgroundColor: payment.bg }}>
      <Text className="text-xs font-medium" style={{ color: payment.color }}>
        {payment.label}
      </Text>
    </View>
  );
}

const HEAD = 'text-xs font-semibold uppercase tracking-wider text-gray-500';

export function SalesListScreen() {
  const layout = useBookLayout();
  const userId = useAuthStore((state) => state.profile?.id);
  const { data: transactions, isLoading } = useSupabaseQuery('business_transactions', {
    filters: userId ? { owner_id: userId } : {},
    all: true,
    enabled: !!userId,
  });
  const [period, setPeriod] = useState<Period>('all');
  const [pay, setPay] = useState<PayFilter>('all');
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);

  const sales: SaleRow[] = useMemo(
    () =>
      ((transactions ?? []) as BusinessTransaction[])
        .filter((tx) => tx.type === 'sale')
        .map((tx) => ({
          tx,
          day: entryDay(tx.bill_date, tx.created_at),
          items: itemNamesOf(tx.items),
          customer: tx.party_name?.trim() ?? '',
          payment: PAYMENT[tx.payment_mode] ?? PAYMENT.cash,
        }))
        .sort((a, b) => (a.day === b.day ? b.tx.created_at.localeCompare(a.tx.created_at) : b.day.localeCompare(a.day))),
    [transactions]
  );

  const inRange = (row: SaleRow, range: { start: string; end: string } | null) => !range || (row.day >= range.start && row.day <= range.end);
  const periodRange = period === 'all' ? null : rangeOf(period);
  const monthRange = rangeOf('month');

  // Like Auto Stock Manager: the first two cards are the whole book, the third follows the period filter (This Month
  // when none is picked), the last is the average sale.
  const revenue = sales.reduce((sum, r) => sum + r.tx.amount, 0);
  const shownPeriod = period === 'all' ? 'month' : period;
  const periodCount = sales.filter((r) => inRange(r, period === 'all' ? monthRange : periodRange)).length;
  const periodLabel = PERIODS.find((p) => p.key === shownPeriod)?.label ?? 'This Month';

  const q = search.trim().toLowerCase();
  const filtered = sales.filter((r) => {
    if (!inRange(r, periodRange)) return false;
    if (pay !== 'all' && r.tx.payment_mode !== pay) return false;
    if (!q) return true;
    return [r.items, r.customer, r.tx.bill_no ?? '', r.payment.label].some((text) => text.toLowerCase().includes(q));
  });
  const anyFilter = period !== 'all' || pay !== 'all' || q.length > 0;
  const creditCount = sales.filter((r) => r.tx.payment_mode === 'credit').length;

  const recordSale = () => router.push('/(store)/transactions?type=sale&add=1' as never);
  const openSale = (r: SaleRow) => router.push(`/(store)/transactions?type=sale&add=1&edit=${r.tx.id}` as never);

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50">
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    );
  }

  return (
    <BookPage wide={layout.wide}>
      {/* Header: the count on the left, the period filter and Record Sale on the right */}
      <View className="flex-row flex-wrap items-center justify-between" style={{ gap: 12 }}>
        <Text className="text-sm text-gray-500">
          {periodRange ? `${filtered.length} sales · ${PERIODS.find((p) => p.key === period)?.label}` : `${sales.length} sales recorded`}
          {creditCount > 0 ? ` · ${creditCount} on credit` : ''}
        </Text>
        <View className="flex-row flex-wrap items-center" style={{ gap: 8 }}>
          <FilterTabs options={PERIODS} value={period} onChange={setPeriod} />
          <ToolbarButton icon="add" label="Record Sale" onPress={recordSale} />
        </View>
      </View>

      {/* Summary cards */}
      <View className="flex-row flex-wrap" style={{ gap: layout.wide ? 16 : 8 }}>
        <SummaryCard label="Total Sales" value={String(sales.length)} icon="bag-handle" color="#3B82F6" />
        <SummaryCard label="Total Revenue" value={`NPR ${money(revenue)}`} icon="trending-up" color="#22C55E" />
        <SummaryCard label={periodLabel} value={`${periodCount} sales`} icon="calendar" color="#6366F1" />
        <SummaryCard label="Avg Sale Price" value={`NPR ${money(sales.length ? revenue / sales.length : 0)}`} icon="cash" color="#A855F7" />
      </View>

      {/* Search and payment filter */}
      <View className="flex-row flex-wrap items-center rounded-xl border border-gray-200 bg-white p-3" style={[{ gap: 10 }, CARD_SHADOW]}>
        <View
          className="h-9 flex-row items-center rounded-lg border bg-white px-3"
          style={{ flexGrow: 1, flexBasis: 220, maxWidth: layout.wide ? 380 : undefined, borderColor: searchFocused ? '#3B82F6' : '#E5E7EB' }}
        >
          <Ionicons name="search" size={15} color="#9CA3AF" />
          <TextInput
            value={search}
            onChangeText={setSearch}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            placeholder="Search item, customer, bill no..."
            placeholderTextColor="#9CA3AF"
            autoComplete="off"
            spellCheck={false}
            className="ml-2 flex-1 text-sm text-gray-900"
            style={{ outlineStyle: 'none' } as object}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')} hitSlop={8} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={15} color="#9CA3AF" />
            </Pressable>
          )}
        </View>
        <FilterTabs options={PAY_FILTERS} value={pay} onChange={setPay} />
      </View>

      {/* The list */}
      <View className="overflow-hidden rounded-xl border border-gray-200 bg-white" style={CARD_SHADOW}>
        {filtered.length === 0 ? (
          <View className="items-center justify-center py-12">
            <Ionicons name="bag-handle-outline" size={34} color="#D1D5DB" />
            <Text className="mt-2 font-medium text-gray-500">{anyFilter ? 'No sales match this filter' : 'No sales recorded yet'}</Text>
            <Text className="mt-1 text-xs text-gray-400">{anyFilter ? 'Try clearing the search or filters' : 'Tap "Record Sale" to add one'}</Text>
          </View>
        ) : layout.wide ? (
          <View>
            <View className="flex-row items-center border-b border-gray-100 bg-white px-4 py-3">
              <Text className={HEAD} style={{ flex: 2.4 }}>Sale</Text>
              <Text className={HEAD} style={{ flex: 1.4 }}>Customer</Text>
              <Text className={HEAD} style={{ width: 140 }}>Amount</Text>
              <Text className={HEAD} style={{ width: 120 }}>Payment</Text>
              <Text className={HEAD} style={{ width: 130 }}>Date</Text>
              <View style={{ width: 20 }} />
            </View>
            {filtered.map((r) => (
              <Pressable
                key={r.tx.id}
                onPress={() => openSale(r)}
                className="flex-row items-center border-b border-gray-50 px-4 py-3"
                style={(state) => ({ backgroundColor: hovered(state) ? '#F9FAFB' : '#FFFFFF' })}
              >
                <View style={{ flex: 2.4, paddingRight: 12 }}>
                  <Text className="text-sm font-semibold text-gray-900" numberOfLines={1}>
                    {r.items || 'Sale'}
                  </Text>
                  {!!r.tx.bill_no && (
                    <Text className="mt-0.5 text-xs text-gray-400" numberOfLines={1}>
                      Bill {r.tx.bill_no}
                    </Text>
                  )}
                </View>
                <Text className="text-sm text-gray-700" style={{ flex: 1.4, paddingRight: 12 }} numberOfLines={1}>
                  {r.customer || 'Walk-in'}
                </Text>
                <Text className="text-sm font-bold text-green-700" style={{ width: 140 }} numberOfLines={1}>
                  NPR {money(r.tx.amount)}
                </Text>
                <View style={{ width: 120 }}>
                  <PayPill payment={r.payment} />
                </View>
                <Text className="text-sm text-gray-500" style={{ width: 130 }} numberOfLines={1}>
                  {toBsHistoryLabel(r.day)}
                </Text>
                <Ionicons name="chevron-forward" size={15} color="#D1D5DB" style={{ width: 20 }} />
              </Pressable>
            ))}
          </View>
        ) : (
          <View>
            {filtered.map((r, i) => (
              <Pressable
                key={r.tx.id}
                onPress={() => openSale(r)}
                className="px-4 py-3.5"
                style={(state) => ({
                  backgroundColor: state.pressed ? '#F9FAFB' : '#FFFFFF',
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: '#F3F4F6',
                })}
              >
                <Text className="text-sm font-semibold text-gray-900" numberOfLines={2}>
                  {r.items || 'Sale'}
                </Text>
                <Text className="mt-0.5 text-xs text-gray-500" numberOfLines={1}>
                  {r.customer || 'Walk-in'}
                  {r.tx.bill_no ? ` · Bill ${r.tx.bill_no}` : ''}
                </Text>
                <View className="mt-2 flex-row items-center justify-between">
                  <Text className="text-sm font-bold text-green-700">NPR {money(r.tx.amount)}</Text>
                  <PayPill payment={r.payment} />
                </View>
                <Text className="mt-1.5 text-xs text-gray-400">{toBsHistoryLabel(r.day)}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </BookPage>
  );
}
