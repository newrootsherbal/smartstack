// The stored theme before the first paint; the app applies it again once loaded.
// An external file (not inline) so the Content-Security-Policy can forbid inline scripts.
try {
  var stored = JSON.parse(localStorage.getItem('smartstack:v1') || 'null')
  if (stored && typeof stored.theme === 'string') {
    document.documentElement.setAttribute('data-theme', stored.theme)
  }
} catch {
  // Private mode or blocked storage: the default theme paints.
}
