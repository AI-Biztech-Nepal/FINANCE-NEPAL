// app/(store)/_layout.tsx
import { useMemo, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { Tabs } from 'expo-router';
import { useAuthStore } from '../../lib/hooks/useAuth';
import { isAllInOneAbroad, sellsVehicles } from '../../lib/utils/accountFeatures';
import { RoleGuard } from '../../lib/components/RoleGuard';
import { freshScreenLayout } from '../../lib/components/FreshScreen';
import { TabIcon } from '../../lib/components/TabIcon';
import { PortalHeaderBar } from '../../lib/components/PortalHeaderBar';
import { MobileNavDrawer } from '../../lib/components/MobileNavDrawer';
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

const navWith = (pages: ReturnType<typeof financeShortcuts>): WebNavItem[] => [
  { href: '/(store)/company-dashboard', label: 'Dashboard', icon: 'grid' },
  {
    href: '/(store)/finance',
    label: 'Finance',
    icon: 'wallet',
    children: pages.map((s) => ({
      href: s.href,
      label: s.label,
      icon: s.icon,
      ...(s.key === 'report' ? { children: REPORT_FAMILY } : null),
    })),
  },
];

const NAV_ITEMS = navWith(
  financeShortcuts('/(store)')
    .filter((s) => !DAYBOOK_ENTRY_KEYS.has(s.key))
    .sort((a, b) => financeNavRank(a.key) - financeNavRank(b.key))
);

// The phone's side panel (MobileNavDrawer) lists every one of the Finance page's shortcuts, the entries
// (Received, Paid, Sales, Purchase, Expenses) included, in that page's own order.
const PHONE_NAV_ITEMS = navWith(financeShortcuts('/(store)'));

// A vehicle account also rents its cars out and sells them on EMI, and keeps Stock and Inventory as two lists: Stock
// (only what is still in hand) stays one of Finance's pages, where Stock and Inventory was; Rent & EMI (EMI and Rent
// nested under it) and then Inventory (every vehicle, in stock and sold) sit in the side panel, just below Dashboard.
function vehicleNav(items: WebNavItem[]): WebNavItem[] {
  const stock: WebNavItem = { href: '/(store)/stock', label: 'Stock', icon: 'cube' };
  const own: WebNavItem[] = [
    {
      href: '/(store)/rent',
      label: 'Rent & EMI',
      icon: 'car',
      heading: true,
      children: [
        { href: '/(store)/rent?tab=emi', label: 'EMI', icon: 'card' },
        { href: '/(store)/rent?tab=rent', label: 'Rent', icon: 'key' },
      ],
    },
    { href: '/(store)/inventory', label: 'Inventory', icon: 'layers' },
  ];
  const at = items.findIndex((item) => item.href.endsWith('/company-dashboard'));
  return [...items.slice(0, at + 1), ...own, ...items.slice(at + 1)].map((item) =>
    item.children ? { ...item, children: item.children.map((child) => (child.href.endsWith('/inventory') ? stock : child)) } : item
  );
}

// Sales and Purchase as the Finance page has them, taken from its list so label, icon and link never drift: each opens a
// new bill. The side panel leaves them out for most accounts - they are buttons on the Day Book. The list of sales and its
// totals are the Sales Report, so Sales here is only the form.
const SALE_AND_PURCHASE_NAV: WebNavItem[] = financeShortcuts('/(store)')
  .filter((s) => s.key === 'sales' || s.key === 'purchase')
  .map(({ href, label, icon }) => ({ href, label, icon }));

// Marketing: everything that brings customers in, as one group of the All In One Abroad account only (the way Auto Stock
// Manager groups it). It is a title over its pages - it opens the first, Leads, and only the page lights up.
const MARKETING_NAV: WebNavItem = {
  href: '/(store)/leads',
  label: 'Marketing',
  icon: 'megaphone',
  heading: true,
  children: [
    { href: '/(store)/leads', label: 'Leads', icon: 'people' },
    { href: '/(store)/crm', label: 'CRM', icon: 'heart' },
    { href: '/(store)/share', label: 'Share', icon: 'share-social' },
    { href: '/(store)/offers', label: 'Offers', icon: 'gift' },
    { href: '/(store)/visits', label: 'Visits', icon: 'eye' },
  ],
};

// The All In One Abroad account (the Luvkush login) has the whole side panel, with the shop's own pages right below the
// Dashboard instead of inside Finance: Stock and Inventory, then Sales, Purchase and Marketing. Everything else stays where it is.
// Stock and Inventory is taken from Finance's own list so its label and icon never drift.
function shopNav(items: WebNavItem[]): WebNavItem[] {
  const stock = items.flatMap((item) => item.children ?? []).find((child) => child.href.endsWith('/inventory'));
  if (!stock) return items;
  // Moved, not copied: on the phone's list Sales and Purchase are also Finance's children, so they leave it.
  const moved = new Set([stock.href, ...SALE_AND_PURCHASE_NAV.map((item) => item.href)]);
  const [dashboard, ...rest] = items;
  return [
    dashboard,
    stock,
    ...SALE_AND_PURCHASE_NAV,
    MARKETING_NAV,
    ...rest.map((item) => (item.children ? { ...item, children: item.children.filter((child) => !moved.has(child.href)) } : item)),
  ];
}

const HIDDEN: [string, string][] = [
  ['rent', 'Rent & EMI'],
  ['rent-entry', 'Rent'],
  ['emi-entry', 'EMI'],
  ['customers', 'Ledger'],
  ['customer/[id]', 'Ledger'],
  ['transactions', 'Statement'],
  ['leads', 'Leads'],
  ['crm', 'CRM'],
  ['share', 'Share'],
  ['offers', 'Offers'],
  ['visits', 'Visits'],
  // Stock and Inventory is one of Finance's pages now (side panel, and a tile on the Finance page on a phone). A vehicle
  // account has it as Inventory, and Stock (only what is in hand) in Finance - see vehicleNav.
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
  const profile = useAuthStore((state) => state.profile);
  const accountName = profile?.business_name?.trim() || profile?.full_name;
  const vehicles = sellsVehicles(accountName);
  const shop = isAllInOneAbroad(accountName);
  const [navItems, phoneNavItems] = useMemo(() => {
    const shape = (base: WebNavItem[]) => (shop ? shopNav(base) : vehicles ? vehicleNav(base) : base);
    return [shape(NAV_ITEMS), shape(PHONE_NAV_ITEMS)];
  }, [vehicles, shop]);
  const [menuOpen, setMenuOpen] = useState(false);
  const tabs = (
    <Tabs
      backBehavior="history"
      // Coming back to a page starts it fresh: nothing left open, nothing typed, the figures read again.
      screenLayout={freshScreenLayout}
      screenOptions={{
        header: ({ options }) => (
          <PortalHeaderBar
            title={options.title}
            onMenu={isWideWeb ? undefined : () => setMenuOpen(true)}
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
      {isWideWeb ? (
        <WebSidebarShell items={navItems} roleLabel="Company" profileHref="/(store)/profile">
          {tabs}
        </WebSidebarShell>
      ) : (
        <>
          {tabs}
          <MobileNavDrawer
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            items={phoneNavItems}
            roleLabel="Company"
            profileHref="/(store)/profile"
          />
        </>
      )}
    </RoleGuard>
  );
}
