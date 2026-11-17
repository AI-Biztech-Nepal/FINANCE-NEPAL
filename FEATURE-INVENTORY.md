# Finance feature inventory (Step 0) and how the flags are wired

For the `portal-supabase` branch: Finance running on the portal database (`finance` schema, `owner_id` holds the
organization id). The standalone version on `main` is not touched by any of this. (`main` still has the first
draft of this file, commit 8c9aa35, written before the portal schema was read.)

## The features

Only three things in Finance on this branch can be switched off without breaking the rest of it.

| Key | Name | Needs | On by default | Tables / functions / screens it touches |
|---|---|---|---|---|
| `finance.vehicles` | Vehicle accounts | | no | **Display only, no table.** Names the vehicle on bills, ledgers and reports, adds Model No. to purchase bills, splits Stock from Inventory. Was `finance.org_settings.sells_vehicles` plus a business-name match. Read by `useFeature` in `_layout.tsx` (side panel), `CustomerDetailScreen`, `CustomersListScreen`, `DayBookScreen`, `InventoryScreen`, `PartyBalancesScreen`, `QuickPaymentScreen`, `TotalsReportScreen`, `TransactionsBook`, `TransactionsScreen`. |
| `finance.rent` | Rent | | no | `finance.rentals`; `finance.sync_rental_wages()`, `sync_rental_wages_for(uuid)`, `rental_wage_rows(uuid)`, which write `finance.customer_ledger_entries` (`source_type = 'rental_wage'`); screens `rent` (Rent tab) and `rent-entry`; `useRentalWageSync`; rent income in the Profit & Loss (`ReportScreen`). |
| `finance.emi` | EMI | | no | `finance.emi_plans`; screens `rent` (EMI tab) and `emi-entry`; `EmiPanel`, `EmiEntryScreen`, `lib/utils/emi.ts`. `supabase/emi_add_deeva_stock.sql` is a Deeva-only one-off that should be retired. |

- **No `requires` between them.** The earlier draft guessed `rent` and `emi` need `vehicles`. They do not: neither
  screen reads the vehicles flag. Today's side panel shows all three to the same accounts, which the backfill preserves.
- **`finance.jageer` is not here.** It lives in the portal database (`public.finance_apply_jageer_*`), so it goes in the
  portal's own list. `finance.sales` from the brief's examples is core, not a feature.
- The machine-readable version (catalogue rows and the per-org backfill) is
  [supabase/feature-backfill/finance.json](supabase/feature-backfill/finance.json).

### Not on this branch

Leads, CRM, Share, Offers, Visits, website listing, and the "no service lines" shop variant exist only on `main`;
`portal-supabase` was cut before them and the portal database has none of their tables. They will need flags when they
are ported (`finance.website`, `finance.leads`, `finance.crm`, `finance.share`, `finance.offers`, `finance.visits`,
`finance.bill_services`; the first draft of this file has the detail). Two things to carry over then: the anonymous
functions (`website_products`, `offer_prizes_public`, `spin_wheel`, `record_visit`) are `security definer` and bypass
RLS, so each needs the `core.feature_on` check inside its body; and the hard-coded `allinoneabroad.com` in
`ShareScreen` belongs in that feature's `config`.

### Core, left out on purpose

Day Book, Ledger, Statement, Sale / Purchase / Received / Paid / Expense entries, Bank Accounts, Reports, Party types,
Company Details, Dashboard. Stock and Inventory is core too: a trigger moves stock on every bill. Statement import,
bill scan, Journal Voucher, Contra and Quick Payment can be separated but no second customer needs them absent, so no
flag (rule 5).

## Lessons from the Finance inventory, and what this branch does about each

1. **Backfill per org: what each account sees today, not everything ON.** Rent, EMI and the vehicle screens are
   visible to vehicle accounts only. `finance.json` lists Deeva by slug and adds queries for the rest: orgs with
   `org_settings.sells_vehicles`, orgs whose name reads "Deeva Auto", and any org that already has rentals or EMI plans.
   Everyone else gets no row, which reads as `default_on = false`. Run the queries as a dry run first: an org with rentals
   but no vehicle flag is the case to look at.
2. **Hiding a menu item was the only gate.** `/rent`, `/rent-entry` and `/emi-entry` opened by address for any account,
   and the owner policies let them write. Now: the database refuses writes to `rentals` and `emi_plans` when the flag is
   off, and the three routes show a "not enabled for your organization" page (`FeatureGate`).
3. **RLS does not cover `security definer` functions.** The flag check is inside `sync_rental_wages_for`. While in
   there: the portal's blanket `grant execute ... to authenticated` let any signed-in user run it, or read
   `rental_wage_rows`, for any org id. Both are now service-only.
4. **Off pauses, it never empties.** The sync returns before touching a ledger when Rent is off, where it used to
   delete every `rental_wage` line it did not rebuild. Reads stay open, so the Profit & Loss and ledgers do not change
   when someone hides a screen. Switching back on catches up. Tested, including the suspended-service case.

## How it is enforced

| Where | What |
|---|---|
| Database | [supabase/portal/20261107000000_finance_feature_guards.sql](supabase/portal/20261107000000_finance_feature_guards.sql): write policies on `rentals` and `emi_plans`, the flag check inside the sync, execute grants. Refuses to run if `core.feature_on` does not exist. |
| API | There is no separate API: the app calls PostgREST, so the database is the API. A refused insert comes back as a row-level-security error; an update or delete simply matches no rows. No `require_feature` to add. |
| UI | `lib/features/` loads `core.org_features(p_org)` once per session, before the org is published (`useAuth.ts`). `useFeature(key)` hides navigation, tabs and fields; `FeatureGate` guards hidden URLs; the side panel waits for the flags so it never flashes. |

**Order for the portal PR:** the portal's feature migration, then load `finance.json` (catalogue and backfill), then the
guards migration, then deploy the app. The app is safe to deploy first: if `core.org_features` is not there it falls back
to the old per-account switch, so nobody's screens change (see `lib/features/useFeatures.ts`; delete the fallback once the
portal is live).

## Tests

```
node --test lib/features/resolve.test.mjs                         # flag logic, and finance.json agrees with the app
node --test supabase/tests/finance_feature_guards.test.mjs        # needs @electric-sql/pglite; meant to move to the portal repo
```

The database test starts from the portal's current definitions, applies the migration, and covers: flag off refuses,
flag on works, missing flag falls back to the default, the sync pauses without deleting and catches up, a suspended
service pauses it, other orgs are untouched, and the backfill queries pick the right orgs. The flag check in the sync and the one
in the write policies were each removed in turn to confirm the tests fail without them. Not run: the app itself, and anything against the real portal database.

## Decisions and known edges

- **Reads stay open while a feature is off.** Needed so the books do not change; the one-line alternative is to guard
  `select` too, at the cost of rent income dropping out of the Profit & Loss.
- **Renaming a stock item while Rent is off does not rename its rentals** (the write is refused, silently). They keep the
  old name until it is renamed again with Rent on.
- **`sync_rental_wages()` was a no-op for staff and multi-org owners.** It passed `auth.uid()` (a user id) where every
  `owner_id` is an org id. It now uses the active org. For one-person accounts, where the two are equal, nothing changes;
  for others the first sync after deploy adds the rent days missing since the move.
- **Nothing in the portal database schedules the sync** (no cron job, and no trigger on `rentals`, as far as
  `finance_init` shows). The comments in `useRentalWageSync` that say the database does it nightly describe the old project.
- **Branding stays by name.** The DEEVA title, green band and logos still use the business-name match
  (`isDeevaBrand`); colours and logos are not features and need a home in organization settings.
- **Assumed:** `core.org_features(p_org)` returns each feature's effective `enabled` (requires and live service already
  applied). If it returns raw rows, the app must ask `feature_on` per key.

---

<!-- The inventory below came from main (standalone Finance) and was merged in. -->

# Finance feature inventory (Step 0)

Step 0 of `FEATURE-FLAGS.md`, filled in for **this repo** (the standalone Finance app: Expo front end, its own
Supabase project, `owner_id` per user). Everything below was read from the code; nothing is guessed except where
a cell says `?`.

## Read this first: this repo is not the one the brief describes

The brief's contract assumes things this repo does not have:

| The brief assumes | This repo has |
|---|---|
| `core.organizations`, `core.services`, `core.has_service_access` | None. The tenant is a user: every row has `owner_id`, resolved by `finance_current_owner()` (= `auth.uid()`, "Model A" in `0001_finance.sql`). |
| `finance.org_settings.sells_vehicles` | No such column. "Sells vehicles" is a regex on the business name: `sellsVehicles()` in `lib/utils/accountFeatures.ts`. |
| `public.finance_apply_jageer_*` (Jageer sync) | Not here. Two migrations (0024, 0025) say "synced from Jageer Nepal"; that is all. So there is **no `finance.jageer` feature in this repo**. |
| A Python API with `require_service` / `require_feature` | None. The app talks to Supabase directly. The only server code is two edge functions (`scan-bill`, `voice-command`). |
| Finance in the Portal's database | `README.md`: "its own Supabase project and its own books". `core.feature_on(...)` cannot be called from a policy here. |

`0001_finance.sql` already routes ownership through one function so it can become a company id later (Model B).
That seam is the natural place to join `core`, but only once Finance lives in the Portal's database.

## The features

"Today" is who sees it now. **The backfill for this repo must copy "Today", not "all ON"** (see finding 1).
"Needs" are real code dependencies, checked by following imports and table reads.

| Key | Name | Needs | Today (backfill value) | Tables / functions / screens it touches |
|---|---|---|---|---|
| `finance.vehicles` | Vehicle accounts | | Off. On only where the business name matches `\bdee?va\s+auto\b` (Deeva Auto Enterprises) | **No table; display only.** `sellsVehicles()` in `_layout.tsx` (side panel: Rent & EMI, Inventory vs Stock), `CustomerDetailScreen`, `CustomersListScreen`, `DayBookScreen`, `InventoryScreen`, `PartyBalancesScreen`, `QuickPaymentScreen`, `TotalsReportScreen`, `TransactionsBook`, `TransactionsScreen` (model on Purchase). |
| `finance.rent` | Vehicle rental and driver wages | `finance.vehicles` ? | Off in the side panel for everyone but vehicle accounts. **But `/rent` and `/rent-entry` open by URL for any account.** | `rentals` (0009, 0015, 0016, 0018, 0020); `rent`, `rent-entry`; `RentScreen` (Rent tab), `RentEntryScreen`, `lib/utils/rental.ts`; `useRentalWageSync` (mounted in `RentScreen`, `CustomersListScreen`, `CustomerDetailScreen`); `rental_wage_rows()`, `sync_rental_wages_for()`, trigger on `rentals`, **pg_cron job `rental-wages`** writing `vendor_ledger_entries` rows with `source_type = 'rental_wage'`; `ReportScreen` (rent income in the Profit & Loss). |
| `finance.emi` | EMI and instalments | `finance.vehicles` ? | Same as rent: nav for vehicle accounts only, URL open to all. (The brief guessed `finance.sales`; Sales is core, so that is not a flag.) | `emi_plans` (0019, 0021, 0023, 0026, 0027); `emi-entry`; `EmiEntryScreen`, `EmiPanel`, `RentScreen` (EMI tab), `lib/utils/emi.ts`. |
| `finance.bill_services` | Service lines on Sale and Purchase bills | | On for everyone **except** All In One Abroad (`!shop` in `TransactionsScreen`, two places) | `business_transactions.installation_charge`, `.service_charges` (0024); `ServiceChargesTable`; `ReportScreen` (services income / expense in the Profit & Loss). |
| `finance.website` | Items listed on the company website | | Off. On only for All In One Abroad (`isAllInOneAbroad()` regex) | `products.show_on_website`, `.website_category`, `.image_url`, `.description`, `.original_price` and the `product-photos` bucket (0028); `website_products(uuid)` (**anon**); `WebsiteListingFields`, `InventoryScreen`. |
| `finance.leads` | Leads | | Off. On only for All In One Abroad | `leads` (0029); `leads`; `LeadsScreen`; the Lead block on the Sale form (`SaleLeadFields`, `recordLead`, `TransactionsScreen` ~1341, `shop && type === 'sale'`). |
| `finance.crm` | CRM | `finance.leads` | Off. On only for All In One Abroad | `crm`; `CrmScreen`, `crmKit`, `CustomerProfile`. Reads `leads` and `customers`; no table of its own. |
| `finance.share` | Share (product captions) | `finance.website` ? | Off. On only for All In One Abroad | `share`; `ShareScreen`. Reads `products`. **`const SITE = 'allinoneabroad.com'` is hard-coded**: it belongs in this feature's `config`. |
| `finance.offers` | Offers (prize wheel) | `finance.website` | Off. On only for All In One Abroad | `offer_prizes`, `offer_spins` (0030); `offer_prizes_public()`, `spin_wheel()` (**anon**); `offers`; `OffersScreen`. Only import from leads is the `dayLabel` date helper. |
| `finance.visits` | Website visits | `finance.website` | Off. On only for All In One Abroad | `site_visits` (0030; `view_id`, `seconds` in 0031); `record_visit()` (**anon**, called again by `website/visit-tracker.js` as the visitor stays), `visits_summary()`, `visits_list()` (0031); `visits`; `VisitsScreen`, `lib/utils/visitTime.ts`. |

`?` = the screen reads the other feature's data (vehicle names from stock) but could work without it. Confirm with
the owner of the vehicle accounts before writing `requires`.

### Branding is not a feature

The same name checks also choose the DEEVA title, the green dashboard banner and the built-in logos
(`bannerColors`, `builtInLogo*`, `WebSidebarShell`, G&G). Colours and logos are not `finance.*` flags. They need a
home in organization settings, outside this brief. Until then, `finance.vehicles` must not be derived from branding or the other way round.

## Core (cannot be switched off without breaking Finance)

Day Book, Ledger (customers and vendors), Statement, Sale / Purchase / Received / Paid / Expense entries, Bank
Accounts and balances, Reports (sales, purchase, expense, receivable, payable, balance sheet, Profit & Loss), Party
types, Company Details, Dashboard. **Stock and Inventory is core too:** a DB trigger (`apply_bill_stock`, 0002)
moves stock on every Sale and Purchase bill, so it cannot be hidden without making that trigger flag-aware, and no
customer has asked for it absent.

## Separable, but not flagged yet (rule 5: no second customer asks)

Statement import (`import-statement`, `statement_imports`), bill scan (`scan-bill` edge function, Gemini key), Journal
Voucher (`voucher`), Contra (`contra`, `account_transfers`), Quick Payment (`quick-payment`). `useVoiceCommand` and
`financeVoiceActions` are imported by no screen, so voice is dead code today, not a feature. Bill scan is the one to
watch: it costs money per use.

## Findings that change the plan

1. **"Backfill everything ON" would change the app for most accounts.** Rent & EMI, vehicle columns, Marketing and the
   website listing are visible to one account each today. Turning them ON for every existing org breaks the brief's own
   "existing orgs must see no change". Backfill from what each account sees now: Deeva gets `vehicles`, `rent`, `emi`
   and `bill_services`; All In One Abroad gets `website`, `leads`, `crm`, `share`, `offers`, `visits` and no
   `bill_services`; every other account gets `bill_services` only. (The brief already does this for `vehicles`; it
   applies to the rest here.)
2. **Today's gating is navigation only.** Hidden screens are `href: null` tabs, so any account can open `/rent`,
   `/leads`, `/offers` by URL, and the owner-only RLS on those tables lets them write rows.
3. **RLS will not cover the anonymous functions.** `website_products`, `offer_prizes_public`, `spin_wheel` and
   `record_visit` are `security definer`, granted to `anon`, and take any `p_owner` uuid. Each needs the `feature_on`
   check inside the function body.
4. **Switching Rent off must stop the sync, not empty it.** `sync_rental_wages_for()` deletes every wage line that is
   not in `rental_wage_rows()`. A flag that makes that view return nothing would delete the ledger lines. The nightly
   job and `useRentalWageSync` should skip while the flag is off, and catch up when it is back on.
5. **Rent & EMI is one screen** (`RentScreen` has both tabs). Rent off with EMI on needs the tabs to show separately.
6. **Books must not change when a feature is hidden.** Rent income stays in the Profit & Loss and existing
   `rental_wage` lines stay on ledgers (read-only) while `finance.rent` is off. Their text says "change it on the Rent &
   EMI page", which would be a dead end, so it needs a flag-off wording.
7. **Per-customer leftovers to retire with the flags:** `supabase/emi_add_deeva_stock.sql` and the `SITE` constant.
   `leadKit.dayLabel` should move to a shared util so Offers does not import from the leads feature.
8. **`org_id` does not exist here.** The flag table is keyed by org; this repo keys by `owner_id`. Under Model A that is
   a user, not the organization the Portal means.

## Not started, and what blocks it

The database guards, API decorators and UI loader from the brief need `core.features`, `core.org_features` and
`core.feature_on` to exist where this app's data lives. They do not, so nothing was built that calls them. Two
answers unblock it:

1. **Is this repo the Finance the brief means?** If the brief's Finance is the Portal-integrated one (with
   `finance.org_settings`), these rows go into that repo's PR instead, and this file is the checklist for it.
2. **If it is this repo, how does it join the Portal?** Either move its data into the Portal's database (Model B,
   `owner_id` becomes the organization; the brief calls data moves out of scope), or keep a separate database and give
   it a local copy of the same two tables. The second breaks "the Portal owns the data".
