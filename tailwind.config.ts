import type { Config } from 'tailwindcss';

// Semantic color tokens, backed by CSS variables so Light / Dark resolve at
// runtime. Channel-triple form keeps Tailwind's /alpha modifiers working.
// The green values are PLACEHOLDERS for the official NACOS palette: replace the
// --c-* triples in app/globals.css once the brand guide / logo is in the repo.
const v = (name: string) => `rgb(var(${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: 'class',
  content: ['./app/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: v('--c-paper'), // page background
        surface: v('--c-surface'), // inputs, raised areas
        ink: v('--c-ink'), // primary text / structural
        line: v('--c-line'), // rules, borders
        accent: v('--c-accent'), // brand / primary action / open state
        'accent-dark': v('--c-accent-dark'), // brand hover
        link: v('--c-link'), // hyperlink text (contrast-tuned per theme)
        gold: v('--c-gold'), // scheduled / warning
        danger: v('--c-danger'), // closed / error / destructive
      },
      fontFamily: {
        serif: ['Georgia', "'Iowan Old Style'", "'Times New Roman'", 'serif'],
        sans: [
          'Inter',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          "'Segoe UI'",
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
      },
      borderRadius: {
        DEFAULT: '3px',
        md: '4px',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '100% 0' },
          '100%': { backgroundPosition: '0 0' },
        },
        spin: { to: { transform: 'rotate(360deg)' } },
      },
      animation: {
        shimmer: 'shimmer 1.4s ease infinite',
        spin: 'spin 0.7s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
