/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}' // ✅ include App.tsx, Login.tsx
  ],
  theme: { extend: {} },
  plugins: [],
}
