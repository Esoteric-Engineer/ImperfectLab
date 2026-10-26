declare const __BUILD_INFO__: {
  version: string
  commit: string
  releases: { version: string, hash: string, pr: number | null, date: string, changes: { hash: string, subject: string }[] }[]
}

export const VERSION = __BUILD_INFO__.version
export const COMMIT = __BUILD_INFO__.commit
export const RELEASES = __BUILD_INFO__.releases

export const REPO_URL = 'https://github.com/Esoteric-Engineer/ImperfectLab'
