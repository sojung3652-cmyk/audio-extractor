import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, Text, type TextProps } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type TextSize = 'normal' | 'large' | 'xlarge';
export type TextWeightSetting = 'normal' | 'bold';

const STORAGE_KEY = 'textSettings';
const DEFAULT_SIZE: TextSize = 'large';
const DEFAULT_WEIGHT: TextWeightSetting = 'bold';

const SIZE_SCALE: Record<TextSize, number> = {
  normal: 1,
  large: 1.15,
  xlarge: 1.3,
};

type TextSettingsValue = {
  size: TextSize;
  weight: TextWeightSetting;
  setSize: (size: TextSize) => void;
  setWeight: (weight: TextWeightSetting) => void;
};

const TextSettingsContext = createContext<TextSettingsValue>({
  size: DEFAULT_SIZE,
  weight: DEFAULT_WEIGHT,
  setSize: () => {},
  setWeight: () => {},
});

export function TextSettingsProvider({ children }: { children: ReactNode }) {
  const [size, setSizeState] = useState<TextSize>(DEFAULT_SIZE);
  const [weight, setWeightState] = useState<TextWeightSetting>(DEFAULT_WEIGHT);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        if (parsed.size === 'normal' || parsed.size === 'large' || parsed.size === 'xlarge') {
          setSizeState(parsed.size);
        }
        if (parsed.weight === 'normal' || parsed.weight === 'bold') {
          setWeightState(parsed.weight);
        }
      } catch {
        // ignore malformed stored settings, keep defaults
      }
    });
  }, []);

  const persist = (next: { size: TextSize; weight: TextWeightSetting }) => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  };

  const setSize = (next: TextSize) => {
    setSizeState(next);
    persist({ size: next, weight });
  };

  const setWeight = (next: TextWeightSetting) => {
    setWeightState(next);
    persist({ size, weight: next });
  };

  const value = useMemo(() => ({ size, weight, setSize, setWeight }), [size, weight]);

  return <TextSettingsContext.Provider value={value}>{children}</TextSettingsContext.Provider>;
}

export function useTextSettings() {
  return useContext(TextSettingsContext);
}

type AppTextProps = TextProps & {
  weight?: 'normal' | 'semibold' | 'bold';
};

const WEIGHT_MAP: Record<'normal' | 'semibold' | 'bold', TextProps['style']> = {
  normal: { fontWeight: '400' },
  semibold: { fontWeight: '600' },
  bold: { fontWeight: '700' },
};

export function AppText({
  style,
  weight = 'normal',
  allowFontScaling = true,
  children,
  ...rest
}: AppTextProps) {
  const { size, weight: globalWeight } = useTextSettings();
  const scale = SIZE_SCALE[size];
  const flat = StyleSheet.flatten(style) ?? {};
  const baseFontSize = typeof flat.fontSize === 'number' ? flat.fontSize : 15;
  const resolvedWeight = globalWeight === 'bold' ? WEIGHT_MAP.bold : WEIGHT_MAP[weight];

  return (
    <Text
      {...rest}
      allowFontScaling={allowFontScaling}
      style={[style, resolvedWeight, { fontSize: baseFontSize * scale }]}
    >
      {children}
    </Text>
  );
}
