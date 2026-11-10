import { Platform, StyleSheet, Text, type TextProps } from 'react-native';

import { Brand, Fonts, Type, type ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedTextProps = TextProps & {
  type?:
    | 'default'
    | 'title'
    | 'subtitle'
    | 'headline'
    | 'small'
    | 'smallBold'
    | 'caption'
    | 'link'
    | 'linkPrimary'
    | 'code';
  themeColor?: ThemeColor;
};

export function ThemedText({ style, type = 'default', themeColor, ...rest }: ThemedTextProps) {
  const theme = useTheme();
  return <Text style={[{ color: theme[themeColor ?? 'text'] }, styles[type], style]} {...rest} />;
}

const styles = StyleSheet.create({
  title: { ...Type.title, letterSpacing: -1 },
  subtitle: { ...Type.subtitle, letterSpacing: -0.5 },
  headline: Type.headline,
  default: Type.default,
  small: Type.small,
  smallBold: Type.smallBold,
  caption: Type.caption,
  link: { ...Type.small, fontWeight: 600 },
  linkPrimary: { ...Type.small, fontWeight: 700, color: Brand.primary },
  code: {
    fontFamily: Fonts.mono,
    fontWeight: Platform.select({ android: 700 }) ?? 500,
    fontSize: 12,
  },
});
