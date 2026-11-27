"""Host Punchline with a local Quiplash 2 installation on macOS."""
import argparse
import mimetypes
import re
import shutil
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
LIBRARY = Path.home() / "Library" / "Application Support" / "Steam"
GAME = Path("steamapps/common/The Jackbox Party Pack 3/The Jackbox Party Pack 3.app/Contents/Resources/macos/games/Quiplash2")
WEB_FILES = {"index.html", "style.css", "editor.css", "app.js", "ui.js", "screens.js", "network.js",
             "rich.js", "editor.js", "game.js", "audio.js", "prompts.js", "steam-questions.js"}
PRIVATE_MEDIA = re.compile(r"/_steam/(\d{1,10})\.ogg")
PROMPT_MEDIA = re.compile(r"/_steam/question/(\d{1,10})\.ogg")


def find_game():
    folders = [LIBRARY]
    manifest = LIBRARY / "steamapps/libraryfolders.vdf"
    if manifest.is_file():
        folders.extend(Path(p) for p in re.findall(r'"path"\s+"([^"]+)"', manifest.read_text(errors="replace")))
    return next((base / GAME for base in folders if (base / GAME / "TalkshowExport/project/media").is_dir()), None)


class Screen(BaseHTTPRequestHandler):
    def do_GET(self):
        port = self.server.server_port
        if self.headers.get("Host") not in {f"localhost:{port}", f"127.0.0.1:{port}"}:
            self.send_error(403)
            return
        path = unquote(urlsplit(self.path).path)
        if path.startswith("/_steam/"):
            if self.headers.get("Sec-Fetch-Site") == "cross-site":
                self.send_error(403)
                return
            game = self.server.game
            if not game:
                self.send_error(404)
                return
            music = PRIVATE_MEDIA.fullmatch(path)
            prompt = PROMPT_MEDIA.fullmatch(path)
            if music:
                asset = game / "TalkshowExport/project/media" / (music[1] + ".ogg")
            elif prompt:
                asset = game / "content/QuiplashQuestion" / prompt[1] / "prompt.ogg"
            elif path == "/_steam/questions":
                asset = game / "content/QuiplashQuestion.jet"
            else:
                self.send_error(404)
                return
            self.serve(asset, "application/json" if path.endswith("questions") else "audio/ogg")
            return
        requested = path.lstrip("/") or "index.html"
        asset = (ROOT / requested).resolve()
        if not asset.is_relative_to(ROOT):
            self.send_error(404)
            return
        relative = asset.relative_to(ROOT)
        if str(relative) not in WEB_FILES and relative.parts[:1] not in {("assets",), ("vendor",)}:
            self.send_error(404)
            return
        self.serve(asset, mimetypes.guess_type(asset.name)[0] or "application/octet-stream")

    def serve(self, asset, kind):
        if not asset.is_file():
            self.send_error(404)
            return
        with asset.open("rb") as f:
            self.send_response(200)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(asset.stat().st_size))
            self.send_header("Cache-Control", "no-cache")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Cross-Origin-Resource-Policy", "same-origin")
            self.end_headers()
            try:
                shutil.copyfileobj(f, self.wfile)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def log_message(self, *_args):
        pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-open", action="store_true")
    parser.add_argument("--port", default=0, type=int)
    args = parser.parse_args()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Screen)
    server.game = find_game()
    url = f"http://127.0.0.1:{server.server_port}/" + ("?steam=1" if server.game else "?launcher=1")
    print("Punchline host screen\n" + url, flush=True)
    print("Quiplash 2 media found." if server.game else "Steam media unavailable. Using original Punchline audio.", flush=True)
    print("Keep this window open while playing. Press Control-C to close it.", flush=True)
    if not args.no_open:
        threading.Timer(0.15, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
