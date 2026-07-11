#!/usr/bin/env python3
"""Upload the local /music FLACs to Cloudflare R2 and (re)generate music.json.

music.json is the committed manifest the app/design centers on: one entry per
song carrying its display name, the R2 CDN link (primary), and the local
backend stream link (fallback). The local FLACs stay in git as that fallback.

Usage:
    # Generate music.json only, no uploads (no credentials needed):
    python scripts/migrate_to_r2.py --manifest-only

    # Full run: upload songs + album art to R2, then write music.json.
    # Reads these from the environment (or a .env you source first):
    #   R2_ENDPOINT_URL, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
    #   R2_BUCKET_NAME, R2_PUBLIC_BASE
    python scripts/migrate_to_r2.py

R2_PUBLIC_BASE is the public CDN origin, e.g. https://cdn.waveroom.com or the
temporary https://<hash>.r2.dev dev URL. It is baked into each r2_url.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
from pathlib import Path
from urllib.parse import quote

REPO_ROOT = Path(__file__).resolve().parent.parent
MUSIC_DIR = Path(os.environ.get("MUSIC_DIR", REPO_ROOT / "music"))
MANIFEST_PATH = REPO_ROOT / "music.json"
SUPPORTED_EXT = {".flac"}


def track_id(filename: str) -> str:
    """Match backend/music_library.py._track_id exactly."""
    return base64.urlsafe_b64encode(filename.encode()).decode().rstrip("=")


def parse_from_filename(filename: str) -> tuple[str, str]:
    stem = Path(filename).stem
    if " - " in stem:
        artist, title = stem.split(" - ", 1)
        return artist.strip(), title.strip()
    return "Unknown Artist", stem.strip()


def read_metadata(path: Path) -> dict:
    filename = path.name
    fb_artist, fb_title = parse_from_filename(filename)
    title, artist, album, duration = fb_title, fb_artist, "", 0.0
    art_mime, art_data = None, None
    try:
        from mutagen.flac import FLAC

        audio = FLAC(str(path))
        title = (audio.get("title", [fb_title]) or [fb_title])[0]
        artist = (audio.get("artist", [fb_artist]) or [fb_artist])[0]
        album = (audio.get("album", [""]) or [""])[0]
        if audio.info is not None:
            duration = float(audio.info.length)
        if audio.pictures:
            pic = audio.pictures[0]
            art_mime, art_data = (pic.mime or "image/jpeg"), pic.data
    except Exception as exc:  # noqa: BLE001 - keep filename-based metadata
        print(f"  ! metadata read failed for {filename}: {exc}", file=sys.stderr)
    return {
        "title": title,
        "artist": artist,
        "album": album,
        "duration": round(duration, 2),
        "art_mime": art_mime,
        "art_data": art_data,
    }


def r2_client():
    import boto3

    required = [
        "R2_ENDPOINT_URL",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
        "R2_BUCKET_NAME",
        "R2_PUBLIC_BASE",
    ]
    missing = [k for k in required if not os.environ.get(k)]
    if missing:
        sys.exit(f"Missing env vars for upload: {', '.join(missing)}")
    client = boto3.client(
        "s3",
        endpoint_url=os.environ["R2_ENDPOINT_URL"],
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
    )
    return client, os.environ["R2_BUCKET_NAME"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--manifest-only",
        action="store_true",
        help="Write music.json without uploading to R2.",
    )
    args = ap.parse_args()

    if not MUSIC_DIR.is_dir():
        sys.exit(f"Music dir not found: {MUSIC_DIR}")

    public_base = os.environ.get("R2_PUBLIC_BASE", "").rstrip("/")
    client = bucket = None
    if not args.manifest_only:
        client, bucket = r2_client()

    tracks = []
    files = sorted(p for p in MUSIC_DIR.iterdir()
                   if p.is_file() and p.suffix.lower() in SUPPORTED_EXT)
    print(f"Found {len(files)} FLAC(s) in {MUSIC_DIR}")

    for path in files:
        filename = path.name
        tid = track_id(filename)
        meta = read_metadata(path)
        has_art = meta["art_data"] is not None

        if client is not None:
            key = f"songs/{filename}"
            client.upload_file(str(path), bucket, key,
                               ExtraArgs={"ContentType": "audio/flac"})
            print(f"  ↑ {key}")
            if has_art:
                art_key = f"art/{tid}.jpg"
                client.put_object(Bucket=bucket, Key=art_key,
                                  Body=meta["art_data"],
                                  ContentType=meta["art_mime"] or "image/jpeg")
                print(f"  ↑ {art_key}")

        r2_url = f"{public_base}/songs/{quote(filename)}" if public_base else None
        art_url = (f"{public_base}/art/{tid}.jpg"
                   if (public_base and has_art) else
                   (f"/art/{tid}" if has_art else None))
        tracks.append({
            "id": tid,
            "name": f"{meta['artist']} — {meta['title']}",
            "filename": filename,
            "title": meta["title"],
            "artist": meta["artist"],
            "album": meta["album"],
            "duration": meta["duration"],
            "r2_url": r2_url,               # primary (CDN, zero egress)
            "stream_url": f"/stream/{quote(filename)}",  # fallback (backend)
            "album_art": art_url,
            "lossless": True,
        })

    MANIFEST_PATH.write_text(json.dumps(tracks, indent=2, ensure_ascii=False))
    print(f"Wrote {MANIFEST_PATH} ({len(tracks)} tracks, "
          f"R2 {'ON' if public_base else 'OFF'})")


if __name__ == "__main__":
    main()
