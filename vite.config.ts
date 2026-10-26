import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { define } from './buildInfo'

export default defineConfig({
  base: './',
  define,
  plugins: [react()],
  worker: { format: 'es' },
})
