// app/(store)/rent.tsx
import { FeatureGate } from '../../lib/components/FeatureGate';
import { RentScreen } from '../../lib/components/finance/RentScreen';

// Rent & EMI is one page with two tabs (see RentScreen): it opens for an organization with either feature on.
export default function StoreRent() {
  return (
    <FeatureGate feature={['finance.rent', 'finance.emi']}>
      <RentScreen basePath="/(store)" />
    </FeatureGate>
  );
}
