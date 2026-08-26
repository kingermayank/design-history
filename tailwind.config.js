/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/viewer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      fontFamily: {
        serif: ['"IBM Plex Serif"', 'Georgia', 'serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      // Single brand accent (blue), replacing the old fuchsia→amber gradient.
      // Mirrors design.md: --blue #5AA2F5 (dark), --blue-solid #3C82F7 (fills).
      colors: {
        accent: {
          200: '#CFE0FC',
          300: '#9DC1F8',
          400: '#5AA2F5',
          500: '#3C82F7',
          600: '#2E6FE0',
        },
      },
      transitionTimingFunction: {
        // design.md signature easing (ease-out-expo-ish).
        brand: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
};
