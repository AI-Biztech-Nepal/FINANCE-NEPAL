// lib/components/finance/SaleLeadFields.tsx
import { Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LEAD_SOURCES, sourceNeedsNote } from './leadKit';
import type { LeadSource } from '../../../types/database.types';

/** The "Lead" block of the Record Sale form (All In One Abroad): how this customer found the shop, and - for a referral
 * or "other" - who or where. Optional. When it is answered, saving the sale writes the buyer into the Leads page as
 * Converted (see recordLeadFromSale). Tapping the chosen source again clears it. */
export function SaleLeadFields({
  source,
  note,
  onSource,
  onNote,
  accent,
  framed,
}: {
  source: LeadSource | '';
  note: string;
  onSource: (source: LeadSource | '') => void;
  onNote: (note: string) => void;
  accent: string;
  /** Its own bordered card (the phone form), not a band across the bottom of the items table. */
  framed?: boolean;
}) {
  return (
    <View className={framed ? 'rounded-lg border border-gray-200 bg-white px-3 py-3' : 'border-t border-gray-200 bg-white px-5 py-4'}>
      <View className="mb-2.5 flex-row items-center" style={{ gap: 8 }}>
        <Ionicons name="megaphone-outline" size={16} color={accent} />
        <Text className="text-[13px] font-bold text-gray-900">Lead</Text>
        <Text className="text-xs text-gray-400">How did this customer find the shop? (optional)</Text>
      </View>
      <View className="flex-row flex-wrap" style={{ gap: 8 }}>
        {LEAD_SOURCES.map((s) => {
          const on = source === s.key;
          return (
            <Pressable
              key={s.key}
              onPress={() => onSource(on ? '' : s.key)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              className="flex-row items-center rounded-lg px-3 py-2"
              style={{ gap: 6, borderWidth: 1.5, borderColor: on ? accent : '#E5E7EB', backgroundColor: on ? s.bg : '#fff' }}
            >
              <Ionicons name={s.icon} size={15} color={on ? s.color : '#6B7280'} />
              <Text className="text-xs font-bold" style={{ color: on ? s.color : '#4B5563' }}>
                {s.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {sourceNeedsNote(source) && (
        <TextInput
          value={note}
          onChangeText={onNote}
          placeholder={source === 'referral' ? 'Referred by (name)' : 'Where from? e.g. signboard, Instagram'}
          placeholderTextColor="#9CA3AF"
          className="mt-2.5 rounded-lg bg-white px-3 py-2.5 text-sm text-gray-900"
          style={[{ borderWidth: 1, borderColor: '#D1D5DB' }, { outlineStyle: 'none' } as object]}
        />
      )}
    </View>
  );
}
