"""JamSync FastAPI app: REST routes, FLAC streaming, and the WebSocket hub.

Run:  uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from music_library import MusicLibrary
from room_manager import RoomManager

app = FastAPI(title="JamSync")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

library = MusicLibrary()
rooms = RoomManager()


# --------------------------------------------------------------------------
# WebSocket hub
# --------------------------------------------------------------------------

class Hub:
    """Tracks live sockets per room and broadcasts payloads."""

    def __init__(self) -> None:
        # room_id -> { user_name -> WebSocket }
        self.connections: dict[str, dict[str, WebSocket]] = {}

    def add(self, room_id: str, name: str, ws: WebSocket) -> None:
        self.connections.setdefault(room_id, {})[name] = ws

    def remove(self, room_id: str, name: str) -> None:
        conns = self.connections.get(room_id)
        if conns:
            conns.pop(name, None)
            if not conns:
                self.connections.pop(room_id, None)

    async def broadcast(self, room_id: str, payload: dict,
                        exclude: Optional[str] = None) -> None:
        conns = self.connections.get(room_id, {})
        dead: list[str] = []
        for name, ws in list(conns.items()):
            if name == exclude:
                continue
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(name)
        for name in dead:
            self.remove(room_id, name)

    async def send(self, room_id: str, name: str, payload: dict) -> None:
        ws = self.connections.get(room_id, {}).get(name)
        if ws is not None:
            try:
                await ws.send_json(payload)
            except Exception:
                self.remove(room_id, name)


hub = Hub()


async def broadcast_state(room_id: str) -> None:
    room = rooms.get_room(room_id)
    if room is not None:
        await hub.broadcast(room_id, room.snapshot())


# --------------------------------------------------------------------------
# REST routes
# --------------------------------------------------------------------------

class CreateRoomBody(BaseModel):
    name: str = ""


@app.get("/api/library")
def get_library():
    return {"tracks": library.list_tracks()}


@app.post("/api/library/rescan")
def rescan_library():
    library.rescan()
    return {"tracks": library.list_tracks(refresh=False)}


@app.get("/art/{track_id}")
def album_art(track_id: str):
    """Serve a track's cover art as raw bytes, aggressively cached.

    Tracks reference this via a short `/art/{id}` URL instead of carrying a
    base64 data URI, so cover art is sent once per client (then served from
    browser cache) and never travels over the WebSocket.
    """
    art = library.get_art(track_id)
    if art is None:
        raise HTTPException(status_code=404, detail="No art")
    mime, data = art
    return Response(
        content=data,
        media_type=mime,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@app.get("/api/rooms")
def get_rooms():
    return {"rooms": rooms.list_rooms()}


@app.post("/api/rooms")
def create_room(body: CreateRoomBody):
    room = rooms.create_room(body.name)
    return {"roomId": room.room_id, "name": room.name}


@app.get("/api/rooms/{room_id}")
def get_room(room_id: str):
    room = rooms.get_room(room_id)
    if room is None:
        raise HTTPException(status_code=404, detail="Room not found")
    return room.snapshot()


@app.get("/health")
def health():
    return {"ok": True, "time": time.time()}


# --------------------------------------------------------------------------
# Lyrics (synced) — fetched from LRCLIB (free, no API key) and cached in memory
# --------------------------------------------------------------------------

import json as _json
import re as _re
import urllib.parse as _urlparse
import urllib.request as _urlrequest

_LRC_LINE = _re.compile(r"\[(\d+):(\d+(?:\.\d+)?)\]")
# track_id -> {"synced": [...], "plain": str, "source": str}
_lyrics_cache: dict[str, dict] = {}


def _parse_lrc(lrc: str) -> list[dict]:
    """Parse an LRC string into [{"t": seconds, "text": str}] sorted by time.

    A single line may carry several timestamps ([..][..] text); each expands to
    its own entry. Blank lines are kept (as "") so instrumental gaps still show.
    """
    out: list[dict] = []
    for raw in lrc.splitlines():
        stamps = _LRC_LINE.findall(raw)
        if not stamps:
            continue
        text = _LRC_LINE.sub("", raw).strip()
        for mm, ss in stamps:
            out.append({"t": int(mm) * 60 + float(ss), "text": text})
    out.sort(key=lambda x: x["t"])
    return out


@app.get("/api/lyrics/{track_id}")
def lyrics(track_id: str):
    """Return time-synced + plain lyrics for a track.

    Shape: { "synced": [{"t": secs, "text": str}], "plain": str|None,
             "source": "lrclib"|"none" }
    `synced` is empty when only plain lyrics (or nothing) are available.
    """
    if track_id in _lyrics_cache:
        return _lyrics_cache[track_id]

    track = library.get_track(track_id)
    if track is None:
        raise HTTPException(status_code=404, detail="Track not found")

    artist = track.get("artist", "") or ""
    title = track.get("title", "") or ""
    album = track.get("album", "") or ""
    duration = int(track.get("duration", 0) or 0)

    data = _lrclib_get(artist, title, album, duration)
    if data is None:
        # Exact-match /get missed — fall back to a looser /search and take the
        # first hit that actually carries lyrics. Big coverage win for tracks
        # whose tags don't perfectly match LRCLIB's database.
        data = _lrclib_search(artist, title)

    result = {"synced": [], "plain": None, "source": "none"}
    if data is not None:
        synced_raw = data.get("syncedLyrics")
        plain = data.get("plainLyrics")
        if synced_raw:
            result = {"synced": _parse_lrc(synced_raw), "plain": plain,
                      "source": "lrclib"}
        elif plain:
            result = {"synced": [], "plain": plain, "source": "lrclib"}

    # Cache the outcome (including "no lyrics") so we don't re-hit LRCLIB on
    # every replay.
    _lyrics_cache[track_id] = result
    return result


def _lrclib_request(url: str):
    try:
        req = _urlrequest.Request(
            url, headers={"User-Agent": "JamSync (https://github.com/jamsync)"}
        )
        with _urlrequest.urlopen(req, timeout=8) as resp:
            return _json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None


def _lrclib_get(artist: str, title: str, album: str, duration: int):
    params = _urlparse.urlencode({
        "artist_name": artist,
        "track_name": title,
        "album_name": album,
        "duration": duration,
    })
    return _lrclib_request(f"https://lrclib.net/api/get?{params}")


def _lrclib_search(artist: str, title: str):
    params = _urlparse.urlencode({"track_name": title, "artist_name": artist})
    results = _lrclib_request(f"https://lrclib.net/api/search?{params}")
    if isinstance(results, list):
        for item in results:
            if item.get("syncedLyrics") or item.get("plainLyrics"):
                return item
    return None


# --------------------------------------------------------------------------
# FLAC streaming with HTTP range support (enables seeking)
# --------------------------------------------------------------------------

CHUNK = 1024 * 256


@app.get("/stream/{filename}")
def stream(filename: str, request: Request):
    path = library.resolve_path(filename)
    if path is None:
        raise HTTPException(status_code=404, detail="Track not found")

    stat = path.stat()
    file_size = stat.st_size
    # Strong validator so the browser can cache audio and revalidate seeks/
    # replays instead of re-downloading the whole FLAC each time.
    etag = f'"{file_size:x}-{int(stat.st_mtime):x}"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers={"ETag": etag,
                                                  "Cache-Control": "public, max-age=31536000, immutable"})
    range_header = request.headers.get("range")

    start, end = 0, file_size - 1
    status_code = 200
    if range_header:
        # format: "bytes=START-END"
        try:
            units, rng = range_header.split("=", 1)
            if units.strip() == "bytes":
                s, _, e = rng.partition("-")
                if s.strip():
                    start = int(s)
                if e.strip():
                    end = int(e)
                status_code = 206
        except ValueError:
            pass

    start = max(0, start)
    end = min(end, file_size - 1)
    length = end - start + 1

    def iter_file():
        with open(path, "rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                data = f.read(min(CHUNK, remaining))
                if not data:
                    break
                remaining -= len(data)
                yield data

    headers = {
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(length),
        "Content-Type": "audio/flac",
        # Audio files are immutable once dropped in; let the browser cache them
        # so seeking and replaying don't re-download. ETag enables 304s.
        "Cache-Control": "public, max-age=31536000, immutable",
        "ETag": etag,
    }
    return StreamingResponse(iter_file(), status_code=status_code,
                             headers=headers)


# --------------------------------------------------------------------------
# WebSocket endpoint
# --------------------------------------------------------------------------

async def handle_event(room_id: str, name: str, data: dict) -> None:
    event = data.get("event")
    room = rooms.get_room(room_id)
    if room is None:
        return

    if event == "add_to_queue":
        track = library.get_track(data.get("track_id", ""))
        if track:
            rooms.add_to_queue(room_id, track)
            await broadcast_state(room_id)

    elif event == "remove_from_queue":
        rooms.remove_from_queue(room_id, int(data.get("index", -1)))
        await broadcast_state(room_id)

    elif event == "reorder_queue":
        rooms.reorder_queue(room_id, int(data.get("old_index", -1)),
                            int(data.get("new_index", -1)))
        await broadcast_state(room_id)

    elif event == "play":
        pos = float(data.get("position", room.playback.effective_position()))
        rooms.set_playback(room_id, is_playing=True, position=pos)
        await broadcast_sync(room_id)

    elif event == "pause":
        pos = float(data.get("position", room.playback.effective_position()))
        rooms.set_playback(room_id, is_playing=False, position=pos)
        await broadcast_sync(room_id)

    elif event == "seek":
        pos = float(data.get("position", 0.0))
        rooms.set_playback(room_id, is_playing=room.playback.is_playing,
                           position=pos)
        await broadcast_sync(room_id)

    elif event == "skip":
        rooms.skip(room_id)
        await broadcast_state(room_id)
        await broadcast_sync(room_id)

    elif event == "track_ended":
        # client reports its track finished; advance authoritative state
        rooms.skip(room_id)
        await broadcast_state(room_id)
        await broadcast_sync(room_id)

    elif event == "end_jam":
        member = room.members.get(name)
        if member and member.is_owner:
            await hub.broadcast(room_id, {"event": "jam_ended"})
            rooms.end_room(room_id)


async def broadcast_sync(room_id: str) -> None:
    room = rooms.get_room(room_id)
    if room is None:
        return
    track = room.playback.current_track
    await hub.broadcast(room_id, {
        "event": "playback_sync",
        "is_playing": room.playback.is_playing,
        "track_id": track["id"] if track else None,
        "current_track": track,
        "position": room.playback.effective_position(),
        "server_time": time.time(),
    })


@app.websocket("/ws/{room_id}/{user_name}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, user_name: str):
    await websocket.accept()

    room = rooms.join(room_id, user_name)
    if room is None:
        await websocket.send_json({"event": "error",
                                   "message": "Room not found"})
        await websocket.close()
        return

    hub.add(room_id, user_name, websocket)

    # send current state immediately (covers reconnect)
    await websocket.send_json(room.snapshot())
    await hub.broadcast(room_id, {"event": "member_joined", "name": user_name},
                        exclude=user_name)
    await broadcast_state(room_id)

    try:
        while True:
            data = await websocket.receive_json()
            await handle_event(room_id, user_name, data)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        # Only tear down if THIS socket is still the registered one. A second
        # connection for the same user (React StrictMode double-mount, or a
        # reconnect) replaces this socket in the hub; when the stale socket
        # then closes it must NOT evict the live socket or end the room.
        current = hub.connections.get(room_id, {}).get(user_name)
        if current is websocket:
            hub.remove(room_id, user_name)
            still = rooms.leave(room_id, user_name)
            if still is not None:
                await hub.broadcast(room_id,
                                    {"event": "member_left", "name": user_name})
                await broadcast_state(room_id)


# --------------------------------------------------------------------------
# Serve the built frontend (single-container production deploy).
# In dev (no build present) this falls back to a status JSON at "/".
# API/WS/stream/health routes are registered above, so they take precedence
# over the SPA catch-all below.
# --------------------------------------------------------------------------

FRONTEND_DIR = Path(__file__).resolve().parent / "static"

if FRONTEND_DIR.is_dir():
    app.mount(
        "/assets",
        StaticFiles(directory=FRONTEND_DIR / "assets"),
        name="assets",
    )

    @app.get("/{full_path:path}")
    async def spa(full_path: str):
        candidate = FRONTEND_DIR / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(FRONTEND_DIR / "index.html")

else:

    @app.get("/")
    def root():
        return JSONResponse({"app": "JamSync", "status": "running"})
