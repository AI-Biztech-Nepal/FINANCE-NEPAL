// lib/components/finance/SelectDropdown.tsx
import type { ReactNode } from 'react';
import { Pressable, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DropdownPanel, useDropdown } from './DropdownMenu';

export interface SelectOption<K extends string> {
  key: K;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

/** A pick-one dropdown: whatever `trigger` draws is the button, and the options hang from it in a menu that no
 * scrolling or table can cut off (see DropdownMenu). Choosing an option closes the menu and calls `onChange`. */
export function SelectDropdown<K extends string>({
  value,
  options,
  onChange,
  trigger,
  width = 200,
  disabled,
  accessibilityLabel,
}: {
  value: K | null;
  options: SelectOption<K>[];
  onChange: (key: K) => void;
  /** The closed button; told whether the menu is open. */
  trigger: (open: boolean) => ReactNode;
  width?: number;
  disabled?: boolean;
  accessibilityLabel: string;
}) {
  const dropdown = useDropdown(width);
  return (
    <>
      <Pressable
        ref={dropdown.buttonRef}
        onPress={dropdown.show}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ expanded: dropdown.open }}
        style={{ alignSelf: 'flex-start' }}
      >
        {trigger(dropdown.open)}
      </Pressable>
      <DropdownPanel dropdown={dropdown}>
        {options.map((o, i) => {
          const on = o.key === value;
          return (
            <Pressable
              key={o.key}
              onPress={() => {
                dropdown.hide();
                onChange(o.key);
              }}
              accessibilityRole="menuitem"
              accessibilityState={{ selected: on }}
              className="flex-row items-center px-3.5 py-2.5"
              style={(state) => ({
                gap: 10,
                backgroundColor: on ? '#EFF6FF' : (state as { hovered?: boolean }).hovered || state.pressed ? '#F9FAFB' : '#FFFFFF',
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: '#F3F4F6',
              })}
            >
              {!!o.icon && <Ionicons name={o.icon} size={16} color={on ? '#2563EB' : '#6B7280'} />}
              <Text className="flex-1 text-sm font-semibold" style={{ color: on ? '#1D4ED8' : '#374151' }}>
                {o.label}
              </Text>
              {on && <Ionicons name="checkmark" size={16} color="#2563EB" />}
            </Pressable>
          );
        })}
      </DropdownPanel>
    </>
  );
}
