# Deploy Bitchbende

GitHub Pages serves the website. Supabase runs the private room database and game
server. Computer games work without Supabase; friends on different devices need
both deployments.

Run commands from the project root. Replace `YOUR_GITHUB_USERNAME` and
`YOUR_PROJECT_REF` below. Keep passwords and access tokens in the CLI login
prompts; there is no need to paste them into chat.

## 1. Log in

GitHub CLI is already installed on this computer. Open its browser login and
allow access to repositories and workflow files:

```sh
gh auth login --hostname github.com --git-protocol https --web --scopes workflow
gh auth setup-git
```

Log in to [Supabase](https://supabase.com/dashboard), create a project named
**Bitchbende** in a free organization, choose a nearby region, and save its
database password. Its project reference is in the dashboard URL:
`https://supabase.com/dashboard/project/YOUR_PROJECT_REF`.

The Supabase CLI can run without a global installation:

```sh
npx --yes supabase@latest login
```

Complete the browser verification it opens. If the CLI asks for an access token,
create one in [Supabase account tokens](https://supabase.com/dashboard/account/tokens)
and enter it directly in the terminal. Once both logins are complete, Codex can
continue with the project reference; the database password may need to be
entered in a terminal prompt when linking.

## 2. Deploy the game server

Link the new project and apply the included database migration:

```sh
npx --yes supabase@latest link --project-ref YOUR_PROJECT_REF
npx --yes supabase@latest db push
npx --yes supabase@latest secrets set ALLOWED_ORIGIN=https://YOUR_GITHUB_USERNAME.github.io
npx --yes supabase@latest functions deploy game --use-api
```

Use only the website origin for `ALLOWED_ORIGIN`, with no trailing slash or
`/bitchbende` path. For a custom domain, use that domain's origin instead. The
`--use-api` bundler includes the shared engine outside `supabase/` without Docker.
The committed function config uses the game's private seat credentials.

Supabase supplies the server credentials automatically. The browser never needs
a secret or service-role key. See [server setup](../server/README.md) for database
permissions, room expiration, and optional cleanup.

## 3. Publish the website

Use a public repository named `bitchbende` for free GitHub Pages hosting. This
publishes the source and artwork. If a repository already exists, keep it and
push to its `main` branch; do not create another.

In the repository on GitHub:

1. Open **Settings → Secrets and variables → Actions → Variables**.
2. Add `VITE_ROOM_API_URL` with
   `https://YOUR_PROJECT_REF.supabase.co/functions/v1/game`.
3. Optionally add `VITE_SUPABASE_PUBLISHABLE_KEY` using the project's **publishable**
   key from Supabase **Settings → API Keys**. Never use a secret/service-role key.
4. Open **Settings → Pages** and set **Source** to **GitHub Actions**.
5. Push the project to `main`. If it was already pushed before configuring Pages,
   open **Actions → Test and deploy GitHub Pages → Run workflow**.

The included workflow runs tests and builds the website before deploying. Follow
the run in **Actions**; the deployment URL also appears in **Settings → Pages**.
With these names it will be `https://YOUR_GITHUB_USERNAME.github.io/bitchbende/`.

## 4. Test the public game

Open the published URL and start a computer game. Then create an online room,
copy its invitation link to another device or browser profile, join, and start
as host. Check that both players can cover their cards, take turns, and reconnect
after a refresh. Invitations retain the `/bitchbende/` path.

If computer games work but rooms fail, check the API variable, Supabase function
logs, and `ALLOWED_ORIGIN`. After changing a GitHub build variable, rerun the
Pages workflow so the browser receives the new value.

## Subsequent updates

Frontend changes deploy automatically when pushed to `main`:

```sh
npm test
npm run build
git push
```

When changing the shared game engine, room server, or Edge Function, also deploy
the backend with `npx --yes supabase@latest functions deploy game --use-api`.
Apply new database migrations with `npx --yes supabase@latest db push` before
deploying code that needs them. The current workflow deploys the frontend only.

Official references: [GitHub CLI login](https://cli.github.com/manual/gh_auth_login),
[GitHub Pages workflows and free hosting](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages),
[Supabase deployment](https://supabase.com/docs/guides/functions/deploy),
[CLI deployment flags](https://supabase.com/docs/reference/cli/supabase-functions-deploy),
and [shared imports with API bundling](https://github.com/orgs/supabase/discussions/33613).
