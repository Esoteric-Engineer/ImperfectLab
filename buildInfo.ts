import { execFileSync } from 'node:child_process'

const MAJOR = 1
const RELEASE_COUNT = 20

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim()
const lines = (text: string) => (text ? text.split('\n') : [])

export function buildInfo() {
  try {
    if (git('rev-parse', '--is-shallow-repository') === 'true') git('fetch', '--unshallow')
    const total = Number(git('rev-list', '--first-parent', '--count', 'HEAD'))
    const releases = lines(git('log', '--first-parent', `-n${RELEASE_COUNT}`, '--format=%H\t%P\t%cs\t%s')).map((line, i) => {
      const [hash, parents, date, ...subject] = line.split('\t')
      const [base, merged] = parents.split(' ')
      const changes = merged
        ? lines(git('log', '--no-merges', '--reverse', '--format=%h\t%s', `${base}..${merged}`)).map((l) => {
          const [h, ...s] = l.split('\t')
          return { hash: h, subject: s.join('\t') }
        })
        : []
      const pr = /^Merge pull request #(\d+)/.exec(subject.join('\t'))?.[1]
      return {
        version: `${MAJOR}.${total - i}`,
        hash,
        pr: pr ? Number(pr) : null,
        date,
        changes: changes.length ? changes : [{ hash: hash.slice(0, 7), subject: subject.join('\t') }],
      }
    })
    return { version: `${MAJOR}.${total}`, commit: git('rev-parse', '--short', 'HEAD'), releases }
  } catch {
    return { version: `${MAJOR}.0`, commit: 'unknown', releases: [] }
  }
}

export const define = { __BUILD_INFO__: JSON.stringify(buildInfo()) }
