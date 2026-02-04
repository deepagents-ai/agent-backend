/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          600: '#2563EB',
          700: '#1D4ED8',
        },
        accent: {
          purple: '#8B5CF6',
          green: '#10B981',
          amber: '#F59E0B',
        },
        bg: {
          app: '#0F172A',
          surface: '#1E293B',
          elevated: '#334155',
        },
        text: {
          primary: '#F1F5F9',
          secondary: '#CBD5E1',
          tertiary: '#94A3B8',
        },
        border: {
          subtle: '#334155',
        },
      },
    },
  },
  plugins: [],
}
