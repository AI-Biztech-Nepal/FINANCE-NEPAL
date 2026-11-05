// lib/components/finance/WebsiteListingFields.tsx
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, Text, TextInput, View } from 'react-native';
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

type IconName = keyof typeof Ionicons.glyphMap;

/** The shelves the website sorts its shop into. */
const CATEGORIES: { key: string; label: string; icon: IconName }[] = [
  { key: 'luggage', label: 'Luggage', icon: 'briefcase' },
  { key: 'kitchen', label: 'Kitchen', icon: 'restaurant' },
  { key: 'appliances', label: 'Home Appliances', icon: 'tv' },
];

const ACCENT = '#2563EB';
const READY = { bg: '#F0FDF4', ink: '#15803D' };
const WAITING = { bg: '#FFFBEB', ink: '#B45309' };
const DESCRIPTION_MAX = 255;

// The app draws every word with a capital at the start of each word (see titleCaseText.ts), which suits labels
// but not a sentence or a web address ("Allinoneabroad.Com"). Sentences here keep their own capitals.
const SENTENCE = { textTransform: 'none' } as const;

/** "a photo", "a photo and a shop section", "a photo, a shop section and a selling price". */
function listOf(words: string[]): string {
  return words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : words[0] ?? '';
}

function Label({ children, right }: { children: string; right?: React.ReactNode }) {
  return (
    <View className="mb-1.5 flex-row items-center justify-between">
      <Text className="text-[11px] font-bold tracking-wide text-gray-500">{children}</Text>
      {right}
    </View>
  );
}

/** The "Show on website" switch and, once it is on, what the shop needs: a photo, a shop section, an optional
 * before-discount price and a short description - with a line at the top saying whether the item is ready to
 * show. The photo goes up as soon as it is picked (or dropped on it, on the web). */
export function WebsiteListingFields({
  form,
  set,
  ownerId,
  sellingPrice,
}: {
  form: WebsiteForm;
  set: (key: keyof WebsiteForm) => (value: string) => void;
  /** The account's id - the photo goes in that account's own folder of the bucket. */
  ownerId: string;
  /** The selling price typed above, to tell whether the item can be listed and how big the discount is. */
  sellingPrice: number;
}) {
  const on = form.show_on_website === '1';
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [focus, setFocus] = useState<'original' | 'description' | null>(null);

  const gaps = [!form.image_url && 'a photo', !form.website_category && 'a shop section', !(sellingPrice > 0) && 'a selling price'].filter(
    (gap): gap is string => !!gap
  );
  const ready = gaps.length === 0;

  const original = Number(form.original_price);
  const percentOff = sellingPrice > 0 && original > sellingPrice ? Math.round((1 - sellingPrice / original) * 100) : 0;

  // Resizes, uploads to the account's own folder and puts the public link on the form.
  async function uploadPhoto(uri: string, width: number | undefined, mimeType?: string | null) {
    setUploading(true);
    try {
      const resized = await resizeImageForUpload(uri, width, 1000);
      // Resizing re-saves as JPEG; a small image comes back untouched and keeps its own type.
      const type = resized === uri ? mimeType ?? 'image/jpeg' : 'image/jpeg';
      const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
      const bytes = await fetch(resized).then((res) => res.arrayBuffer());
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
    await uploadPhoto(asset.uri, asset.width, asset.mimeType);
  }

  // On the web an image file can be dropped on the photo box. React Native has no drop events, so they are put on
  // the box's own element; the handler is read through a ref so it always uploads for this render.
  const dropZone = useRef<View>(null);
  const onDropFile = useRef<(file: File) => void>(() => {});
  onDropFile.current = (file: File) => {
    if (!file.type.startsWith('image/')) {
      showAlert('Not an image', 'Drop a JPG, PNG or WebP image.');
      return;
    }
    const url = URL.createObjectURL(file);
    const probe = new window.Image();
    probe.onload = () => void uploadPhoto(url, probe.naturalWidth, file.type);
    probe.onerror = () => showAlert('Could not read image', 'Try another image file.');
    probe.src = url;
  };
  useEffect(() => {
    if (Platform.OS !== 'web' || !on) return;
    const node = dropZone.current as unknown as HTMLElement | null;
    if (!node) return;
    const over = (e: DragEvent) => {
      e.preventDefault();
      setDragging(true);
    };
    const leave = () => setDragging(false);
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) onDropFile.current(file);
    };
    node.addEventListener('dragover', over);
    node.addEventListener('dragleave', leave);
    node.addEventListener('drop', drop);
    return () => {
      node.removeEventListener('dragover', over);
      node.removeEventListener('dragleave', leave);
      node.removeEventListener('drop', drop);
    };
  }, [on]);

  return (
    <View className="mb-3 overflow-hidden rounded-2xl border border-gray-200 bg-gray-50">
      <Pressable
        onPress={() => set('show_on_website')(on ? '' : '1')}
        accessibilityRole="switch"
        accessibilityState={{ checked: on }}
        accessibilityLabel="Show on website"
        className="flex-row items-center px-4 py-3.5"
        style={{ gap: 12 }}
      >
        <View className="items-center justify-center rounded-xl" style={{ width: 38, height: 38, backgroundColor: on ? '#DBEAFE' : '#E5E7EB' }}>
          <Ionicons name="globe-outline" size={20} color={on ? ACCENT : '#6B7280'} />
        </View>
        <View className="flex-1">
          <Text className="text-[15px] font-bold text-gray-900">Show on website</Text>
          <Text className="text-xs text-gray-500" style={SENTENCE}>
            Lists this item on allinoneabroad.com with its live stock.
          </Text>
        </View>
        <ToggleSwitch on={on} color={ACCENT} />
      </Pressable>

      {on && (
        <View className="border-t border-gray-200 px-4 pb-4 pt-3.5">
          <View className="mb-4 flex-row items-center rounded-lg px-3 py-2.5" style={{ gap: 8, backgroundColor: ready ? READY.bg : WAITING.bg }}>
            <Ionicons name={ready ? 'checkmark-circle' : 'alert-circle'} size={18} color={ready ? READY.ink : WAITING.ink} />
            <Text className="flex-1 text-xs font-semibold" style={[SENTENCE, { color: ready ? READY.ink : WAITING.ink }]}>
              {ready ? 'Ready - this item will show on the website.' : `Not on the website yet. Add ${listOf(gaps)}.`}
            </Text>
          </View>

          <Label>Photo</Label>
          <View
            ref={dropZone}
            className="mb-4 flex-row items-center rounded-xl bg-white p-3"
            style={{
              gap: 14,
              borderWidth: 1.5,
              borderStyle: form.image_url ? 'solid' : 'dashed',
              borderColor: dragging ? ACCENT : form.image_url ? '#E5E7EB' : '#D1D5DB',
              backgroundColor: dragging ? '#EFF6FF' : '#fff',
            }}
          >
            <Pressable
              onPress={pickPhoto}
              disabled={uploading}
              accessibilityLabel={form.image_url ? 'Change photo' : 'Add photo'}
              className="items-center justify-center overflow-hidden rounded-xl bg-gray-100"
              style={{ width: 88, height: 88 }}
            >
              {form.image_url ? (
                <Image source={{ uri: form.image_url }} style={{ width: 88, height: 88 }} resizeMode="cover" />
              ) : (
                <Ionicons name="camera-outline" size={30} color="#9CA3AF" />
              )}
              {uploading && (
                <View className="absolute inset-0 items-center justify-center" style={{ backgroundColor: 'rgba(255,255,255,0.75)' }}>
                  <ActivityIndicator color={ACCENT} />
                </View>
              )}
            </Pressable>
            <View className="flex-1" style={{ gap: 4 }}>
              <Text className="text-sm font-bold text-gray-900" style={SENTENCE}>
                {uploading ? 'Uploading...' : form.image_url ? 'Photo added' : 'Add a photo'}
              </Text>
              <Text className="text-xs leading-[17px] text-gray-500" style={SENTENCE}>
                {Platform.OS === 'web' ? 'Drop an image here or choose one. ' : ''}JPG, PNG or WebP. A clear, square photo looks best.
              </Text>
              <View className="mt-1 flex-row" style={{ gap: 16 }}>
                <Pressable onPress={pickPhoto} disabled={uploading} hitSlop={6}>
                  <Text className="text-sm font-bold" style={[SENTENCE, { color: ACCENT }]}>
                    {form.image_url ? 'Change photo' : 'Choose photo'}
                  </Text>
                </Pressable>
                {!!form.image_url && !uploading && (
                  <Pressable onPress={() => set('image_url')('')} hitSlop={6}>
                    <Text className="text-sm font-bold text-red-600" style={SENTENCE}>
                      Remove
                    </Text>
                  </Pressable>
                )}
              </View>
            </View>
          </View>

          <Label>Shop section</Label>
          <View className="mb-4 flex-row" style={{ gap: 8 }}>
            {CATEGORIES.map((c) => {
              const picked = form.website_category === c.key;
              return (
                <Pressable
                  key={c.key}
                  onPress={() => set('website_category')(c.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: picked }}
                  className="flex-1 items-center justify-center rounded-xl px-2 py-3"
                  style={{ gap: 6, borderWidth: 1.5, borderColor: picked ? ACCENT : '#E5E7EB', backgroundColor: picked ? '#EFF6FF' : '#fff' }}
                >
                  <Ionicons name={(picked ? c.icon : `${c.icon}-outline`) as IconName} size={22} color={picked ? ACCENT : '#6B7280'} />
                  <Text className="text-center text-xs font-bold" style={{ color: picked ? ACCENT : '#4B5563' }}>
                    {c.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Label
            right={
              percentOff > 0 ? (
                <View className="rounded-full px-2 py-0.5" style={{ backgroundColor: READY.bg }}>
                  <Text className="text-[11px] font-bold" style={{ color: READY.ink }}>
                    {percentOff}% off
                  </Text>
                </View>
              ) : undefined
            }
          >
            Price before discount (optional)
          </Label>
          <View
            className="mb-1.5 flex-row items-center rounded-lg bg-white px-3"
            style={{ borderWidth: 1, borderColor: focus === 'original' ? ACCENT : '#D1D5DB' }}
          >
            <Text className="mr-2 text-sm font-semibold text-gray-400">Rs</Text>
            <TextInput
              value={form.original_price}
              onChangeText={set('original_price')}
              onFocus={() => setFocus('original')}
              onBlur={() => setFocus(null)}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor="#9CA3AF"
              className="flex-1 py-2.5 text-sm text-gray-900"
              style={{ outlineStyle: 'none' } as object}
            />
          </View>
          <Text className="mb-4 text-[11.5px] leading-4 text-gray-400" style={SENTENCE}>
            Shown struck through beside the selling price, only when it is higher.
          </Text>

          <Label
            right={
              <Text className="text-[11px] text-gray-400" style={SENTENCE}>
                {form.description.length}/{DESCRIPTION_MAX}
              </Text>
            }
          >
            Description (optional)
          </Label>
          <TextInput
            value={form.description}
            onChangeText={set('description')}
            onFocus={() => setFocus('description')}
            onBlur={() => setFocus(null)}
            multiline
            maxLength={DESCRIPTION_MAX}
            placeholder="e.g. 3-piece set, TSA lock, 360 spinner wheels"
            placeholderTextColor="#9CA3AF"
            className="rounded-lg bg-white px-3 py-2.5 text-sm text-gray-900"
            style={[{ minHeight: 72, textAlignVertical: 'top', borderWidth: 1, borderColor: focus === 'description' ? ACCENT : '#D1D5DB' }, { outlineStyle: 'none' } as object]}
          />
        </View>
      )}
    </View>
  );
}
