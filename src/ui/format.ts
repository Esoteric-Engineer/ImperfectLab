export function titleCase(s: string): string {
  return s.replace(/[A-Za-z]+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
}
