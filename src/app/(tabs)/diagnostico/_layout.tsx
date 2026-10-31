// Diagnóstico (2026-10-31): its own stack — grid, section, detail. Tapping the
// tab again goes back to the grid.

import { Stack } from 'expo-router';
import { COLORS } from '@/presentation/theme';

export default function DiagnosisLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: COLORS.bg } }} />;
}
