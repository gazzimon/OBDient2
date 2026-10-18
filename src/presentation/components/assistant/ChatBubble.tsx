// One message in the assistant chat (ported from OBDient, without the
// engine badges and ratings that belonged to its two-model setup).

import { Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '@/presentation/theme';

interface Props {
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly at: number;
  readonly photos?: number;
  readonly cancelled?: boolean;
  readonly streaming?: boolean;
}

export function ChatBubble({ role, text, at, photos = 0, cancelled = false, streaming = false }: Props) {
  const isUser = role === 'user';
  return (
    <View className={`mb-3 ${isUser ? 'items-end' : 'items-start'}`}>
      <View
        className={`rounded-2xl px-4 py-3 max-w-[85%] ${
          isUser ? 'bg-brand-pill rounded-tr-sm' : 'bg-brand-surface border border-brand-border rounded-tl-sm'
        }`}
      >
        {!isUser && <Text className="font-mono text-xs text-brand-teal mb-1">OBDient</Text>}
        {photos > 0 && (
          <View className="flex-row items-center gap-1 mb-1">
            <MaterialCommunityIcons name="image-outline" size={14} color={isUser ? COLORS.bg : COLORS.muted} />
            <Text className={`font-mono text-[10px] ${isUser ? 'text-brand-bg' : 'text-brand-muted'}`}>
              {photos === 1 ? 'Foto adjunta' : `${photos} fotos adjuntas`}
            </Text>
          </View>
        )}
        {text !== '' && (
          <Text selectable className={`font-mono text-sm leading-5 ${isUser ? 'text-brand-bg' : 'text-brand-text'}`}>
            {text}
            {streaming ? ' ▍' : ''}
          </Text>
        )}
        {cancelled && <Text className="text-brand-muted font-mono text-[10px] mt-1">Detenido</Text>}
      </View>
      <Text className="text-brand-muted font-mono text-[10px] mt-1 px-1">
        {new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </Text>
    </View>
  );
}
