// app/(store)/_layout.tsx
import { useMemo } from 'react';
import { ActivityIndicator, Platform, View, useWindowDimensions } from 'react-native';
import { Tabs } from 'expo-router';
import { useFeature, useFeaturesLoaded } from '../../lib/features/useFeatures';
import { RoleGuard } from '../../lib/components/RoleGuard';
import { freshScreenLayout } from '../../lib/components/FreshScreen';
import { TabIcon } from '../../lib/components/TabIcon';
import { PortalHeaderBar } from '../../lib/components/PortalHeaderBar';
import { ROLE_ACCENT } from '../../lib/constants/roleColors';
import { WebSidebarShell, WEB_SIDEBAR_MIN_WIDTH, type WebNavItem } from '../../lib/components/web/WebSidebarShell';
import { shortcuts as financeShortcuts } from '../../lib/components/finance/FinanceDashboardScreen';
import { ENTRY_KINDS } from '../../lib/components/finance/entryKinds';

// The mobile bottom tabs below, as a persistent left rail on web instead - see WebSidebarShell.
// Finance's own shortcuts are nested under Finance, reusing the same list the Finance page uses, so
// the two never drift. Received, Payment Out, Sales, Purchase and Expenses are already reachable
// from the buttons on the Day Book, so the side panel doesn't repeat them.
const DAYBOOK_ENTRY_KEYS = new Set(ENTRY_KINDS.map((kind) => kind.key));
// The order Finance's pages run down the side panel: Stock and Inventory sits just below the Statement,
// and Report stays last. Anything not named here goes after them.
const FINANCE_NAV_ORDER = ['daybook', 'customers', 'transactions', 'inventory', 'bank-accounts', 'report'];
const financeNavRank = (key: string) => {
  const i = FINANCE_NAV_ORDER.indexOf(key);
  return i === -1 ? FINANCE_NAV_ORDER.length : i;
};

// Every report there is (the same list the Report page itself shows, see ReportScreen.tsx),
// nested under Report in the side panel - a family of report types one step in, all reachable
// without opening the Report page first. Total Received and Total Paid are not in it: they open from
// the Total received / Total paid cards on the Ledger (and on the Finance page).
const REPORT_FAMILY: WebNavItem[] = [
  { href: '/(store)/sales-report', label: 'Sales Report', icon: 'trending-up' },
  { href: '/(store)/purchase-report', label: 'Purchase Report', icon: 'cart' },
  { href: '/(store)/expense-report', label: 'Expenses Report', icon: 'receipt' },
  { href: '/(store)/to-receive', label: 'Receivable Report', icon: 'people' },
  { href: '/(store)/to-give', label: 'Payable Report', icon: 'storefront' },
];

const NAV_ITEMS: WebNavItem[] = [
  { href: '/(store)/company-dashboard', label: 'Dashboard', icon: 'grid' },
  {
    href: '/(store)/finance',
    label: 'Finance',
    icon: 'wallet',
    children: financeShortcuts('/(store)')
      .filter((s) => !DAYBOOK_ENTRY_KEYS.has(s.key))
      .sort((a, b) => financeNavRank(a.key) - financeNavRank(b.key))
      .map((s) => ({
        href: s.href,
        label: s.label,
        icon: s.icon,
        ...(s.key === 'report' ? { children: REPORT_FAMILY } : null),
      })),
  },
];

// What an organization's features add to the side panel. Vehicles: Stock and Inventory becomes two lists - Stock (only
// what is still in hand) stays one of Finance's pages, where Stock and Inventory was, and Inventory (every vehicle, in
// stock and sold) goes in the side panel just below Dashboard. Rent and EMI: Rent & EMI (the ones that are on, nested
// under it) goes there too, ahead of Inventory.
interface NavFeatures {
  vehicles: boolean;
  rent: boolean;
  emi: boolean;
}

function rentEmiNav({ rent, emi }: NavFeatures): WebNavItem | null {
  const emiItem: WebNavItem = { href: '/(store)/rent?tab=emi', label: 'EMI', icon: 'card' };
  const rentItem: WebNavItem = { href: '/(store)/rent?tab=rent', label: 'Rent', icon: 'key' };
  if (rent && emi) return { href: '/(store)/rent', label: 'Rent & EMI', icon: 'car', heading: true, children: [emiItem, rentItem] };
  return emi ? emiItem : rent ? rentItem : null;
}

function featureNav(items: WebNavItem[], on: NavFeatures): WebNavItem[] {
  const stock: WebNavItem = { href: '/(store)/stock', label: 'Stock', icon: 'cube' };
  const rentEmi = rentEmiNav(on);
  const own: WebNavItem[] = [
    ...(rentEmi ? [rentEmi] : []),
    ...(on.vehicles ? [{ href: '/(store)/inventory', label: 'Inventory', icon: 'layers' } as WebNavItem] : []),
  ];
  if (!own.length) return items;
  const at = items.findIndex((item) => item.href.endsWith('/company-dashboard'));
  const merged = [...items.slice(0, at + 1), ...own, ...items.slice(at + 1)];
  if (!on.vehicles) return merged;
  return merged.map((item) =>
    item.children ? { ...item, children: item.children.map((child) => (child.href.endsWith('/inventory') ? stock : child)) } : item
  );
}

const HIDDEN: [string, string][] = [
  ['rent', 'Rent & EMI'],
  ['rent-entry', 'Rent'],
  ['emi-entry', 'EMI'],
  ['customers', 'Ledger'],
  ['customer/[id]', 'Ledger'],
  ['transactions', 'Statement'],
  // Stock and Inventory is one of Finance's pages now (side panel, and a tile on the Finance page on a phone). A vehicle
  // account has it as Inventory, and Stock (only what is in hand) in Finance - see featureNav.
  ['inventory', 'Stock and Inventory'],
  ['stock', 'Stock'],
  ['quick-payment', 'Quick Payment'],
  ['voucher', 'Journal Voucher'],
  ['contra', 'Contra'],
  ['received', 'Total Received'],
  ['paid', 'Total Paid'],
  ['sales-report', 'Sales Report'],
  ['purchase-report', 'Purchase Report'],
  ['expense-report', 'Expenses Report'],
  ['party-report', 'Ledger'],
  ['to-receive', 'Receivable Report'],
  ['to-give', 'Payable Report'],
  ['bank-accounts', 'Bank Accounts'],
  ['bank-balances', 'Available Balance'],
  ['import-statement', 'Import Statement'],
  ['report', 'Report'],
  ['daybook', 'Day Book'],
  ['profile', 'Company Details'],
];

export default function StoreLayout() {
  const { width } = useWindowDimensions();
  const isWideWeb = Platform.OS === 'web' && width >= WEB_SIDEBAR_MIN_WIDTH;
  const vehicles = useFeature('finance.vehicles');
  const rent = useFeature('finance.rent');
  const emi = useFeature('finance.emi');
  const featuresLoaded = useFeaturesLoaded();
  const navItems = useMemo(() => featureNav(NAV_ITEMS, { vehicles, rent, emi }), [vehicles, rent, emi]);
  const tabs = (
    <Tabs
      backBehavior="history"
      // Coming back to a page starts it fresh: nothing left open, nothing typed, the figures read again.
      screenLayout={freshScreenLayout}
      screenOptions={{
        header: ({ options }) => (
          <PortalHeaderBar
            title={options.title}
            hideAccount={isWideWeb}
            left={options.headerLeft?.({ canGoBack: false })}
            right={options.headerRight?.({ canGoBack: false })}
          />
        ),
        tabBarActiveTintColor: ROLE_ACCENT.store,
        ...(isWideWeb ? { tabBarStyle: { display: 'none' } } : null),
      }}
    >
      <Tabs.Screen
        name="company-dashboard"
        options={{ title: 'Dashboard', tabBarIcon: ({ color, focused }) => <TabIcon name="grid" color={color} focused={focused} /> }}
      />
      <Tabs.Screen
        name="finance"
        options={{ title: 'Finance', tabBarIcon: ({ color, focused }) => <TabIcon name="wallet" color={color} focused={focused} /> }}
      />
      {HIDDEN.map(([name, title]) => (
        <Tabs.Screen key={name} name={name} options={{ href: null, title: vehicles && name === 'inventory' ? 'Inventory' : title }} />
      ))}
    </Tabs>
  );

  return (
    <RoleGuard allow={['store']}>
      {/* The side panel is built from the organization's features: hold the page until they are in, so it never shows a
          panel without Rent & EMI for a moment and then grows one. */}
      {!featuresLoaded ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' }}>
          <ActivityIndicator />
        </View>
      ) : isWideWeb ? (
        <WebSidebarShell items={navItems} roleLabel="Company" profileHref="/(store)/profile">
          {tabs}
        </WebSidebarShell>
      ) : (
        tabs
      )}
    </RoleGuard>
  );
}
