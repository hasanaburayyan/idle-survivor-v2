import { forwardRef } from 'react';
import {
  Platform,
  Pressable,
  type PressableProps,
  type StyleProp,
  type View,
  type ViewStyle,
} from 'react-native';
import { cssInterop } from 'nativewind';

// Web-only suppression of text selection / cursor / browser tap delay.
// On native, the Pressable already handles touch correctly.
const WEB_STYLE: StyleProp<ViewStyle> =
  Platform.OS === 'web'
    ? // Casting because RN's ViewStyle doesn't expose userSelect / cursor /
      // touchAction; react-native-web understands them at runtime.
      ({
        userSelect: 'none',
        WebkitUserSelect: 'none',
        cursor: 'pointer',
        touchAction: 'manipulation',
      } as unknown as ViewStyle)
    : null;

const SafePressableImpl = forwardRef<View, PressableProps>((props, ref) => {
  const { style, ...rest } = props;

  if (WEB_STYLE === null) {
    return <Pressable ref={ref} style={style} {...rest} />;
  }

  if (typeof style === 'function') {
    return (
      <Pressable
        ref={ref}
        {...rest}
        style={state => [WEB_STYLE, style(state)]}
      />
    );
  }

  return <Pressable ref={ref} {...rest} style={[WEB_STYLE, style]} />;
});

SafePressableImpl.displayName = 'SafePressable';

// NativeWind v4: register className → style remapping for the wrapper so
// callers can use `<SafePressable className="..." />` exactly like Pressable.
cssInterop(SafePressableImpl, { className: 'style' });

export default SafePressableImpl;
