// lib/components/finance/VisitsScreen.tsx
//
// Visits (Marketing): who visits the website. The website counts each page it opens (see the snippet in its main.js, which
// calls record_visit); the totals for the period are worked out by the database (visits_summary, see 0030_marketing.sql).
// Shown: visits, visitors, the busiest pages, where people came from, and phone against computer, over Today, Yesterday,
// 7 days, a month or a year.
import { useMemo, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../supabase';
import { BookPage, BookStat, BookStats, FilterTabs, useBookLayout } from './BookKit';

type Range = 'today' | 'yesterday' | 'week' | 'month' | 'year';
const RANGES: { key: Range; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: '7 days' },
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' },
];

interface Counted {
  name: string;
  count: number;
}
interface Summary {
  visits: number;
  visitors: number;
  pages: Counted[];
  referrers: Counted[];
  devices: Counted[];
  days: Counted[];
}

/** The period as [from, to) in this computer's own time, from midnight. */
function windowOf(range: Range): { from: string; to: string } {
  const d = new Date();
  const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const at = (days: number) => new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate() + days).toISOString();
  switch (range) {
    case 'today': return { from: at(0), to: at(1) };
    case 'yesterday': return { from: at(-1), to: at(0) };
    case 'week': return { from: at(-6), to: at(1) };
    case 'month': return { from: at(-29), to: at(1) };
    case 'year': return { from: at(-364), to: at(1) };
  }
}

const pageName = (path: string) => (path === '/' || path === '/index.html' ? 'Home' : path.replace(/^\//, '').replace(/\.html$/, '').replace(/\.php$/, '') || 'Home');

/** One list as bars: name, count and a bar sized against the biggest. */
function BarList({ title, rows, icon }: { title: string; rows: Counted[]; icon: keyof typeof Ionicons.glyphMap }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <View className="rounded-xl border border-gray-200 bg-white p-4" style={{ flexGrow: 1, flexBasis: 280 }}>
      <View className="mb-3 flex-row items-center" style={{ gap: 8 }}>
        <Ionicons name={icon} size={16} color="#2563EB" />
        <Text className="text-sm font-bold text-gray-900">{title}</Text>
      </View>
      {rows.length === 0 ? (
        <Text className="text-xs text-gray-400">Nothing yet.</Text>
      ) : (
        <View style={{ gap: 10 }}>
          {rows.map((r) => (
            <View key={r.name}>
              <View className="flex-row items-center justify-between" style={{ gap: 8 }}>
                <Text className="text-xs font-semibold text-gray-700" style={{ flex: 1 }} numberOfLines={1}>{r.name}</Text>
                <Text className="text-xs font-bold text-gray-900">{r.count.toLocaleString()}</Text>
              </View>
              <View className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
                <View style={{ width: `${Math.max(3, (r.count / max) * 100)}%`, height: 6, backgroundColor: '#3B82F6', borderRadius: 999 }} />
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export function VisitsScreen() {
  const layout = useBookLayout();
  const [range, setRange] = useState<Range>('week');
  const { data, isLoading, error } = useQuery<Summary>({
    queryKey: ['visits-summary', range],
    queryFn: async () => {
      const { from, to } = windowOf(range);
      const { data: summary, error: rpcError } = await (supabase as any).rpc('visits_summary', { p_from: from, p_to: to });
      if (rpcError) throw rpcError;
      return summary as Summary;
    },
    staleTime: 30_000,
  });

  const pages = useMemo(() => (data?.pages ?? []).map((p) => ({ ...p, name: pageName(p.name) })), [data]);
  const devices = useMemo(() => (data?.devices ?? []).map((p) => ({ ...p, name: p.name === 'mobile' ? 'Phone' : p.name === 'tablet' ? 'Tablet' : 'Computer' })), [data]);
  const days = data?.days ?? [];
  const peak = Math.max(1, ...days.map((d) => d.count));

  return (
    <BookPage wide={layout.wide}>
      <View className="flex-row flex-wrap items-center justify-between" style={{ gap: 12 }}>
        <Text className="text-sm text-gray-500">Who visits allinoneabroad.com</Text>
        <FilterTabs options={RANGES} value={range} onChange={setRange} />
      </View>

      {isLoading ? (
        <View className="items-center py-16">
          <ActivityIndicator size="large" color="#2563EB" />
        </View>
      ) : error || !data ? (
        <View className="items-center rounded-xl border border-gray-200 bg-white px-6 py-12">
          <Ionicons name="alert-circle-outline" size={34} color="#D1D5DB" />
          <Text className="mt-2 font-medium text-gray-500">Visits could not be read</Text>
          <Text className="mt-1 text-center text-xs text-gray-400">Run the 0030_marketing.sql migration in Supabase, then reload.</Text>
        </View>
      ) : (
        <>
          <BookStats>
            <BookStat label="Visits" value={data.visits.toLocaleString()} color="#1D4ED8" />
            <BookStat label="Visitors" value={data.visitors.toLocaleString()} color="#047857" />
            <BookStat label="Pages per visitor" value={data.visitors ? (data.visits / data.visitors).toFixed(1) : '0'} color="#374151" />
          </BookStats>

          {data.visits === 0 ? (
            <View className="items-center rounded-xl border border-gray-200 bg-white px-6 py-12">
              <Ionicons name="eye-outline" size={34} color="#D1D5DB" />
              <Text className="mt-2 font-medium text-gray-500">No visits in this period</Text>
              <Text className="mt-1 text-center text-xs text-gray-400">Visits are counted once the website update that records them is live.</Text>
            </View>
          ) : (
            <>
              <View className="rounded-xl border border-gray-200 bg-white p-4">
                <Text className="mb-3 text-sm font-bold text-gray-900">Visits per day</Text>
                <View className="flex-row items-end" style={{ gap: days.length > 60 ? 1 : 3, height: 110 }}>
                  {days.map((d) => (
                    <View key={d.name} style={{ flex: 1, height: `${Math.max(4, (d.count / peak) * 100)}%`, backgroundColor: '#3B82F6', borderRadius: 2, minWidth: 1 }} accessibilityLabel={`${d.name}: ${d.count} visits`} />
                  ))}
                </View>
                <View className="mt-1.5 flex-row justify-between">
                  <Text className="text-[11px] text-gray-400">{days[0]?.name}</Text>
                  <Text className="text-[11px] text-gray-400">{days[days.length - 1]?.name}</Text>
                </View>
              </View>
              <View className="flex-row flex-wrap" style={{ gap: 12 }}>
                <BarList title="Busiest pages" rows={pages} icon="document-text-outline" />
                <BarList title="Where they came from" rows={data.referrers} icon="navigate-outline" />
                <BarList title="Phone or computer" rows={devices} icon="phone-portrait-outline" />
              </View>
            </>
          )}
        </>
      )}
    </BookPage>
  );
}
