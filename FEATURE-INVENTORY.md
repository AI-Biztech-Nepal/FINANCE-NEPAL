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
