// lib/components/finance/SaleLeadFields.tsx
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LEAD_SOURCES } from './leadKit';
import type { LeadSource } from '../../../types/database.types';

/** A saved party - a customer or a vendor, they share one list - that can be named as the one who referred. */
export interface ReferrerOption {
  id: string;
  name: string;
  phone: string | null;
}

const INPUT = { borderWidth: 1, borderColor: '#D1D5DB' };

/** The "Lead" block of the Record Sale form (All In One Abroad): how this customer found the shop. Optional. When it is
 * answered, saving the sale writes the buyer into the Leads page as Converted (see recordLeadFromSale). Tapping the
 * chosen source again clears it. A Referral lists the saved customers and vendors to pick from as you type; a name that
 * is not saved can still be typed. "Other" asks where else, in a few words. */
export function SaleLeadFields({
  source,
  note,
  onSource,
  onNote,
  accent,
  framed,
  parties,
}: {
  source: LeadSource | '';
  note: string;
  onSource: (source: LeadSource | '') => void;
  onNote: (note: string) => void;
  accent: string;
  /** Its own bordered card (the phone form), not a band across the bottom of the items table. */
  framed?: boolean;
  /** Every saved customer and vendor except the buyer, for a Referral to pick from. */
  parties: ReferrerOption[];
}) {
  const q = note.trim().toLowerCase();
  const picked = source === 'referral' && parties.some((p) => p.name.trim().toLowerCase() === q);
  const matches =
    source === 'referral' && !picked
      ? parties.filter((p) => !q || p.name.toLowerCase().includes(q) || (p.phone ?? '').replace(/\D/g, '').includes(q.replace(/\D/g, '') || '\u0000')).slice(0, 30)
      : [];

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

      {source === 'other' && (
        <TextInput
          value={note}
          onChangeText={onNote}
          placeholder="Where from? e.g. signboard, Instagram"
          placeholderTextColor="#9CA3AF"
          className="mt-2.5 rounded-lg bg-white px-3 py-2.5 text-sm text-gray-900"
          style={[INPUT, { outlineStyle: 'none' } as object]}
        />
      )}

      {source === 'referral' && (
        <View className="mt-2.5">
          <View className="flex-row items-center rounded-lg bg-white px-3" style={[INPUT, { gap: 8 }]}>
            <Ionicons name={picked ? 'person-circle' : 'search'} size={16} color={picked ? '#15803D' : '#9CA3AF'} />
            <TextInput
              value={note}
              onChangeText={onNote}
              placeholder="Search a customer or vendor, or type a name"
              placeholderTextColor="#9CA3AF"
              autoComplete="off"
              spellCheck={false}
              className="flex-1 py-2.5 text-sm text-gray-900"
              style={{ outlineStyle: 'none' } as object}
            />
            {note.length > 0 && (
              <Pressable onPress={() => onNote('')} hitSlop={8} accessibilityLabel="Clear referrer">
                <Ionicons name="close-circle" size={16} color="#9CA3AF" />
              </Pressable>
            )}
          </View>

          {picked ? (
            <Text className="mt-1.5 text-xs font-semibold text-green-700">Referred by a saved party.</Text>
          ) : matches.length > 0 ? (
            <View className="mt-1.5 overflow-hidden rounded-lg border border-gray-200 bg-white">
              <ScrollView style={{ maxHeight: 190 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                {matches.map((p, i) => (
                  <Pressable
                    key={p.id}
                    onPress={() => onNote(p.name.trim())}
                    className="flex-row items-center px-3 py-2.5"
                    style={(state) => ({
                      gap: 10,
                      backgroundColor: (state as { hovered?: boolean }).hovered || state.pressed ? '#F9FAFB' : '#FFFFFF',
                      borderTopWidth: i === 0 ? 0 : 1,
                      borderTopColor: '#F3F4F6',
                    })}
                  >
                    <Ionicons name="person-circle-outline" size={20} color="#9CA3AF" />
                    <Text className="flex-1 text-sm font-semibold text-gray-900" numberOfLines={1}>
                      {p.name}
                    </Text>
                    {!!p.phone && (
                      <Text className="text-xs text-gray-400" numberOfLines={1}>
                        {p.phone}
                      </Text>
                    )}
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          ) : (
            <Text className="mt-1.5 text-xs text-gray-400">
              {q ? 'Not one of your saved parties - the name you typed is kept.' : 'No saved customers or vendors to pick from yet - type a name.'}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}
