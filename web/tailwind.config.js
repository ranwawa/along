/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'bg-primary': '#0f111a',
        'bg-secondary': '#1a1d27',
        'bg-glass': 'rgba(26, 29, 39, 0.7)',
        'border-color': 'rgba(255, 255, 255, 0.08)',
        
        'text-primary': '#e6e6e6',
        'text-secondary': '#a0aab8',
        'text-muted': '#6b7280',
        
        'brand': '#6366f1',
        'brand-hover': '#4f46e5',
        
        'status-running': '#3b82f6',
        'status-completed': '#10b981',
        'status-error': '#ef4444',
        'status-crashed': '#f97316',
        'status-zombie': '#8b5cf6',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
