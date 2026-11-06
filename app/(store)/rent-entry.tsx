// app/(store)/rent-entry.tsx
import { FeatureGate } from '../../lib/components/FeatureGate';
import { RentEntryScreen } from '../../lib/components/finance/RentEntryScreen';

export default function StoreRentEntry() {
  return (
    <FeatureGate feature="finance.rent">
      <RentEntryScreen basePath="/(store)" />
    </FeatureGate>
  );
}
