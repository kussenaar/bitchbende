import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { GameView, PublicCardMove } from '../game/types'

type MovingAction = Extract<PublicCardMove, { type: 'replace' | 'swap' }>
export type PresentedMove = { id: string; move: MovingAction; scoringIndex?: number }

/** Presentation is local to each viewer; authoritative scoring stays immediate. */
export function useCardPresentation(view: GameView) {
  const over = view.phase === 'round-over' || view.phase === 'game-over'
  const cursor = useRef({ round: view.round, id: Math.max(0, ...view.log.map((entry) => entry.id)), resultSeen: over })
  const [presentation, setPresentation] = useState(() => ({
    round: view.round,
    moves: [] as PresentedMove[],
    scoringComplete: over ? view.roundResult?.replacements.length ?? 0 : 0,
    resultSeen: over,
    resultIsNew: false,
  }))

  useLayoutEffect(() => {
    const latestId = Math.max(cursor.current.id, ...view.log.map((entry) => entry.id))
    if (cursor.current.round !== view.round) {
      cursor.current = { round: view.round, id: latestId, resultSeen: over }
      setPresentation({ round: view.round, moves: [], scoringComplete: over ? view.roundResult?.replacements.length ?? 0 : 0, resultSeen: over, resultIsNew: false })
      return
    }
    const fresh: PresentedMove[] = view.log
      .filter((entry) => entry.id > cursor.current.id && entry.round === view.round && (entry.move?.type === 'replace' || entry.move?.type === 'swap'))
      .sort((a, b) => a.id - b.id).slice(-8)
      .map((entry) => ({ id: `move-${entry.id}`, move: entry.move as MovingAction }))
    const newResult = over && !cursor.current.resultSeen && view.roundResult !== null
    if (newResult) {
      view.roundResult!.replacements.forEach((replacement, scoringIndex) => fresh.push({
        id: `score-${view.round}-${scoringIndex}`,
        scoringIndex,
        move: { type: 'replace', revision: view.revision, playerId: replacement.playerId, slot: replacement.slot, source: 'deck', incoming: replacement.to, discarded: replacement.from },
      }))
    }
    cursor.current.id = latestId
    if (newResult) cursor.current.resultSeen = true
    if (fresh.length || newResult) setPresentation((current) => ({ ...current, moves: [...current.moves, ...fresh], resultSeen: current.resultSeen || newResult, resultIsNew: current.resultIsNew || newResult }))
  }, [view, over])

  const land = useCallback((move: PresentedMove) => {
    if (move.scoringIndex === undefined) return
    setPresentation((current) => ({ ...current, scoringComplete: Math.max(current.scoringComplete, move.scoringIndex! + 1) }))
  }, [])
  const finish = useCallback((move: PresentedMove) => {
    setPresentation((current) => current.moves[0]?.id === move.id ? {
      ...current,
      moves: current.moves.slice(1),
      scoringComplete: move.scoringIndex === undefined ? current.scoringComplete : Math.max(current.scoringComplete, move.scoringIndex + 1),
    } : current)
  }, [])

  const scoringComplete = presentation.round === view.round ? presentation.scoringComplete : 0
  return {
    active: presentation.moves[0],
    animating: presentation.moves.length > 0,
    scoringComplete,
    resultIsNew: presentation.resultIsNew,
    resultReady: over && presentation.round === view.round && presentation.resultSeen && presentation.moves.length === 0,
    // Keep original power faces on the table until their replacement lands.
    players: view.players.map((player) => ({ ...player, hand: player.hand.map((card, slot) => {
      const pending = over ? view.roundResult?.replacements.find((entry, index) => index >= scoringComplete && entry.playerId === player.id && entry.slot === slot) : undefined
      return pending?.from ?? card
    }) })),
    land,
    finish,
  }
}
