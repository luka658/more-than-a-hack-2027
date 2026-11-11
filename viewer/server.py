"""Local tactical-video viewer. Run: python viewer/server.py"""

import argparse
import json
import mimetypes
from pathlib import Path
import re
import socket
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from games import GAME, GAMES, anchor_video_frame, asset_paths
from match_data import MatchData

STATIC = Path(__file__).resolve().parent / "static"
RESULTS = ROOT / "evaluation" / "results"


class ViewerServer(ThreadingHTTPServer):
    # Windows SO_REUSEADDR can let a second process bind an occupied port,
    # leaving the browser connected to an older server after an apparent restart.
    allow_reuse_address = not hasattr(socket, "SO_EXCLUSIVEADDRUSE")

    def server_bind(self):
        if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def byte_range(header, size):
    """Parse one HTTP byte range, including open-ended and suffix ranges."""
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", header)
    if not match or not size or not any(match.groups()):
        raise ValueError("Invalid byte range")
    first, last = match.groups()
    if first:
        start = int(first)
        end = min(int(last), size - 1) if last else size - 1
    else:
        count = int(last)
        if count <= 0:
            raise ValueError("Invalid suffix")
        start, end = max(0, size - count), size - 1
    if start >= size or start > end:
        raise ValueError("Unsatisfiable byte range")
    return start, end


class Handler(BaseHTTPRequestHandler):
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        if path == "/api/config":
            game = GAMES[GAME]
            files = sorted(p.name for p in RESULTS.glob("*.csv") if p.is_file())
            default = "my_first.csv" if "my_first.csv" in files else (
                "baseline_smooth50.csv" if "baseline_smooth50.csv" in files else next(iter(files), None))
            self.send_json({
                "game": GAME, "fps": game["fps"], "frames": game["n_video_frames"],
                "kickoffs": [anchor_video_frame(game[key]) for key in ("kickoff", "kickoff_2nd")],
                "models": files, "defaultModel": default,
                "videoAvailable": self.server.video.is_file(),
            })
        elif path in {"/api/events", "/api/speeds", "/api/tracking/meta"} or path.startswith("/api/tracking/chunk/"):
            try:
                if path == "/api/events":
                    data = {"events": self.server.match_data.events()}
                elif path == "/api/speeds":
                    data = self.server.match_data.speeds()
                elif path == "/api/tracking/meta":
                    data = self.server.match_data.metadata()
                else:
                    data = self.server.match_data.chunk(int(path.rsplit("/", 1)[1]))
                self.send_json(data)
            except OSError:
                self.send_json({"error": "Match data missing or unreadable. Check data/tactical/ or MTAH_DATA_DIR."}, 404)
            except (ValueError, SyntaxError) as error:
                self.send_json({"error": str(error)}, 422)
        elif path == "/video":
            self.send_file(self.server.video, "video/mp4")
        elif path.startswith("/api/models/"):
            name = path[len("/api/models/"):]
            if name not in {p.name for p in RESULTS.glob("*.csv") if p.is_file()}:
                self.send_error(404, "Prediction file not found")
                return
            self.send_file(RESULTS / name, "text/csv; charset=utf-8")
        else:
            # Explicit allowlist: never expose the repository or gated match assets.
            name = "index.html" if path == "/" else path.lstrip("/")
            if name not in {"index.html", "app.mjs", "core.mjs", "styles.css", "match-data.mjs"}:
                self.send_error(404)
                return
            mime = "text/javascript" if name.endswith(".mjs") else mimetypes.guess_type(name)[0]
            self.send_file(STATIC / name, mime or "application/octet-stream")

    def send_json(self, data, status=200):
        body = json.dumps(data, allow_nan=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def send_file(self, path, mime):
        try:
            handle = path.open("rb")
        except OSError:
            self.send_error(404, "File missing; check data/ or MTAH_DATA_DIR")
            return
        with handle:
            size = path.stat().st_size
            start, end = 0, size - 1
            partial = self.headers.get("Range")
            if partial:
                try:
                    start, end = byte_range(partial, size)
                except ValueError:
                    self.send_response(416)
                    self.send_header("Content-Range", "bytes */{}".format(size))
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
            self.send_response(206 if partial else 200)
            self.send_header("Content-Type", mime)
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Length", str(end - start + 1))
            self.send_header("Cache-Control", "no-cache")
            self.send_header("X-Content-Type-Options", "nosniff")
            if partial:
                self.send_header("Content-Range", "bytes {}-{}/{}".format(start, end, size))
            self.end_headers()
            if self.command == "HEAD":
                return
            handle.seek(start)
            remaining = end - start + 1
            try:
                while remaining > 0:
                    block = handle.read(min(1024 * 1024, remaining))
                    if not block:
                        break
                    self.wfile.write(block)
                    remaining -= len(block)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass  # Browsers cancel ranges when the user seeks.


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--video", type=Path, default=Path(asset_paths()["video"]))
    args = parser.parse_args()
    try:
        server = ViewerServer(("127.0.0.1", args.port), Handler)
    except OSError as error:
        parser.exit(1, "Could not start viewer on port {}: {}. Stop the existing viewer or use --port.\n".format(args.port, error))
    server.video = args.video.resolve()
    server.match_data = MatchData()
    print("Possession viewer: http://127.0.0.1:{}".format(args.port), flush=True)
    print("Video: {}".format(server.video), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
