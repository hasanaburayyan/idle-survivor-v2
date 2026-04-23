import Svg, { Path } from 'react-native-svg';

interface ScrapIconProps {
  size?: number;
  color?: string;
}

export default function ScrapIcon({
  size = 16,
  color = '#fbbf24',
}: ScrapIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M12 2 4 6v6c0 5 3.4 9.3 8 10 4.6-.7 8-5 8-10V6l-8-4Zm0 4.5 5 2.5v3c0 3.5-2.3 6.7-5 7.4-2.7-.7-5-3.9-5-7.4V9l5-2.5Z"
        fill={color}
      />
    </Svg>
  );
}
