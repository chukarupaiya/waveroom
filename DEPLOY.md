# Deploying JamSync to Render (free tier)

The app is now a **single Docker container**: FastAPI serves the built React
frontend plus the `/api`, `/ws`, and `/stream` routes on one port. Render's
free plan runs exactly one web service, which is all this needs.

## 1. Push the repo to GitHub

A git repo is already initialized and committed in this folder. Create an empty
GitHub repo (e.g. `jamsync`), then:

```bash
cd jamsynk
git remote add origin https://github.com/<your-username>/jamsync.git
git branch -M main
git push -u origin main
```

The 9 FLAC files (~430 MB) are committed and will push too. The largest is
~86 MB, under GitHub's 100 MB per-file limit, so a normal push works (it'll just
take a minute).

## 2. Deploy on Render

1. Go to https://dashboard.render.com → **New +** → **Blueprint**.
2. Connect your GitHub and pick the `jamsync` repo. Render reads `render.yaml`
   and configures a free Docker web service automatically.
3. Click **Apply**. First build takes ~5-10 min (Node build + Python deps +
   copying the music).
4. When it goes live you get a URL like `https://jamsync.onrender.com`.

(If you'd rather not use the Blueprint: **New +** → **Web Service** → pick the
repo → Runtime **Docker** → Plan **Free** → Create. Same result.)

## 3. Share with your 2-4 friends

Send them the `onrender.com` URL. Each person enters a name, then creates or
joins a room. WebSockets work on Render with no extra setup.

## Free-tier things to know

- **Sleeps after 15 min idle.** The first visitor after a quiet spell waits
  ~50 s for it to wake. Once awake it's snappy for everyone.
- **Rooms are in-memory**, so a sleep/restart clears active rooms — just rejoin.
  (This was already true by design; no database.)
- **Adding songs later:** drop `.flac` files in `backend/music/`, commit, and
  `git push` — Render auto-redeploys.
```bash
git add backend/music && git commit -m "add songs" && git push
```
