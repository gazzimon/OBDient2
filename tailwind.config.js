/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // OBDient brand palette — aligned with QVAC Health aesthetic
        brand: {
          bg: '#0D0D0D',
          surface: '#1C1C1E',
          card: '#1C1C1E',
          border: '#2C2C2E',
          // Bright mint accent (QVAC signature color)
          teal: '#2DE1A5',
          'teal-light': '#54EAB8',
          'teal-dark': '#1D9E75',
          red: '#F26D6D',
          amber: '#F5A623',
          purple: '#8B5CF6',
          orange: '#F59E0B',
          green: '#2DE1A5',
          text: '#F5F5F5',
          muted: '#9A9A9A',
          // Light pill buttons (QVAC primary action style)
          pill: '#E8E8E8',
        },
      },
      fontFamily: {
        mono: ['IBMPlexMono_400Regular', 'monospace'],
        'mono-medium': ['IBMPlexMono_500Medium', 'monospace'],
        'mono-bold': ['IBMPlexMono_700Bold', 'monospace'],
      },
    },
  },
  plugins: [],
};
