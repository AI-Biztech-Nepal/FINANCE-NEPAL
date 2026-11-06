// app/(store)/emi-entry.tsx
import { FeatureGate } from '../../lib/components/FeatureGate';
import { EmiEntryScreen } from '../../lib/components/finance/EmiEntryScreen';

export default function StoreEmiEntry() {
  return (
    <FeatureGate feature="finance.emi">
      <EmiEntryScreen basePath="/(store)" />
    </FeatureGate>
  );
}
