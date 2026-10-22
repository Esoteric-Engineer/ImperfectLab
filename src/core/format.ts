export function formatG(x: number, precision = 6): string {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? 'nan' : x > 0 ? 'inf' : '-inf'
  if (x === 0) return Object.is(x, -0) ? '-0' : '0'
  const exp = Math.floor(Math.log10(Math.abs(Number(x.toPrecision(precision)))))
  if (exp < -4 || exp >= precision) {
    const [m, e] = x.toExponential(precision - 1).split('e')
    const mant = m.includes('.') ? m.replace(/\.?0+$/, '') : m
    const n = parseInt(e, 10)
    return `${mant}e${n < 0 ? '-' : '+'}${String(Math.abs(n)).padStart(2, '0')}`
  }
  const s = x.toFixed(Math.max(0, precision - 1 - exp))
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}

export function percent0(x: number): string {
  return `${Math.round(x)}%`
}
