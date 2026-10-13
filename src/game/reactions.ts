export const REACTION_IMAGES = [
  { id: 'reaction-1', file: 'IMG_7761-removebg-preview.png', label: 'Mama mia!' },
  { id: 'reaction-2', file: 'IMG_7762-removebg-preview.png', label: 'Boeit me niet, tongue out' },
  { id: 'reaction-3', file: 'IMG_7763.jpg', label: 'Facepalm' },
  { id: 'reaction-4', file: 'IMG_7764-removebg-preview.png', label: 'Crying' },
  { id: 'reaction-5', file: 'IMG_7765-removebg-preview.png', label: 'Side eye' },
  { id: 'reaction-6', file: 'IMG_7766.jpg', label: 'Wat denk jij nou?' },
  { id: 'reaction-7', file: 'IMG_7767-Photoroom.png', label: 'Zie je wel' },
  { id: 'reaction-8', file: 'IMG_7768-removebg-preview.png', label: 'Boeit me niet, shrug' },
] as const

export type ReactionId = typeof REACTION_IMAGES[number]['id']
export type TableReaction = { id: string; playerId: string; imageId: ReactionId; createdAt: number }
export const REACTION_LIFETIME_MS = 10_000
export const REACTION_COOLDOWN_MS = 1_500

export function isReactionId(value: unknown): value is ReactionId {
  return REACTION_IMAGES.some((image) => image.id === value)
}
