import { writeFileSync } from 'node:fs'
import { describe, it } from 'vitest'
import * as imperfect from '../src/core/package/imperfect'
import { fixtureA, fixtureB } from './fixtures'
import { gameSource, ISO } from './helpers'

describe.skipIf(!ISO || !process.env.IMPERFECTLAB_WRITE_FIXTURES)('fixtures', () => {
  it('writes the parity fixtures', () => {
    writeFileSync(new URL('./fixtures/parity_a.imperfect', import.meta.url), imperfect.save(fixtureA(gameSource())))
    writeFileSync(new URL('./fixtures/parity_b.imperfect', import.meta.url), imperfect.save(fixtureB(gameSource())))
  })
})
