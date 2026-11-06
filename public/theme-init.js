// Applies the saved theme before first paint.
try {
  var theme = localStorage.getItem('imperfectlab.theme.v2')
  if (theme === null) {
    // One-time migration from v1 to v2. See src/ui/theme.ts
    var old = localStorage.getItem('imperfectlab.theme')
    if (old !== null) {
      theme = old === 'nemesis' ? 'nemesis-classic' : old
      localStorage.setItem('imperfectlab.theme.v2', theme)
      localStorage.removeItem('imperfectlab.theme')
    }
  }
  document.documentElement.dataset.theme = theme || 'dark'
} catch (e) { }