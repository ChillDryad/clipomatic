/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Outfit', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        ctp: {
          base:       'var(--ctp-base)',
          surface:    'var(--ctp-surface)',
          surface1:   'var(--ctp-surface-1)',
          overlay:    'var(--ctp-overlay)',
          text:       'var(--ctp-text)',
          subtext:    'var(--ctp-subtext)',
          mauve:      'var(--ctp-mauve)',
          peach:      'var(--ctp-peach)',
          green:      'var(--ctp-green)',
          red:        'var(--ctp-red)',
          yellow:     'var(--ctp-yellow)',
          blue:       'var(--ctp-blue)',
        },
        momiji: {
          sakura:     'var(--momiji-sakura)',
          'neon-pink': 'var(--momiji-neon-pink)',
          red:        'var(--momiji-red)',
          plant:      'var(--momiji-plant)',
          'neon-green': 'var(--momiji-neon-green)',
          bg:         'var(--momiji-bg)',
          surface:    'var(--momiji-surface)',
          text:       'var(--momiji-text)',
          subtext:    'var(--momiji-subtext)',
          border:     'var(--momiji-border)',
        },
      },
      borderRadius: {
        xl: '12px',
      },
      keyframes: {
        stepPulse: {
          '0%, 100%': { opacity: '0.6', transform: 'scale(0.95)' },
          '50%': { opacity: '1', transform: 'scale(1.05)' },
        },
        slideInRight: {
          'from': { transform: 'translateX(100%)', opacity: '0' },
          'to': { transform: 'translateX(0)', opacity: '1' },
        },
        fadeIn: {
          'from': { opacity: '0', transform: 'translateY(8px)' },
          'to': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmerGradient: {
          '0%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
          '100%': { backgroundPosition: '0% 50%' },
        },
        glowPulse: {
          '0%, 100%': { opacity: '0.6' },
          '50%': { opacity: '1' },
        },
        neonPulse: {
          '0%, 100%': { boxShadow: '0 0 10px rgba(0, 255, 157, 0.2)' },
          '50%': { boxShadow: '0 0 20px rgba(0, 255, 157, 0.5)' },
        },
        pulseSlow: {
          '0%, 100%': { opacity: '0.8', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.05)' },
        },
        sakuraDrift: {
          '0%': { transform: 'translateY(-10px) translateX(0) rotate(0deg)', opacity: '0' },
          '10%': { opacity: '1' },
          '100%': { transform: 'translateY(100vh) translateX(50px) rotate(360deg)', opacity: '0' },
        },
      },
      animation: {
        stepPulse: 'stepPulse 2s ease-in-out infinite',
        slideInRight: 'slideInRight 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        fadeIn: 'fadeIn 0.2s ease-out',
        shimmerGradient: 'shimmerGradient 2s linear infinite',
        glowPulse: 'glowPulse 1.2s ease-in-out infinite',
        neonPulse: 'neonPulse 1.5s ease-in-out infinite',
        'pulse-slow': 'pulseSlow 3s ease-in-out infinite',
        'sakura-drift': 'sakuraDrift 3s ease-out infinite',
      },
    },
  },
  plugins: [],
}
