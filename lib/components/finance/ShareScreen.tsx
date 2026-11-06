// lib/components/finance/ShareScreen.tsx
//
// Share (Marketing): pick a product and get a ready caption for a social post - in a style (Facebook sale, short, detailed,
// friendly) and a language (English, Nepali, mixed) - then copy it, send it by WhatsApp, or open the phone's share sheet.
// The caption is filled from the product (name, price, discount, description, stock) and the company's details.
import { useMemo, useState } from 'react';
import { ActivityIndicator, Image, Linking, Modal, Platform, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../hooks/useAuth';
import { useSupabaseQuery } from '../../hooks/useSupabase';
import { BookPage, ToolbarSearch, money, useBookLayout } from './BookKit';
import { showAlert } from '../../utils/alert';
import type { Product } from '../../../types/database.types';

const BLUE = '#2563EB';
const SITE = 'allinoneabroad.com';

type Style = 'facebook' | 'short' | 'detailed' | 'friendly';
type Lang = 'english' | 'mixed' | 'nepali';

const STYLES: { key: Style; label: string }[] = [
  { key: 'facebook', label: 'Facebook sale post' },
  { key: 'short', label: 'Short' },
  { key: 'detailed', label: 'Detailed' },
  { key: 'friendly', label: 'Friendly' },
];
const LANGS: { key: Lang; label: string }[] = [
  { key: 'english', label: 'English' },
  { key: 'mixed', label: 'Nepali + English' },
  { key: 'nepali', label: 'नेपाली' },
];

// The words a caption is made of, per language.
const WORDS: Record<Lang, { hook: string; looking: (n: string) => string; price: string; was: string; call: string; visit: string; delivery: string; inStock: string; few: (n: number) => string; ask: string; item: string; about: string; avail: string; website: string }> = {
  english: { hook: 'New arrival', looking: (n) => `Looking for ${n}? We have it!`, price: 'Price', was: 'was', call: 'Call / WhatsApp', visit: 'Visit us', delivery: 'Delivery available', inStock: 'In stock', few: (n) => `Only ${n} left`, ask: 'Ask for availability', item: 'Item', about: 'About', avail: 'Availability', website: 'Order online' },
  mixed: { hook: 'New arrival', looking: (n) => `${n} खोज्दै हुनुहुन्छ? We have it!`, price: 'मूल्य', was: 'पहिले', call: 'Call / WhatsApp', visit: 'Visit गर्नुहोस्', delivery: 'Delivery उपलब्ध', inStock: 'Stock मा छ', few: (n) => `Only ${n} बाँकी`, ask: 'Availability सोध्नुहोस्', item: 'Item', about: 'विवरण', avail: 'Availability', website: 'Online order' },
  nepali: { hook: 'नयाँ आगमन', looking: (n) => `${n} खोज्दै हुनुहुन्छ? हामीसँग छ!`, price: 'मूल्य', was: 'पहिले', call: 'सम्पर्क', visit: 'हामीलाई भेट्नुहोस्', delivery: 'डेलिभरी उपलब्ध', inStock: 'स्टकमा छ', few: (n) => `केवल ${n} बाँकी`, ask: 'उपलब्धताबारे सोध्नुहोस्', item: 'सामान', about: 'विवरण', avail: 'उपलब्धता', website: 'अनलाइन अर्डर' },
};

const rs = (n: number) => `Rs. ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

function buildCaption(p: Product, style: Style, lang: Lang, shop: { name: string; phone: string; address: string }): string {
  const w = WORDS[lang];
  const was = p.original_price && p.original_price > p.price ? ` (${w.was} ${rs(p.original_price)})` : '';
  const price = `${rs(p.price)}${was}`;
  const stock = p.stock_level > 0 ? (p.stock_level <= 5 ? w.few(p.stock_level) : w.inStock) : w.ask;
  const desc = (p.description ?? '').trim();
  const call = shop.phone ? `${w.call}: ${shop.phone}` : '';
  const visit = shop.address ? `${w.visit}: ${shop.address}` : '';
  const lines: (string | false | undefined)[] =
    style === 'short'
      ? [`${w.hook}: ${p.name} - ${price}`, call, `${SITE}`]
      : style === 'friendly'
        ? [w.looking(p.name), desc, `${w.price}: ${price}`, stock, call, visit, `${w.website}: ${SITE}`]
        : style === 'detailed'
          ? [`${w.item}: ${p.name}`, desc && `${w.about}: ${desc}`, `${w.price}: ${price}`, `${w.avail}: ${stock}`, w.delivery, call, visit, `${w.website}: ${SITE}`]
          : [`${w.hook}! ${p.name}`, desc, `💰 ${price}`, `✅ ${stock}`, `🚚 ${w.delivery}`, call && `📞 ${call}`, visit && `📍 ${visit}`, `🌐 ${SITE}`];
  return [...lines.filter((l): l is string => !!l), shop.name && `- ${shop.name}`].filter(Boolean).join('\n');
}

/** Copies to the clipboard (the web); on a phone the share sheet is the way, so it opens that instead. */
async function copyText(text: string): Promise<'copied' | 'shared' | 'failed'> {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return 'copied';
    } catch {
      return 'failed';
    }
  }
  try {
    await Share.share({ message: text });
    return 'shared';
  } catch {
    return 'failed';
  }
}

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: on }}
      className="rounded-lg px-3 py-2"
      style={{ borderWidth: 1.5, borderColor: on ? BLUE : '#E5E7EB', backgroundColor: on ? '#EFF6FF' : '#fff' }}
    >
      <Text className="text-xs font-bold" style={{ color: on ? BLUE : '#4B5563' }}>
        {label}
      </Text>
    </Pressable>
  );
}

function ActionButton({ label, icon, onPress, primary }: { label: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void; primary?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center justify-center rounded-xl px-4 py-3"
      style={{ gap: 7, flexGrow: 1, backgroundColor: primary ? '#1D4ED8' : '#fff', borderWidth: primary ? 0 : 1, borderColor: '#D1D5DB' }}
    >
      <Ionicons name={icon} size={16} color={primary ? '#fff' : '#374151'} />
      <Text className="text-sm font-bold" style={{ color: primary ? '#fff' : '#374151' }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function ShareScreen() {
  const layout = useBookLayout();
  const profile = useAuthStore((state) => state.profile);
  const userId = profile?.id;
  const { data, isLoading } = useSupabaseQuery('products', { filters: userId ? { owner_id: userId } : {}, all: true, enabled: !!userId });
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Product | null>(null);
  const [style, setStyle] = useState<Style>('facebook');
  const [lang, setLang] = useState<Lang>('english');
  const [text, setText] = useState('');
  const [copied, setCopied] = useState(false);

  const shop = useMemo(
    () => ({
      name: profile?.business_name?.trim() || 'All In One Abroad',
      phone: (profile?.business_phone || profile?.phone || '').trim(),
      address: (profile?.business_address || '').trim(),
    }),
    [profile]
  );
  const products = useMemo(
    () => ((data ?? []) as Product[]).filter((p) => p.is_active).sort((a, b) => a.name.localeCompare(b.name)),
    [data]
  );
  const q = search.trim().toLowerCase();
  const shown = products.filter((p) => !q || p.name.toLowerCase().includes(q));

  const open = (p: Product) => {
    setPicked(p);
    setCopied(false);
    setText(buildCaption(p, style, lang, shop));
  };
  // Changing the style or language writes the caption again (a caption edited by hand is replaced, as in Auto Stock Manager).
  const restyle = (nextStyle: Style, nextLang: Lang) => {
    setStyle(nextStyle);
    setLang(nextLang);
    setCopied(false);
    if (picked) setText(buildCaption(picked, nextStyle, nextLang, shop));
  };

  async function copy() {
    const result = await copyText(text);
    if (result === 'copied') {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else if (result === 'failed') {
      showAlert('Could not copy', 'Select the caption and copy it by hand.');
    }
  }
  const whatsapp = () => void Linking.openURL(`https://wa.me/?text=${encodeURIComponent(text)}`);
  const sharePost = () => void Share.share({ message: text }).catch(() => undefined);

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-gray-50">
        <ActivityIndicator size="large" color={BLUE} />
      </View>
    );
  }

  return (
    <BookPage wide={layout.wide}>
      <View className="flex-row flex-wrap items-center justify-between" style={{ gap: 12 }}>
        <Text className="text-sm text-gray-500">Pick a product to write its post</Text>
        <ToolbarSearch value={search} onChange={setSearch} placeholder="Search products" wide={layout.wide} />
      </View>

      {shown.length === 0 ? (
        <View className="items-center rounded-xl border border-gray-200 bg-white py-12">
          <Ionicons name="share-social-outline" size={34} color="#D1D5DB" />
          <Text className="mt-2 font-medium text-gray-500">{products.length === 0 ? 'No products yet' : 'No products match'}</Text>
          {products.length === 0 && <Text className="mt-1 text-xs text-gray-400">Add products in Stock and Inventory first.</Text>}
        </View>
      ) : (
        <View className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          {shown.map((p, i) => (
            <Pressable
              key={p.id}
              onPress={() => open(p)}
              className="flex-row items-center px-4 py-3"
              style={(state) => ({
                gap: 12,
                backgroundColor: (state as { hovered?: boolean }).hovered || state.pressed ? '#F9FAFB' : '#FFFFFF',
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: '#F3F4F6',
              })}
            >
              <View className="items-center justify-center overflow-hidden rounded-lg bg-gray-100" style={{ width: 48, height: 48 }}>
                {p.image_url ? <Image source={{ uri: p.image_url }} style={{ width: 48, height: 48 }} resizeMode="cover" /> : <Ionicons name="image-outline" size={20} color="#9CA3AF" />}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text className="text-sm font-semibold text-gray-900" numberOfLines={1}>
                  {p.name}
                </Text>
                <Text className="mt-0.5 text-xs text-gray-500">
                  NPR {money(p.price)} · {p.stock_level > 0 ? `${p.stock_level} in stock` : 'Out of stock'}
                </Text>
              </View>
              <Ionicons name="share-social-outline" size={18} color={BLUE} />
            </Pressable>
          ))}
        </View>
      )}

      <Modal visible={!!picked} transparent animationType="fade" onRequestClose={() => setPicked(null)}>
        <View className="flex-1 items-center justify-center bg-black/40 px-3 sm:px-6">
          {picked && (
            <View className="w-full rounded-2xl bg-white" style={{ maxWidth: 560, maxHeight: '92%', padding: 20, boxShadow: '0 20px 50px rgba(16,24,40,0.25)' } as object}>
              <View className="mb-3 flex-row items-center justify-between" style={{ gap: 10 }}>
                <Text className="flex-1 text-lg font-extrabold text-gray-900" numberOfLines={1}>
                  {picked.name}
                </Text>
                <Pressable onPress={() => setPicked(null)} hitSlop={8} accessibilityLabel="Close">
                  <Ionicons name="close" size={24} color="#374151" />
                </Pressable>
              </View>
              <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
                {!!picked.image_url && (
                  <Pressable onPress={() => void Linking.openURL(picked.image_url as string)} accessibilityLabel="Open the photo" className="mb-3 self-start">
                    <Image source={{ uri: picked.image_url }} style={{ width: 110, height: 110, borderRadius: 12, backgroundColor: '#E5E7EB' }} resizeMode="cover" />
                    <Text className="mt-1 text-xs font-bold" style={{ color: BLUE }}>
                      Open photo to save it
                    </Text>
                  </Pressable>
                )}
                <Text className="mb-1.5 text-[11px] font-bold tracking-wide text-gray-500">Style</Text>
                <View className="mb-3 flex-row flex-wrap" style={{ gap: 8 }}>
                  {STYLES.map((s) => (
                    <Chip key={s.key} label={s.label} on={style === s.key} onPress={() => restyle(s.key, lang)} />
                  ))}
                </View>
                <Text className="mb-1.5 text-[11px] font-bold tracking-wide text-gray-500">Language</Text>
                <View className="mb-3 flex-row flex-wrap" style={{ gap: 8 }}>
                  {LANGS.map((l) => (
                    <Chip key={l.key} label={l.label} on={lang === l.key} onPress={() => restyle(style, l.key)} />
                  ))}
                </View>
                <Text className="mb-1.5 text-[11px] font-bold tracking-wide text-gray-500">Caption (you can edit it)</Text>
                <TextInput
                  value={text}
                  onChangeText={setText}
                  multiline
                  className="rounded-lg bg-white px-3 py-2.5 text-sm text-gray-900"
                  style={[{ borderWidth: 1, borderColor: '#D1D5DB', minHeight: 190, textAlignVertical: 'top' }, { outlineStyle: 'none' } as object]}
                />
              </ScrollView>
              <View className="mt-3 flex-row flex-wrap border-t border-gray-100 pt-3" style={{ gap: 8 }}>
                <ActionButton label={copied ? 'Copied' : Platform.OS === 'web' ? 'Copy caption' : 'Share caption'} icon={copied ? 'checkmark' : 'copy-outline'} onPress={copy} primary />
                <ActionButton label="WhatsApp" icon="logo-whatsapp" onPress={whatsapp} />
                {Platform.OS !== 'web' && <ActionButton label="Share" icon="share-social-outline" onPress={sharePost} />}
              </View>
            </View>
          )}
        </View>
      </Modal>
    </BookPage>
  );
}
