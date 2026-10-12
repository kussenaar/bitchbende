# Rules used by this version

Primary source: the user-provided [`spelregels-beverbende.pdf`](/Users/lieve/Downloads/spelregels-beverbende.pdf), all three pages read. The complete extracted text is in [rules-source.txt](rules-source.txt). The requested `game-rules.pdf` filename was not present; the supplied PDF was used instead. Document content was treated as game rules, not as instructions for the coding agent.

## Implemented rules checklist

- Deal four cards, one at a time, clockwise from the dealer's left. Place them in a horizontal row.
- Start each round with an empty discard pile. The first player draws from the deck. This follows the user's requested rule and overrides the PDF's opening face-up card.
- Each player privately looks at the two outer cards once, then covers them. Other cards stay hidden; this is a memory game.
- The dealer's left neighbor starts. Turns proceed clockwise.
- Whenever a drawn card replaces one of your four cards, put the replaced card face up on top of the discard pile, visible to everyone. The next player can take that exact card if it is a number, or draw from the face-down deck instead.
- Taking the top number from the discard pile requires replacing one of your four cards; it cannot simply be discarded again.
- A deck draw can replace a card, be discarded, or activate a power. Per the supplied PDF, a deck-drawn power may also be kept as a replacement card, but its power is then unavailable.
- Only powers drawn from the deck can activate. Dealt powers and powers in players' rows have no active effect.
- **Peek:** privately see one of your own cards, then cover it and end the action.
- **Swap:** optionally swap one own card with one opponent card, without looking at either. This power exchanges two hidden cards between players; it is separate from replacing a hand card with a drawn card.
- **Draw Two:** use the first drawn card and forfeit the second draw, or discard it and draw once more. Use or discard the second card. Activating another Draw Two restarts this sequence; it does not stack additional draws.
- When the deck empties, shuffle discards to make a new deck and retain a face-up number discard.
- Only after completing a turn's action, a player may knock. Every other player gets exactly one final turn. The caller gets no additional turn, and a second knock cannot restart final turns.
- Reveal all rows after those final turns. Replace each remaining power with deck draws until a number appears, discarding rejected powers without activating them.
- Add the four numbers to each player's round score, then add that score to their match total. No knock penalty or automatic zero score is present in the source.
- Rotate the dealer and shuffle all cards for the next round. Lowest total wins.

## Choices where the supplied PDF is silent

- **Deck composition:** standard 66 cards: four each of 0–8, nine 9s, nine Swap, seven Peek, five Draw Two. This is 45 number cards plus 21 powers, confirmed against the user's supplied Spellenwijs excerpt. The supplied PDF omits counts; these are also documented by [the same PDF's host](https://portfolio.aletho.nl/spelletjes/beverbende/) and a [game retailer's full component description](https://rerollworks.com/products/beverbende-dutch-999-bev01). [Publisher gameplay overview](https://www.999games.nl/product/beverbende/8717249193050).
- **Match length:** use the source's fixed-round mode, with a default of six rounds. Fixed rounds are configurable in `createGame`; the source does not prescribe six.
- **Ties:** equal lowest scores share the round or match win. No tiebreaker is specified.
- **Power on discard:** cannot be taken. This follows the source's statement that discarded powers cannot be used by another player and the standard game's number-only discard choice.
- **Recycling with a power on top:** retain the most recently discarded number, and shuffle all other discards. If no number exists, retain the top power until a number is later discarded. This resolves the PDF's requirement to retain one number, while preserving a number already on top in the usual case.
- **Scoring replacement order:** caller first, then clockwise. The supplied PDF gives no order.
- **Optional powers:** Peek and Swap may be skipped. Draw Two can be discarded before activation, as with every deck draw.
- The source's alternative timed and elimination modes, and its young-player variant, are outside this first version.

## Multiplayer boundary

`applyAction(state, actorId, action)` performs serializable, validated transitions. Local games use reproducible seeded shuffles; the online server injects fresh cryptographic shuffles for dealing, recycling, and scoring. `getPlayerView(state, viewerId)` is the only state shape a multiplayer server sends to that player: unknown hands contain `null`, other players' drawn cards stay hidden, and deck order, RNG state, and bot memories are excluded. Every successful action increments `revision` for optimistic concurrency checks.

Computer games keep authoritative state in this browser. Online rooms run the same engine on the room server, authenticate private seat credentials, and return only each player's safe view. Database writes compare room revisions atomically. Online rooms contain two to four humans; the host chooses when to start and advances rounds.
