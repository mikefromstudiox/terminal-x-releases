/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          primary:      '#0C447C',
          'active-bg':  '#f0f6ff',
          'active-bdr': '#378ADD',
          success:      '#3B6D11',
          warning:      '#854F0B',
          danger:       '#A32D2D',
        },
        page: '#f0f2f5',
      },
    },
  },
  plugins: [],
}
