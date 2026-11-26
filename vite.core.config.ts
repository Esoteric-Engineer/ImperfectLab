import { globSync, readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import { buildInfo } from './buildInfo.ts'

const info = buildInfo()
const app = JSON.parse(readFileSync('package.json', 'utf8'))
const DEPS = ['@noble/hashes', 'fast-png', 'fflate']

const manifest: Plugin = {
  name: 'core-package-json',
  generateBundle() {
    if (info.commit === 'unknown') throw new Error('no git history: the package version would be wrong')
    this.emitFile({
      type: 'asset',
      fileName: 'package.json',
      source: JSON.stringify({
        name: '@nemesismods/imperfectlab-core',
        version: `${info.version}.0`,
        description: "ImperfectLab's character build pipeline and Marvel Nemesis file formats",
        license: 'MIT',
        repository: 'github:Esoteric-Engineer/ImperfectLab',
        type: 'module',
        sideEffects: false,
        exports: {
          './web': { types: './web/index.d.ts', import: './web/index.js' },
          './*': { types: './core/*.d.ts', import: './core/*.js' },
        },
        dependencies: Object.fromEntries(DEPS.map((d) => [d, app.dependencies[d]])),
      }, null, 2) + '\n',
    })
  },
}

export default defineConfig({
  define: { __BUILD_INFO__: JSON.stringify({ ...info, releases: [] }) },
  plugins: [manifest],
  build: {
    outDir: 'dist-core',
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    copyPublicDir: false,
    lib: {
      entry: globSync(['src/core/**/*.ts', 'src/web/*.ts']),
      formats: ['es'],
    },
    rolldownOptions: {
      external: (id) => DEPS.some((d) => id === d || id.startsWith(`${d}/`)),
      output: { preserveModules: true, preserveModulesRoot: 'src', entryFileNames: '[name].js' },
    },
  },
})