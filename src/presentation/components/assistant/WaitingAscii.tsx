// While the assistant thinks (before the first words arrive): one of the six
// ASCII animations, chosen at random per turn, and a stopwatch — the honest
// signal of how long it is taking. Plain text at ~12 frames per second: light
// enough for low-end phones.

import { useEffect, useState } from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';
import { FILAS, VARIANTES } from '@/domain/assistant/waiting-ascii';
import { COLORS } from '@/presentation/theme';

const FRAME_MS = 80;
const FONT_SIZE = 11;
// IBM Plex Mono: each character is 0.6 em wide.
const CHAR_W = FONT_SIZE * 0.6;

export function WaitingAscii({ label }: { label: string | null }) {
  const [variant] = useState(() => VARIANTES[Math.floor(Math.random() * VARIANTES.length)]!);
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(started);
  const [cols, setCols] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), FRAME_MS);
    return () => clearInterval(id);
  }, []);

  // Frame and stopwatch from the clock: a slow phone skips frames, not seconds.
  const frame = Math.floor((now - started) / FRAME_MS);

  const onLayout = (e: LayoutChangeEvent) => setCols(Math.max(10, Math.floor(e.nativeEvent.layout.width / CHAR_W)));
  const seconds = ((now - started) / 1000).toFixed(1).replace('.', ',');

  return (
    <View className="mb-3" onLayout={onLayout} accessibilityLabel="El asistente está pensando">
      {cols > 0 && (
        <Text style={{ fontFamily: 'IBMPlexMono_400Regular', fontSize: FONT_SIZE, lineHeight: FONT_SIZE * 1.25, color: COLORS.mintDark }}>
          {variant.dibujar(frame, cols, FILAS)}
        </Text>
      )}
      <Text className="text-brand-muted font-mono text-[11px] mt-1">
        {label ?? 'Pensando'} · {seconds} s
      </Text>
    </View>
  );
}
