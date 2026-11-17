// lib/components/MobileNavDrawer.tsx
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SidebarPanel, type WebNavItem } from './web/WebSidebarShell';

const SLIDE_MS = 220;
const PANEL_MAX_WIDTH = 300;

/** The web sidebar's panel as a drawer for a phone: it slides in from the left over the page, behind a dim
 * layer; pressing the dim layer, a link, or the system back button closes it. The header's menu button opens it. */
export function MobileNavDrawer({
  open,
  onClose,
  items,
  roleLabel,
  profileHref,
}: {
  open: boolean;
  onClose: () => void;
  items: WebNavItem[];
  roleLabel: string;
  profileHref?: string;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const panelWidth = Math.min(PANEL_MAX_WIDTH, Math.round(width * 0.82));
  // 0 = shut, 1 = open. The Modal stays mounted until the slide out has finished.
  const slide = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    Animated.timing(slide, {
      toValue: open ? 1 : 0,
      duration: SLIDE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start(({ finished }) => {
      if (finished && !open) setMounted(false);
    });
  }, [open, mounted, slide]);

  if (!mounted) return null;

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1 }}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(17,24,39,0.45)', opacity: slide }]}>
          <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close menu" />
        </Animated.View>
        <Animated.View
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            width: panelWidth,
            transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [-panelWidth, 0] }) }],
          }}
        >
          <SidebarPanel
            items={items}
            roleLabel={roleLabel}
            profileHref={profileHref}
            onNavigate={onClose}
            style={{ flex: 1, width: '100%', paddingTop: insets.top + 20, paddingBottom: insets.bottom + 14 }}
          />
        </Animated.View>
      </View>
    </Modal>
  );
}
