// lib/components/finance/LeadsScreen.tsx
//
// Leads, kept simple: the customer's name, how they found the shop, and everything they have bought - every sale, not
// just the latest. A lead is written here by the Lead block of the Record Sale form (see recordLeadFromSale); this page
// only lists them.
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../hooks/useAuth';
import { useSupabaseDelete, useSupabaseQuery } from '../../hooks/useSupabase';
import { BookPage, ToolbarSearch, money, useBookLayout } from './BookKit';
import { LEAD_SOURCES } from './leadKit';
import { showAlert, getErrorMessage } from '../../utils/alert';
import { itemNamesOf } from '../../utils/accountFeatures';
import { toBsHistoryLabel } from '../../utils/nepaliDate';
import { sourceOfPurchase } from '../../utils/purchaseSource';
import type { BusinessTransaction, Lead, LeadSource } from '../../../types/database.types';

const SOURCE = Object.fromEntries(LEAD_SOURCES.map((s) => [s.key, s])) as Record<LeadSource, (typeof LEAD_SOURCES)[number]>;

type IconName = keyof typeof Ionicons.glyphMap;
type Tab = 'all' | LeadSource;
const TAB_BLUE = '#2563EB';

/** The outline of an icon when it has one (a tab that is not chosen), else the icon itself (the brand logos have none). */
const outlined = (icon: IconName, filled: boolean): IconName => {
  const outline = `${icon}-outline` as IconName;
  return !filled && outline in Ionicons.glyphMap ? outline : icon;
};

/** How they found the shop: "TikTok", or "Referral · Ram Sharma" with who referred them. */
const how = (source: LeadSource, note: string | null | undefined) => (note ? `${SOURCE[source].label} · ${note}` : SOURCE[source].label);
const howOf = (l: Lead) => how(l.source, l.source_note);

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

export function LeadsScreen() {
  const layout = useBookLayout();
  const userId = useAuthStore((state) => state.profile?.id);
  const { data, isLoading } = useSupabaseQuery('leads', {
    filters: userId ? { owner_id: userId } : {},
    all: true,
    enabled: !!userId,
  });
  const salesQ = useSupabaseQuery('business_transactions', {
    filters: userId ? { owner_id: userId, type: 'sale' } : {},
    all: true,
    enabled: !!userId,
  });
  // Only to find the saved customer of a lead that was written without one (matched by name, as the CRM page does).
  const customersQ = useSupabaseQuery('customers', {
    filters: userId ? { owner_id: userId } : {},
    columns: 'id,name',
    all: true,
    enabled: !!userId,
  });
  const deleteLead = useSupabaseDelete('leads');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<Tab>('all');

  const leads: Lead[] = useMemo(() => [...((data ?? []) as Lead[])].sort((a, b) => b.created_at.localeCompare(a.created_at)), [data]);

  // Every sale each person has made, newest first - not only the one that last touched their lead.
  const purchasesOf = useMemo(() => {
    const sales = new Map<string, BusinessTransaction[]>();
    for (const s of (salesQ.data ?? []) as BusinessTransaction[]) {
      if (!s.customer_id) continue;
      sales.set(s.customer_id, [...(sales.get(s.customer_id) ?? []), s]);
    }
    const dateOf = (t: BusinessTransaction) => t.bill_date ?? t.created_at;
    for (const list of sales.values()) list.sort((a, b) => dateOf(b).localeCompare(dateOf(a)) || b.created_at.localeCompare(a.created_at));
    const byName = new Map(((customersQ.data ?? []) as { id: string; name: string }[]).map((c) => [norm(c.name), c.id]));
    return (l: Lead): BusinessTransaction[] => sales.get(l.customer_id ?? byName.get(norm(l.name)) ?? '') ?? [];
  }, [salesQ.data, customersQ.data]);
  const q = search.trim().toLowerCase();
  const shown = leads.filter(
    (l) => (tab === 'all' || l.source === tab) && (!q || l.name.toLowerCase().includes(q) || howOf(l).toLowerCase().includes(q))
  );
  const tabs: { key: Tab; label: string; icon?: IconName; count: number }[] = [
    { key: 'all', label: 'All', count: leads.length },
    ...LEAD_SOURCES.map((s) => ({ key: s.key as Tab, label: s.label, icon: s.icon, count: leads.filter((l) => l.source === s.key).length })),
  ];

  function confirmDelete(l: Lead) {
    showAlert('Delete this lead?', `${l.name} will be removed from Leads. Their sales are not affected.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteLead.mutateAsync(l.id);
          } catch (err) {
            showAlert('Could not delete', getErrorMessage(err));
          }
        },
      },
    ]);
  }

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50">
        <ActivityIndicator size="large" color="#2563EB" />
      </View>
    );
  }

  return (
    <BookPage wide={layout.wide}>
      <View className="flex-row" style={{ maxWidth: 380 }}>
        <ToolbarSearch value={search} onChange={setSearch} placeholder="Search customer or how they came" wide={false} />
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
              style={{ height: 40, gap: 7, backgroundColor: on ? TAB_BLUE : '#FFFFFF', borderWidth: 1, borderColor: on ? TAB_BLUE : '#E5E7EB' }}
            >
              {!!t.icon && <Ionicons name={outlined(t.icon, on)} size={15} color={on ? '#FFFFFF' : '#374151'} />}
              <Text className="text-sm font-semibold" style={{ color: on ? '#FFFFFF' : '#374151' }}>
                {t.label}
              </Text>
              <View
                className="items-center justify-center rounded-full px-1.5"
                style={{ minWidth: 22, height: 20, backgroundColor: on ? 'rgba(255,255,255,0.28)' : '#F1F5F9' }}
              >
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
          <Ionicons name="megaphone-outline" size={34} color="#D1D5DB" />
          <Text className="mt-2 font-medium text-gray-500">{leads.length === 0 ? 'No leads yet' : 'No leads match'}</Text>
          {leads.length === 0 && (
            <Text className="mt-1 px-6 text-center text-xs text-gray-400">On Record Sale, pick under Lead how the customer found the shop.</Text>
          )}
        </View>
      ) : (
        <View className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {shown.map((l, i) => {
            const s = SOURCE[l.source];
            const bought = purchasesOf(l);
            return (
              <View key={l.id} className="flex-row items-center px-4 py-3.5" style={{ gap: 12, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: '#F3F4F6' }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text className="text-[15px] font-semibold text-gray-900" numberOfLines={1}>
                    {l.name}
                  </Text>
                  {bought.length > 0 && (
                    <View className="mt-1.5" style={{ gap: 3 }}>
                      <Text className="text-[11px] font-semibold text-gray-400">
                        {bought.length} {bought.length === 1 ? 'purchase' : 'purchases'}
                      </Text>
                      {bought.map((tx) => {
                        // What this sale was saved with. A sale saved before sources were kept has none, and says so rather
                        // than borrowing the person's latest source (which would make every purchase read the same).
                        const own = sourceOfPurchase(l.history, tx.id);
                        const meta = own ? SOURCE[own.source] : undefined;
                        return (
                          <View key={tx.id} className="flex-row items-center justify-between" style={{ gap: 10 }}>
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text className="text-xs text-gray-600" numberOfLines={1}>
                                {itemNamesOf(tx.items) || 'Sale'} · {toBsHistoryLabel(tx.bill_date ?? tx.created_at)}
                              </Text>
                              {own && meta ? (
                                <View className="flex-row items-center" style={{ gap: 4 }}>
                                  <Ionicons name={meta.icon} size={11} color={meta.color} />
                                  <Text className="text-[11px] font-semibold" style={{ color: meta.color, flexShrink: 1 }} numberOfLines={1}>
                                    {how(own.source, own.note)}
                                  </Text>
                                </View>
                              ) : (
                                <Text className="text-[11px] text-gray-400">Source not recorded</Text>
                              )}
                            </View>
                            <Text className="text-xs font-semibold text-gray-700">NPR {money(tx.amount)}</Text>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
                <View className="flex-row items-center rounded-full px-2.5 py-1" style={{ gap: 5, backgroundColor: s.bg, flexShrink: 0, maxWidth: '55%' }}>
                  <Ionicons name={s.icon} size={12} color={s.color} />
                  <Text className="text-xs font-semibold" style={{ color: s.color }} numberOfLines={1}>
                    {howOf(l)}
                  </Text>
                </View>
                <Pressable onPress={() => confirmDelete(l)} hitSlop={8} accessibilityLabel={`Delete ${l.name}`}>
                  <Ionicons name="trash-outline" size={16} color="#D1D5DB" />
                </Pressable>
              </View>
            );
          })}
        </View>
      )}
    </BookPage>
  );
}
