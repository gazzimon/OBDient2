// A turn that could not reach an answer, with a way to send it again.

import { Pressable, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '@/presentation/theme';

export function ErrorRow({ text, onRetry, onContinue }: { text: string; onRetry?: (() => void) | undefined; onContinue?: (() => void) | undefined }) {
  return (
    <View className="flex-row items-start gap-2 mb-3 px-1">
      <MaterialCommunityIcons name="alert-outline" size={16} color={COLORS.red} style={{ marginTop: 1 }} />
      <View className="flex-1">
        <Text className="text-brand-red font-mono text-xs leading-5">{text}</Text>
        {onContinue ? (
          <Pressable onPress={onContinue} hitSlop={8} className="mt-1 active:opacity-60">
            <Text className="text-brand-teal font-mono text-xs">Seguir en una conversación nueva</Text>
          </Pressable>
        ) : (
          onRetry && (
            <Pressable onPress={onRetry} hitSlop={8} className="mt-1 active:opacity-60">
              <Text className="text-brand-teal font-mono text-xs">Reintentar</Text>
            </Pressable>
          )
        )}
      </View>
    </View>
  );
}
