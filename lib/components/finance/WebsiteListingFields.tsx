// lib/components/finance/WebsiteListingFields.tsx
import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../../supabase';
import { resizeImageForUpload } from '../../utils/resizeImage';
import { showAlert, getErrorMessage } from '../../utils/alert';
import { ToggleSwitch } from '../ToggleSwitch';

/** The part of the product form that decides how an item appears on the company's website (see
 * supabase/migrations/0028_website_listing.sql). All text, like the rest of the form. */
export interface WebsiteForm {
  /** '1' when the item is listed, '' when not. */
  show_on_website: string;
  website_category: string;
  /** Public link to the photo in the product-photos bucket. */
  image_url: string;
  description: string;
  original_price: string;
}

export const EMPTY_WEBSITE_FORM: WebsiteForm = {
  show_on_website: '',
  website_category: '',
  image_url: '',
  description: '',
  original_price: '',
};

/** The shelves the website sorts its shop into. */
const CATEGORIES = [
  { key: 'luggage', label: 'Luggage' },
  { key: 'kitchen', label: 'Kitchen' },
  { key: 'appliances', label: 'Home Appliances' },
];

const ACCENT = '#2563EB';

/** The "Show on website" switch and, once it is on, what the shop needs: a photo, a category, an optional
 * before-discount price and a short description. The photo goes up as soon as it is picked. */
export function WebsiteListingFields({
  form,
  set,
  ownerId,
}: {
  form: WebsiteForm;
  set: (key: keyof WebsiteForm) => (value: string) => void;
  /** The account's id - the photo goes in that account's own folder of the bucket. */
  ownerId: string;
}) {
  const on = form.show_on_website === '1';
  const [uploading, setUploading] = useState(false);

  async function pickPhoto() {
    if (uploading) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showAlert('Photo access needed', 'Allow photo library access to add the item photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setUploading(true);
    try {
      const uri = await resizeImageForUpload(asset.uri, asset.width, 1000);
      // Resizing re-saves as JPEG; a small image comes back untouched and keeps its own type.
      const type = uri === asset.uri ? asset.mimeType ?? 'image/jpeg' : 'image/jpeg';
      const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
      const bytes = await fetch(uri).then((res) => res.arrayBuffer());
      const path = `${ownerId}/${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from('product-photos').upload(path, bytes, { contentType: type });
      if (error) throw error;
      set('image_url')(supabase.storage.from('product-photos').getPublicUrl(path).data.publicUrl);
    } catch (err) {
      showAlert('Could not upload photo', getErrorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <View className="mb-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
      <Pressable
        onPress={() => set('show_on_website')(on ? '' : '1')}
        accessibilityRole="switch"
        accessibilityState={{ checked: on }}
        accessibilityLabel="Show on website"
        className="flex-row items-center"
        style={{ gap: 10 }}
      >
        <Ionicons name="globe-outline" size={18} color={on ? ACCENT : '#6B7280'} />
        <View className="flex-1">
          <Text className="text-sm font-bold text-gray-900">Show on website</Text>
          <Text className="text-xs text-gray-500">The shop on allinoneabroad.com lists this item with its live stock.</Text>
        </View>
        <ToggleSwitch on={on} color={ACCENT} />
      </Pressable>

      {on && (
        <View className="mt-3 border-t border-gray-200 pt-3">
          <Text className="mb-1 text-xs font-semibold text-gray-500">Photo</Text>
          <View className="mb-3 flex-row items-center" style={{ gap: 12 }}>
            {form.image_url ? (
              <Image source={{ uri: form.image_url }} style={{ width: 72, height: 72, borderRadius: 10, backgroundColor: '#E5E7EB' }} resizeMode="cover" />
            ) : (
              <Pressable
                onPress={pickPhoto}
                disabled={uploading}
                accessibilityLabel="Add photo"
                className="items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white"
                style={{ width: 72, height: 72 }}
              >
                {uploading ? <ActivityIndicator color={ACCENT} /> : <Ionicons name="camera-outline" size={24} color="#9CA3AF" />}
              </Pressable>
            )}
            {!!form.image_url && (
              <View style={{ gap: 6 }}>
                <Pressable onPress={pickPhoto} disabled={uploading} hitSlop={6}>
                  <Text className="text-sm font-bold" style={{ color: ACCENT }}>{uploading ? 'Uploading...' : 'Change photo'}</Text>
                </Pressable>
                <Pressable onPress={() => set('image_url')('')} hitSlop={6}>
                  <Text className="text-sm font-bold text-red-600">Remove</Text>
                </Pressable>
              </View>
            )}
            {!form.image_url && !uploading && <Text className="flex-1 text-xs text-gray-500">The shop needs a photo to list the item.</Text>}
          </View>

          <Text className="mb-1 text-xs font-semibold text-gray-500">Shop section</Text>
          <View className="mb-3 flex-row flex-wrap" style={{ gap: 8 }}>
            {CATEGORIES.map((c) => {
              const picked = form.website_category === c.key;
              return (
                <Pressable
                  key={c.key}
                  onPress={() => set('website_category')(c.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: picked }}
                  className="rounded-lg border px-3 py-2"
                  style={{ borderColor: picked ? ACCENT : '#D1D5DB', backgroundColor: picked ? '#EFF6FF' : '#fff' }}
                >
                  <Text className="text-sm font-semibold" style={{ color: picked ? ACCENT : '#4B5563' }}>{c.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text className="mb-1 text-xs font-semibold text-gray-500">Price before discount (optional, shown struck through)</Text>
          <TextInput
            value={form.original_price}
            onChangeText={set('original_price')}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor="#9CA3AF"
            className="mb-3 rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900"
            style={{ outlineStyle: 'none' } as object}
          />

          <Text className="mb-1 text-xs font-semibold text-gray-500">Description (optional, up to 255 characters)</Text>
          <TextInput
            value={form.description}
            onChangeText={set('description')}
            multiline
            maxLength={255}
            placeholder="e.g. 3-piece set, TSA lock, 360 spinner wheels"
            placeholderTextColor="#9CA3AF"
            className="rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900"
            style={[{ minHeight: 64, textAlignVertical: 'top' }, { outlineStyle: 'none' } as object]}
          />
        </View>
      )}
    </View>
  );
}
