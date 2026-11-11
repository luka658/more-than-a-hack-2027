"""Read-only, dependency-free access to the supplied tactical annotations."""

from array import array
from functools import lru_cache
import math
from pathlib import Path
from threading import Lock
import xml.etree.ElementTree as ET

from games import GAME, GAMES, asset_paths
from starter.load_smart_tagging import load as load_tags
from starter.player_speed import summarize_speeds, speed_metadata, speed_timeline

CHUNK_SIZE = 500


def point(raw):
    values = [float(value) for value in raw.split(",")]
    if len(values) != 3:
        raise ValueError("Expected x,y,speed in ATD")
    if not all(math.isfinite(value) for value in values[:2]):
        return None
    return [value if math.isfinite(value) else None for value in values]


def parse_frame(line, frame, slots):
    """Keep source coordinates, including off-pitch points; never fill missing data."""
    frame_id, players, ball = line.strip().split(":")
    if int(frame_id) != frame + 1:
        raise ValueError("ATD alignment mismatch at video frame {}".format(frame))
    groups = players.split(";")
    if len(groups) != len(slots):
        raise ValueError("ATD player slots do not match the XML metadata")
    visible = []
    for slot, group in zip(slots, groups):
        position = point(group)
        if position is not None:
            visible.append([slot["id"]] + position)
    return {"frame": frame, "players": visible, "ball": point(ball),
            "speed": summarize_speeds(player[3] for player in visible)}


class MatchData:
    def __init__(self, data_dir=None, frames=None):
        self.data_dir = data_dir
        self.paths = {key: Path(path) for key, path in asset_paths(data_dir=data_dir).items()}
        self.frames = frames if frames is not None else GAMES[GAME]["n_video_frames"]
        self._offsets = None
        self._lock = Lock()
        self._speed_lock = Lock()
        self._speeds = None

    @lru_cache(maxsize=1)
    def events(self):
        return load_tags(data_dir=self.data_dir)

    @lru_cache(maxsize=1)
    def metadata(self):
        root = ET.parse(self.paths["atd_meta"]).getroot()
        teams = list(root.iter("Team"))
        if len(teams) != 2:
            raise ValueError("Expected two teams in ATD metadata")
        sides = {team.get("id"): side for team, side in zip(teams, ("H", "A"))}
        slots = []
        for index, player in enumerate(root.iter("Player")):
            if player.get("teamId") not in sides:
                raise ValueError("Unknown team in ATD metadata")
            slots.append({"id": index + 1, "team": sides[player.get("teamId")]})
        if not slots:
            raise ValueError("No player slots in ATD metadata")
        return {"slots": slots, "pitch": list(GAMES[GAME]["pitch"]),
                "speedUnit": speed_metadata(self.paths["atd_meta"])["unit"],
                "ballHeightAvailable": False,
                "frames": self.frames, "chunkSize": CHUNK_SIZE}

    def speeds(self):
        with self._speed_lock:
            if self._speeds is None:
                meta = self.metadata()
                self._speeds = {"unit": meta["speedUnit"], "fps": GAMES[GAME]["fps"],
                                "frames": self.frames, "binSeconds": 1,
                                "bins": speed_timeline(self.paths["atd_raw"], self.frames,
                                                       len(meta["slots"]), GAMES[GAME]["fps"])}
        return self._speeds

    def offsets(self):
        # Index byte positions once (~1.6 MB for the full match), not millions of objects.
        with self._lock:
            if self._offsets is None:
                offsets = array("Q")
                with self.paths["atd_raw"].open("rb") as handle:
                    while True:
                        offset = handle.tell()
                        line = handle.readline()
                        if not line:
                            break
                        if int(line.split(b":", 1)[0]) != len(offsets) + 1:
                            raise ValueError("ATD must have consecutive frame IDs starting at 1")
                        offsets.append(offset)
                if len(offsets) != self.frames:
                    raise ValueError("ATD frame count does not match the tactical video")
                self._offsets = offsets
        return self._offsets

    @lru_cache(maxsize=8)
    def chunk(self, start):
        if start < 0 or start >= self.frames or start % CHUNK_SIZE:
            raise ValueError("Tracking chunk must start at a multiple of {} within the video".format(CHUNK_SIZE))
        slots = self.metadata()["slots"]
        offsets = self.offsets()
        with self.paths["atd_raw"].open("rb") as handle:
            handle.seek(offsets[start])
            rows = [parse_frame(handle.readline().decode("ascii"), frame, slots)
                    for frame in range(start, min(start + CHUNK_SIZE, self.frames))]
        return {"start": start, "frames": rows}
