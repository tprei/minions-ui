export const CONNECTION_PALETTE = [
  '#3b82f6',
  '#10b981',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#ec4899',
  '#14b8a6',
  '#f97316',
] as const

export type PaletteColor = (typeof CONNECTION_PALETTE)[number]

export function nextColor(taken: string[]): string {
  for (const color of CONNECTION_PALETTE) {
    if (!taken.includes(color)) return color
  }
  return CONNECTION_PALETTE[taken.length % CONNECTION_PALETTE.length]
}
