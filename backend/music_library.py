"""Scans the ./music folder for FLAC files and reads metadata via mutagen.

Album art is returned as a base64 data URI so the frontend can render it
directly. The library re-scans on demand (cheap for small libraries) and
also exposes a manual rescan() for a watch endpoint.
"""

from __future__ import annotations

import base64
import os
from pathlib import Path
from typing import Optional

try:
    from mutagen.flac import FLAC, Picture
    from mutagen import MutagenError
except Exception:  # pragma: no cover - mutagen missing at import time
    FLAC = None
    Picture = None
    MutagenError = Exception

# Music now lives at the repo root (../music) so it sits alongside backend/ and
# frontend/. Overridable via MUSIC_DIR for containers/tests.
MUSIC_DIR = Path(os.environ.get("MUSIC_DIR", Path(__file__).parent.parent / "music"))
SUPPORTED_EXT = {".flac"}

# Public base URL of the R2 bucket's CDN (e.g. https://cdn.waveroom.com or the
# temporary *.r2.dev URL). When set, each track exposes an r2_url the frontend
# prefers; the local /stream endpoint remains as a fallback. Empty => R2 off.
R2_PUBLIC_BASE = os.environ.get("R2_PUBLIC_BASE", "").rstrip("/")
# Object key prefix under which songs live in the bucket (matches how they were
# uploaded). Default "music" mirrors the local /music folder. Set "" for root.
R2_SONGS_PREFIX = os.environ.get("R2_SONGS_PREFIX", "music").strip("/")


def _r2_url(filename: str) -> Optional[str]:
    if not R2_PUBLIC_BASE:
        return None
    from urllib.parse import quote
    prefix = f"{R2_SONGS_PREFIX}/" if R2_SONGS_PREFIX else ""
    return f"{R2_PUBLIC_BASE}/{prefix}{quote(filename)}"


def _track_id(filename: str) -> str:
    return base64.urlsafe_b64encode(filename.encode()).decode().rstrip("=")


def _decode_track_id(track_id: str) -> str:
    pad = "=" * (-len(track_id) % 4)
    return base64.urlsafe_b64decode(track_id + pad).decode()


def _album_art_raw(audio) -> tuple[Optional[str], Optional[bytes]]:
    """Return (mime, raw image bytes) for the embedded cover, or (None, None).

    Art is served from a dedicated, cacheable /art endpoint rather than being
    inlined as a base64 data URI — inlining made every track dict huge and was
    re-broadcast over the WebSocket on every room_state update.
    """
    if not audio.pictures:
        return None, None
    pic = audio.pictures[0]
    return (pic.mime or "image/jpeg"), pic.data


def _parse_from_filename(filename: str) -> tuple[str, str]:
    """Fallback: 'artist - title.flac' -> (artist, title)."""
    stem = Path(filename).stem
    if " - " in stem:
        artist, title = stem.split(" - ", 1)
        return artist.strip(), title.strip()
    return "Unknown Artist", stem.strip()


def _read_track(path: Path) -> Optional[dict]:
    filename = path.name
    fallback_artist, fallback_title = _parse_from_filename(filename)

    title, artist, album, duration = (
        fallback_title, fallback_artist, "", 0.0,
    )
    art_mime, art_data = None, None

    if FLAC is not None:
        try:
            audio = FLAC(str(path))
            title = (audio.get("title", [fallback_title]) or [fallback_title])[0]
            artist = (audio.get("artist", [fallback_artist]) or [fallback_artist])[0]
            album = (audio.get("album", [""]) or [""])[0]
            if audio.info is not None:
                duration = float(audio.info.length)
            art_mime, art_data = _album_art_raw(audio)
        except MutagenError:
            return None
        except Exception:
            # corrupt file — surface filename-based metadata anyway
            pass

    track_id = _track_id(filename)
    from urllib.parse import quote
    return {
        "id": track_id,
        "filename": filename,
        "name": f"{artist} — {title}",
        "title": title,
        "artist": artist,
        "album": album,
        "duration": round(duration, 2),
        # Primary source: R2 CDN (zero egress). None when R2 isn't configured.
        "r2_url": _r2_url(filename),
        # Fallback source: backend serves the local FLAC from /music.
        "stream_url": f"/stream/{quote(filename)}",
        # Lightweight URL to the cacheable art endpoint, not a base64 blob.
        "album_art": f"/art/{track_id}" if art_data else None,
        "lossless": True,
        # Raw bytes are split out into MusicLibrary._art during rescan and
        # never sent in a track dict / over the WebSocket.
        "_art": (art_mime, art_data) if art_data else None,
    }


class MusicLibrary:
    def __init__(self, music_dir: Path = MUSIC_DIR) -> None:
        self.music_dir = music_dir
        self.music_dir.mkdir(parents=True, exist_ok=True)
        self._tracks: dict[str, dict] = {}
        self._art: dict[str, tuple[str, bytes]] = {}
        self.rescan()

    def rescan(self) -> None:
        tracks: dict[str, dict] = {}
        arts: dict[str, tuple[str, bytes]] = {}
        for entry in sorted(self.music_dir.iterdir()):
            if entry.is_file() and entry.suffix.lower() in SUPPORTED_EXT:
                track = _read_track(entry)
                if track:
                    art = track.pop("_art", None)
                    if art:
                        arts[track["id"]] = art
                    tracks[track["id"]] = track
        self._tracks = tracks
        self._art = arts

    def list_tracks(self, *, refresh: bool = True) -> list[dict]:
        if refresh:
            self.rescan()
        return list(self._tracks.values())

    def get_track(self, track_id: str) -> Optional[dict]:
        if track_id not in self._tracks:
            self.rescan()
        return self._tracks.get(track_id)

    def get_art(self, track_id: str) -> Optional[tuple[str, bytes]]:
        """(mime, raw bytes) for a track's cover art, or None."""
        if track_id not in self._art and track_id not in self._tracks:
            self.rescan()
        return self._art.get(track_id)

    def resolve_path(self, filename: str) -> Optional[Path]:
        # prevent path traversal — only allow files directly in music_dir
        candidate = (self.music_dir / filename).resolve()
        if candidate.parent != self.music_dir.resolve():
            return None
        if candidate.is_file() and candidate.suffix.lower() in SUPPORTED_EXT:
            return candidate
        return None
