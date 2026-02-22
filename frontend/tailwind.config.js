/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          900: '#1e3a8a',
        },
        success: '#10b981',
        warning: '#f59e0b',
        danger: '#ef4444',
        // Remapped to light equivalents so inline bg-dark-* classes work in light theme
        dark: {
          100: '#f5f8fc',  // subtle hover/alternate bg
          200: '#ffffff',  // white panels, sidebar, header
          300: '#f0f4f8',  // main body background
        },
      },
    },
  },
  plugins: [],
}
