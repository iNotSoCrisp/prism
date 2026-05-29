/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{tsx,ts,jsx,js}'],
  theme: {
    extend: {
      colors: {
        bg: {
          base: '#0D0C0C',
          surface: '#141312',
          elevated: '#1C1A19',
          border: '#2A2725'
        },
        text: {
          primary: '#F0EDE8',
          secondary: '#9C9490',
          tertiary: '#625E5A'
        },
        accent: {
          DEFAULT: '#D97757',
          hover: '#E8875F',
          muted: '#2A1F18'
        },
        success: '#4CAF7D',
        error: '#E05C5C'
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace']
      },
      fontSize: {
        xxs: '0.65rem',
        xs: '0.75rem',
        sm: '0.8125rem',
        base: '0.9375rem'
      },
      borderRadius: {
        xl: '12px',
        '2xl': '16px',
        '3xl': '24px'
      },
      animation: {
        'fade-in': 'fadeIn 0.15s ease-out',
        'slide-up': 'slideUp 0.2s ease-out',
        'pulse-dot': 'pulseDot 1.5s ease-in-out infinite',
        blink: 'blink 1s step-end infinite'
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' }
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' }
        },
        pulseDot: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.3' }
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' }
        }
      }
    }
  },
  plugins: []
}
