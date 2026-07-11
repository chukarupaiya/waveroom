# 🎧 JamSync

Collaborative, **lossless** jam sessions. Friends join a shared room and hear
the same FLAC track in near-perfect sync, routed through a Web Audio pipeline
(EQ, stereo width, optional concert-hall spatial reverb) with a live frequency
visualizer.

> **MVP scope:** rooms, real-time WebSocket sync, FLAC streaming with seek,
> queue + player + members, the full Web Audio pipeline, spatial-audio toggle,
> and visualizer are all working. Deeper polish (loaded impulse-response files,
> album-color glow extraction, gapless pre-buffering) is intentionally left for
> a second pass.

---

## Quick start (one command — Docker)

```bash
docker compose up --build
```

Then open **http://localhost:8080**.

- Frontend (nginx) serves the app and proxies `/api`, `/stream`, and `/ws` to
  the backend.
- The backend's `music/` folder is mounted as a volume, so songs you drop in
  appear without rebuilding.

Stop with `Ctrl-C`, or `docker compose down`.

---

## Adding songs

1. Drop `.flac` files into `backend/music/`.
2. Either restart the backend, or click **⟳ Rescan** in the room's Library
   panel (calls `POST /api/library/rescan`).

Metadata (title / artist / album / embedded album art) is read from FLAC tags
via `mutagen`. If a file has no tags, the filename is used — so name untagged
files `Artist - Title.flac`.

---

## Running without Docker (two terminals)

**Backend**

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt        # fastapi uvicorn mutagen websockets python-multipart
uvicorn main:app --reload --port 8000
```

**Frontend**

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173  (proxies API/WS to :8000)
```

---

## How sync works

The server holds the authoritative playback state (current track, position,
`is_playing`, and a `last_update` timestamp). On any play / pause / skip / seek
it broadcasts a `playback_sync` event including `server_time`. Each client
computes:

```
adjusted_position = position + (Date.now()/1000 - server_time)
```

and only hard-seeks its `<audio>` element when local drift exceeds ~0.6s, so
playback stays tight without constant re-seeking. Last write wins if two people
hit play at once.

---

## API

| Method | Route                       | Purpose                                  |
| ------ | --------------------------- | ---------------------------------------- |
| GET    | `/api/library`              | List FLAC tracks (+ base64 album art)    |
| POST   | `/api/library/rescan`       | Re-scan the `music/` folder              |
| GET    | `/api/rooms`                | List active rooms                        |
| POST   | `/api/rooms`                | Create a room → `{ roomId }`             |
| GET    | `/api/rooms/{id}`           | Room snapshot                            |
| GET    | `/stream/{filename}`        | Stream FLAC with HTTP range (seek)       |
| WS     | `/ws/{room_id}/{user_name}` | Per-user room socket                     |

**WebSocket events** — client → server: `add_to_queue`, `remove_from_queue`,
`reorder_queue`, `play`, `pause`, `seek`, `skip`, `track_ended`, `end_jam`.
Server → clients: `room_state`, `playback_sync`, `member_joined`,
`member_left`, `jam_ended`, `error`.

---

## Permissions

All members can add/remove from the queue, play, pause, skip, and reorder. Only
the **owner** (first to join, auto-transferred if they leave) can **End Jam**.

---

## Project layout

```
jamsynk/
├── backend/
│   ├── main.py            FastAPI app, routes, WebSocket hub, FLAC streaming
│   ├── room_manager.py    In-memory rooms, members, queue, playback state
│   ├── music_library.py   mutagen scanner → track metadata + album art
│   ├── music/             ← drop FLAC files here
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── pages/          Login, Lobby, Room
│   │   ├── components/     NowPlaying, Queue, MusicLibrary, AudioVisualizer,
│   │   │                   MembersList, SpatialAudioToggle, Background, …
│   │   └── hooks/          useWebSocket, useAudioEngine
│   ├── nginx.conf
│   └── Dockerfile
├── docker-compose.yml
└── README.md
```

---

## Notes & known limitations (MVP)

- The spatial-audio impulse response is **synthesized in-browser** (decaying
  noise) rather than loaded from a CDN IR file — zero external dependency, swap
  in a real `.wav` IR in `useAudioEngine.js` for production.
- Browsers require a user gesture before audio plays; the first play/add click
  unlocks the `AudioContext`.
- Room state is in-memory — restarting the backend clears all rooms (by design,
  no database).
- FLAC playback support varies by browser (Chrome/Edge/Firefox: yes; older
  Safari: limited).
