import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { define } from './buildInfo.ts'

export default defineConfig({
  base: process.env.SUITE_BASE ?? './',
  define,
  plugins: [react()],
  worker: { format: 'es' },
})