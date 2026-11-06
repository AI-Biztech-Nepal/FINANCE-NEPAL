// lib/components/FeatureGate.tsx
import type { PropsWithChildren } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFeatureStore } from '../features/useFeatures';
import { FEATURE_NAMES, type FinanceFeature } from '../features/resolve';

/**
 * Shows the screen only when the organization has the feature (or, given several, any one of them). Anyone who opens the
 * address of a switched-off screen gets a plain "not enabled" page instead, so hiding the menu item is not all there is.
 * The database refuses the writes too (see supabase/portal/*_finance_feature_guards.sql).
 */
export function FeatureGate({ feature, children }: PropsWithChildren<{ feature: FinanceFeature | FinanceFeature[] }>) {
  const keys = Array.isArray(feature) ? feature : [feature];
  const loaded = useFeatureStore((state) => state.loaded);
  const on = useFeatureStore((state) => keys.some((key) => state.flags[key]));

  if (!loaded) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator />
      </View>
    );
  }
  if (on) return <>{children}</>;

  const names = keys.map((key) => FEATURE_NAMES[key]).join(' / ');
  return (
    <View className="flex-1 items-center justify-center bg-white px-6">
      <View className="mb-4 h-14 w-14 items-center justify-center rounded-full bg-gray-100">
        <Ionicons name="lock-closed-outline" size={26} color="#6B7280" />
      </View>
      <Text className="mb-1 text-center text-lg font-semibold text-gray-900">{names} is not enabled for your organization</Text>
      <Text className="mb-5 max-w-md text-center text-sm text-gray-500">
        An owner or admin can switch it on under Settings, Features in the portal.
      </Text>
      <Pressable
        onPress={() => router.replace('/(store)/company-dashboard' as never)}
        accessibilityRole="button"
        className="rounded-xl bg-blue-700 px-5 py-3"
      >
        <Text className="text-sm font-semibold text-white">Go to Dashboard</Text>
      </Pressable>
    </View>
  );
}
