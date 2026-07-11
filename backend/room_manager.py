"""In-memory room and member state for JamSync.

No database — everything lives in process memory. A single RoomManager
instance is shared across the FastAPI app.
"""

from __future__ import annotations

import random
import time
from dataclasses import dataclass, field
from typing import Optional


def _generate_room_id() -> str:
    """JAM-#### style id."""
    return f"JAM-{random.randint(1000, 9999)}"


@dataclass
class Member:
    name: str
    is_owner: bool = False
    # The live WebSocket is attached separately by the hub; we keep a flag
    # so room_state snapshots can be built without touching sockets.
    connected: bool = True


@dataclass
class PlaybackState:
    current_track: Optional[dict] = None      # full track metadata dict
    is_playing: bool = False
    position: float = 0.0                      # seconds into the track
    last_update: float = field(default_factory=time.time)  # server epoch secs

    def effective_position(self) -> float:
        """Position right now, accounting for elapsed wall-clock time."""
        if self.is_playing and self.current_track is not None:
            return self.position + (time.time() - self.last_update)
        return self.position

    def set(self, *, is_playing: bool, position: float,
            current_track: Optional[dict] = None) -> None:
        self.is_playing = is_playing
        self.position = position
        self.last_update = time.time()
        if current_track is not None:
            self.current_track = current_track


@dataclass
class Room:
    room_id: str
    name: str
    members: dict[str, Member] = field(default_factory=dict)   # name -> Member
    queue: list[dict] = field(default_factory=list)            # track dicts
    playback: PlaybackState = field(default_factory=PlaybackState)
    created_at: float = field(default_factory=time.time)

    @property
    def owner_name(self) -> Optional[str]:
        for m in self.members.values():
            if m.is_owner:
                return m.name
        return None

    def member_names(self) -> list[dict]:
        return [
            {"name": m.name, "is_owner": m.is_owner, "connected": m.connected}
            for m in self.members.values()
        ]

    def snapshot(self) -> dict:
        """Full room_state payload."""
        return {
            "event": "room_state",
            "room_id": self.room_id,
            "name": self.name,
            "queue": self.queue,
            "current_track": self.playback.current_track,
            "is_playing": self.playback.is_playing,
            "position": self.playback.effective_position(),
            "server_time": time.time(),
            "members": self.member_names(),
            "owner": self.owner_name,
        }


class RoomManager:
    def __init__(self) -> None:
        self.rooms: dict[str, Room] = {}

    # ---- room lifecycle ---------------------------------------------------

    def create_room(self, name: str) -> Room:
        room_id = _generate_room_id()
        while room_id in self.rooms:
            room_id = _generate_room_id()
        room = Room(room_id=room_id, name=name or f"Jam {room_id}")
        self.rooms[room_id] = room
        return room

    def get_room(self, room_id: str) -> Optional[Room]:
        return self.rooms.get(room_id)

    def end_room(self, room_id: str) -> None:
        self.rooms.pop(room_id, None)

    def list_rooms(self) -> list[dict]:
        return [
            {
                "room_id": r.room_id,
                "name": r.name,
                "listeners": sum(1 for m in r.members.values() if m.connected),
                "now_playing": (r.playback.current_track or {}).get("title"),
            }
            for r in self.rooms.values()
        ]

    # ---- membership -------------------------------------------------------

    def join(self, room_id: str, name: str) -> Optional[Room]:
        room = self.rooms.get(room_id)
        if room is None:
            return None
        existing = room.members.get(name)
        if existing:
            existing.connected = True
        else:
            is_owner = len(room.members) == 0  # first in becomes owner
            room.members[name] = Member(name=name, is_owner=is_owner)
        return room

    def leave(self, room_id: str, name: str) -> Optional[Room]:
        """Mark member gone. Transfer ownership / end room as needed.

        Returns the room if it still exists, else None (ended/empty).
        """
        room = self.rooms.get(room_id)
        if room is None:
            return None
        member = room.members.pop(name, None)

        if not room.members:
            # room is now empty -> end it
            self.end_room(room_id)
            return None

        # if the owner left, transfer to the next member
        if member and member.is_owner:
            next_member = next(iter(room.members.values()))
            next_member.is_owner = True
        return room

    # ---- queue / playback -------------------------------------------------

    def add_to_queue(self, room_id: str, track: dict) -> Optional[Room]:
        room = self.rooms.get(room_id)
        if room is None:
            return None
        room.queue.append(track)
        # auto-start if nothing is playing
        if room.playback.current_track is None:
            self._advance(room)
        return room

    def remove_from_queue(self, room_id: str, index: int) -> Optional[Room]:
        room = self.rooms.get(room_id)
        if room is None:
            return None
        if 0 <= index < len(room.queue):
            room.queue.pop(index)
        return room

    def reorder_queue(self, room_id: str, old_index: int,
                      new_index: int) -> Optional[Room]:
        room = self.rooms.get(room_id)
        if room is None:
            return None
        q = room.queue
        if 0 <= old_index < len(q) and 0 <= new_index < len(q):
            q.insert(new_index, q.pop(old_index))
        return room

    def _advance(self, room: Room) -> None:
        """Pop the next track from the queue into now-playing."""
        if room.queue:
            track = room.queue.pop(0)
            room.playback.set(is_playing=True, position=0.0,
                              current_track=track)
        else:
            room.playback.set(is_playing=False, position=0.0)
            room.playback.current_track = None

    def skip(self, room_id: str) -> Optional[Room]:
        room = self.rooms.get(room_id)
        if room is None:
            return None
        self._advance(room)
        return room

    def set_playback(self, room_id: str, *, is_playing: bool,
                     position: float) -> Optional[Room]:
        room = self.rooms.get(room_id)
        if room is None:
            return None
        room.playback.set(is_playing=is_playing, position=position)
        return room
