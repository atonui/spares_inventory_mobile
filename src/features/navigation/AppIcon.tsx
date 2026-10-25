import Svg, {Circle, Path} from 'react-native-svg';

export type AppIconName = 'inventory' | 'scan' | 'changes' | 'more' | 'filter' | 'search' | 'sort' | 'close' | 'signOut';

export function AppIcon({name, color, size = 22}: {name: AppIconName; color: string; size?: number}) {
  const shared = {stroke: color, strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const};

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessible={false}>
      {name === 'inventory' && <>
        <Path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" {...shared} />
        <Path d="m12 12 8-4.5M12 12 4 7.5M12 12v9M8 5.25l8 4.5" {...shared} />
      </>}
      {name === 'scan' && <>
        <Path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3M21 16v3a2 2 0 0 1-2 2h-3" {...shared} />
        <Path d="M8 8v8M11 9v6M14 8v8M17 9v6" {...shared} />
      </>}
      {name === 'changes' && <>
        <Path d="M20 7v5h-5M4 17v-5h5" {...shared} />
        <Path d="M5.6 9A7 7 0 0 1 17 5l3 2M4 17l3 2a7 7 0 0 0 11.4-4" {...shared} />
      </>}
      {name === 'more' && <>
        <Circle cx="5" cy="12" r="1.2" fill={color} stroke="none" />
        <Circle cx="12" cy="12" r="1.2" fill={color} stroke="none" />
        <Circle cx="19" cy="12" r="1.2" fill={color} stroke="none" />
      </>}
      {name === 'filter' && <>
        <Path d="M4 6h16M4 12h16M4 18h16" {...shared} />
        <Circle cx="9" cy="6" r="2" fill="#FFFFFF" {...shared} />
        <Circle cx="15" cy="12" r="2" fill="#FFFFFF" {...shared} />
        <Circle cx="10" cy="18" r="2" fill="#FFFFFF" {...shared} />
      </>}
      {name === 'search' && <>
        <Circle cx="10.8" cy="10.8" r="6.3" {...shared} />
        <Path d="m15.5 15.5 4.2 4.2" {...shared} />
      </>}
      {name === 'sort' && <>
        <Path d="M8 5v14M4.5 8.5 8 5l3.5 3.5M16 19V5m-3.5 3.5L16 5l3.5 3.5" {...shared} />
      </>}
      {name === 'close' && <Path d="m6 6 12 12M18 6 6 18" {...shared} />}
      {name === 'signOut' && <>
        <Path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5M14 16l4-4-4-4M18 12H8" {...shared} />
      </>}
    </Svg>
  );
}
