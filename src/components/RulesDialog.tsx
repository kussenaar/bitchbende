import { Dialog } from './Dialog'
import { Icon } from './Icon'

export function RulesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="How to play" wide>
      <p className="rules-intro">Keep the total value of your four cards as low as possible. The player with the lowest total score after all rounds wins.</p>
      <div className="rules-grid">
        <div className="rule-step"><span className="step-number">01</span><h3>Starting cards</h3><p>Everyone gets four face-down cards. At the start of each round, look at your two outside cards, then turn them face down again.</p></div>
        <div className="rule-step"><span className="step-number">02</span><h3>Draw or take the discard</h3><p>Take the top number card from the discard pile to replace one of your cards, or draw from the deck. A drawn card can replace one of yours, be discarded, or use its power. Replaced cards go face up on top of the discard pile, where the next player can take them.</p></div>
        <div className="rule-step"><span className="step-number">03</span><h3>Card powers</h3><p>Powers work only when drawn from the deck. A power in your hand stays face down and has no effect. You can’t take a power from the discard pile.</p></div>
        <div className="rule-step"><span className="step-number">04</span><h3>Ending a round</h3><p>Call Bitchbende at the end of your turn when you expect to have the lowest total. Everyone else gets exactly one last turn, then all cards are revealed. There’s no penalty for calling and losing.</p></div>
      </div>
      <div className="power-guide">
        <div><span className="power-symbol"><Icon name="eye" /></span><div><h3>Peek <small>7 cards</small></h3><p>Privately look at one of your own cards, then turn it back over.</p></div></div>
        <div><span className="power-symbol"><Icon name="swap" /></span><div><h3>Swap <small>9 cards</small></h3><p>Swap one of yours with another player’s card, without looking at either. You may skip the swap.</p></div></div>
        <div><span className="power-symbol"><Icon name="draw" /></span><div><h3>Draw two <small>5 cards</small></h3><p>Draw a card. Use it and stop, or discard it to draw one more. The second can be used or discarded. Using a new Draw two restarts the sequence.</p></div></div>
      </div>
      <div className="rules-scoring"><Icon name="trophy" size={24} /><div><h3>Scoring</h3><p>Add all four card values at the end of each round. Any powers still in a hand are replaced from the deck until a number appears. Lowest total after the selected number of rounds wins; ties share the win.</p></div></div>
      <p className="rules-footnote">The deck has 66 cards: four of each number 0–8, nine 9s, and 21 powers. Based on the supplied Beverbende rules. Play with two to four players: choose one to three computers, or invite friends to an online room.</p>
      <button className="button button-primary rules-dismiss" onClick={onClose}>Close rules <Icon name="arrow" size={17} /></button>
    </Dialog>
  )
}
