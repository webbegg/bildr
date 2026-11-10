/** `Served from` → `servedFrom`: the key a new field gets from its label (the inverse of `fieldLabel`); '' when nothing is left. */
export function fieldKey(label: string): string {
  const words = label
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
  if (!words.length) return ''
  const key = words.map((word, i) => (i ? word.charAt(0).toUpperCase() + word.slice(1) : word)).join('').slice(0, 64)
  if (key === 'id') return 'idField'
  return /^[a-z]/.test(key) ? key : `f${key}`.slice(0, 64)
}
