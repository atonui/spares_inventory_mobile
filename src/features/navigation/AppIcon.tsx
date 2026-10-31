import Svg, {Circle, Path} from 'react-native-svg';

export type AppIconName = 'home' | 'inventory' | 'scan' | 'changes' | 'more' | 'filter' | 'search' | 'sort' | 'close' | 'signOut' | 'flashlight' | 'profile' | 'settings' | 'store' | 'equipment' | 'warning' | 'chevronRight';

export function AppIcon({name, color, size = 22}: {name: AppIconName; color: string; size?: number}) {
  const shared = {stroke: color, strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const};

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessible={false}>
      {name === 'home' && <>
        <Path d="m3.5 10.5 8.5-7 8.5 7" {...shared} />
        <Path d="M5.5 9.5V20h13V9.5M9.5 20v-6h5v6" {...shared} />
      </>}
      {name === 'inventory' && <>
        <Path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" {...shared} />
        <Path d="m12 12 8-4.5M12 12 4 7.5M12 12v9M8 5.25l8 4.5" {...shared} />
      </>}
      {name === 'scan' && <>
        <Path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3M21 16v3a2 2 0 0 1-2 2h-3" {...shared} />
        <Path d="M8 8v8M11 9v6M14 8v8M17 9v6" {...shared} />
      </>}
      {name === 'changes' && <>
        <Path d="M6 3.5h9l4 4v13H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z" {...shared} />
        <Path d="M15 4v4h4M8 11h8M8 14.5h8M8 18h5" {...shared} />
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
      {name === 'flashlight' && <>
        <Path d="M8 3h8l1.5 5-2.5 2v8.5L12 21l-3-2.5V10L6.5 8 8 3Z" {...shared} />
        <Path d="M8 6.5h8M9 9h6" {...shared} />
      </>}
      {name === 'profile' && <>
        <Circle cx="12" cy="8" r="3.5" {...shared} />
        <Path d="M4.5 20a7.5 7.5 0 0 1 15 0" {...shared} />
      </>}
      {name === 'settings' && <>
        <Circle cx="12" cy="12" r="3" {...shared} />
        <Path d="m19.4 15 .1.1 1 1.7-1.7 2.9-2 .1-.2-.1a7.9 7.9 0 0 1-1.7 1l-.9 1.5h-3.4l-.9-1.5a7.9 7.9 0 0 1-1.7-1l-2 .1-1.7-2.9 1-1.7a8.3 8.3 0 0 1 0-2l-1-1.7 1.7-2.9 2 .1a7.9 7.9 0 0 1 1.7-1L10.8 6h3.4l.9 1.5a7.9 7.9 0 0 1 1.7 1l2-.1 1.7 2.9-1 1.7a8.3 8.3 0 0 1-.1 2Z" {...shared} />
      </>}
      {name === 'store' && <>
        <Path d="M4 10v10h16V10M3 10l2-6h14l2 6M3 10a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2 2 0 0 0 4 0" {...shared} />
        <Path d="M9 20v-6h6v6" {...shared} />
      </>}
      {name === 'equipment' && <>
        <Path d="M8 6a4 4 0 0 0 5.2 3.8L20 16.6 16.6 20l-6.8-6.8A4 4 0 0 1 5 8l2.4 2.4 2.8-2.8L8 5.2V6Z" {...shared} />
        <Circle cx="17.4" cy="17.4" r="1" {...shared} />
      </>}
      {name === 'warning' && <>
        <Path d="M12 3.5 22 20H2L12 3.5Z" {...shared} />
        <Path d="M12 9v5M12 17.2v.1" {...shared} />
      </>}
      {name === 'chevronRight' && <Path d="m9 5 7 7-7 7" {...shared} />}
    </Svg>
  );
}
