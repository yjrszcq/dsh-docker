try {
  const theme = localStorage.getItem('dsh-platform:console-theme')
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme
} catch {}
