# Bitchbende

[Play Bitchbende](https://kussenaar.github.io/bitchbende/)

React, TypeScript, and Vite card game for **2–4 players**. Play against one to three computers, or create a friends-only online room. The host starts when everyone has joined; invite by code or link. Computers remember observed cards, protect low values, and use powers and discards strategically.

Computers call Bitchbende only after remembering all four number cards with a total under 10. They call promptly with strong hands and sometimes wait for another improvement at 7–9 points, while considering what they know about opponents.

The computers are Lisa, Chanah, and Clara. Lisa favors safer gains, Chanah balances caution and risk, and Clara gambles more. They vary close decisions, choose between equally useful cards, and compare Draw Two improvements with the expected second draw. They only use information they have observed.

## Local play

Use Node.js 24 or newer:

```sh
npm install
npm run dev
```

One command starts Vite and the local room server. Open the printed URL. Choose the number of computers, or select **Create or join a room**. To test friends on one computer, use separate browser profiles or private windows. Local rooms are held in memory and disappear when the server stops. Computer matches and online seat credentials survive a page refresh.

Every round starts with an empty discard pile, so the first player draws from the deck. Memorize your outside cards, then hide them. Draw or take the face-up numeric discard once one exists. Click a hand card to replace, peek, or swap. Call Bitchbende after your move to give everyone else one final turn. The call triggers a large visual alarm and a short siren; sound can be muted in the header. Reduced-motion settings disable the blinking and movement.

Replacements and swaps animate between numbered card positions, with a brief pause before computers continue. Blind swaps stay face down. Position numbers remain visible when choosing a swap, including on phones.

Activity records actions and player names without keeping card values or positions. Public cards and swap positions are visible as the moves happen, so players need to remember them.

Optional separate processes: `npm run dev:client` and `npm run dev:server`. To test from a phone on the same network, run `npm run dev -- --host 0.0.0.0` and set the room server's `ALLOWED_ORIGIN` to the printed network origin. Internet rooms need the Supabase deployment below.

## Validation

```sh
npm test
npm run build
```

The engine tests cover the exact 66-card deck, hidden information, every power, turns, final turns, scores, save validation, bot strategy, and complete 2–4-player matches. Room tests cover authentication, safe views, host controls, capacity, expiration, and competing commands. The build also typechecks the server. `npm run preview` previews the production frontend; online play requires its configured room API.

## Architecture and rules

- `src/game/engine.ts`: shared immutable game transitions, scoring, safe player views, and computer strategy.
- `src/game/session.ts`: local session and transport interface.
- `src/game/online.ts`: HTTP session holding only the authenticated player's safe view.
- `server/rooms.ts`: authoritative room handler, shared by local Node and Supabase Edge.
- `server/supabase-repository.ts`: atomic revision checks and private durable room storage.
- `src/components/`: lobbies, invitation flow, cards, call alarm, dialogs, and rules.
- `public/`: supplied card-back, Swap, Peek, Draw two, and beaver images; every hidden card uses the same card-back artwork, and the beaver appears throughout the interface and as the browser icon.

All three pages of the supplied `spelregels-beverbende.pdf` were read. The requested `game-rules.pdf` was absent; the attached PDF was used. See [extracted source](docs/rules-source.txt) and [rules and decisions](docs/rules.md). The deck contains four each of 0–8, nine 9s, nine Swap, seven Peek, and five Draw two cards. Default six rounds; ties share the win. Timed games, elimination, and the younger-player variant are not implemented.

Online state stays on the server, which uses cryptographic shuffles. Browsers receive no deck order, other hands, random seed, or computer knowledge. Seat tokens are private and separate from invitation codes. Online rooms contain only human players, up to four. Refresh or reopen on the same browser to recover a seat. Leaving during play disconnects while reserving your hand; there is no automatic replacement or host takeover during an active match. Room updates poll once per second while visible, with retry/backoff after connection loss.

## Production: GitHub Pages + Supabase

Follow the [deployment guide](docs/deployment.md) for the login commands, Supabase setup, GitHub settings, and a public-game check. GitHub Pages serves the frontend; Supabase runs the authoritative room server. Free GitHub Pages hosting uses a public repository.

1. Deploy the private database and Edge Function using [server setup](server/README.md). Set its `ALLOWED_ORIGIN` to your website's origin.
2. In your GitHub repository, set the Actions variable `VITE_ROOM_API_URL` to `https://YOUR_PROJECT_REF.supabase.co/functions/v1/game`. Optionally set `VITE_SUPABASE_PUBLISHABLE_KEY` to a **public publishable** key. Never place secret/service-role keys in `VITE_` variables.
3. In **Settings → Pages**, choose **GitHub Actions**. Push to `main` or run the included [Pages workflow](.github/workflows/pages.yml). It tests, builds, and deploys `dist/`.

Vite uses relative paths for repository subpaths, and invitation links retain the deployed path. Without a configured API, the published site still supports computer games and explains that online rooms are unavailable. Supabase stores rooms durably and expires inactive rooms after seven days; optional database cleanup is documented with the server setup.

Local manual builds can use `.env.local` based on [.env.example](.env.example). The frontend is static; GitHub Pages does not run the game server.

References: [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) and [Supabase Edge Functions](https://supabase.com/docs/guides/functions).
