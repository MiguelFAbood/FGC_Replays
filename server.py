import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import tempfile
import uuid
import smtplib
import ssl
from email.message import EmailMessage
from datetime import datetime, timezone
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import urlopen, Request


ROOT = Path(__file__).resolve().parent
ACCOUNTS_FILE = ROOT / "accounts.json"
REPLAYS_FILE = ROOT / "replays.json"
PASSWORD_ITERATIONS = 310_000
CONTACT_RECIPIENT = "miguelabood@live.com"
SMTP_HOST = os.getenv("REPLAYS_SMTP_HOST", "smtp.example.com")
SMTP_PORT = int(os.getenv("REPLAYS_SMTP_PORT", "587"))
SMTP_USERNAME = os.getenv("REPLAYS_SMTP_USERNAME", "your-smtp-username")
SMTP_PASSWORD = os.getenv("REPLAYS_SMTP_PASSWORD", "YOUR_SMTP_PASSWORD_PLACEHOLDER")
SMTP_FROM = os.getenv("REPLAYS_SMTP_FROM", SMTP_USERNAME)
MAX_REQUEST_BYTES = 8_192
ACCOUNTS_LOCK = threading.Lock()
SESSIONS_LOCK = threading.Lock()
REPLAYS_LOCK = threading.Lock()
SESSIONS = {}


def load_replays():
    try:
        with REPLAYS_FILE.open("r", encoding="utf-8") as replay_file:
            replays = json.load(replay_file)
        return replays if isinstance(replays, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def save_replays(replays):
    descriptor, temporary_path = tempfile.mkstemp(prefix=".replays-", suffix=".tmp", dir=ROOT)
    temporary_file = Path(temporary_path)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(replays, output, indent=2)
            output.write("\n")
        os.replace(temporary_file, REPLAYS_FILE)
    except OSError as error:
        raise RuntimeError("Could not save replay submissions.") from error


def youtube_video_id(url):
    try:
        parts = urlsplit(url)
    except ValueError:
        return None
    host = parts.hostname.casefold() if parts.hostname else ""
    if host in ("youtu.be", "www.youtu.be"):
        return parts.path.lstrip("/").split("/")[0] or None
    if host in ("youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"):
        if parts.path == "/watch":
            query = dict(part.split("=", 1) for part in parts.query.split("&") if "=" in part)
            return query.get("v")
        if parts.path.startswith("/embed/") or parts.path.startswith("/shorts/"):
            return parts.path.split("/")[2] if len(parts.path.split("/")) > 2 else None
    return None


def load_accounts(migrate_legacy_roles=False):
    try:
        with ACCOUNTS_FILE.open("r", encoding="utf-8") as accounts_file:
            accounts = json.load(accounts_file)
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError("Could not read accounts.json. Fix the file contents and restart the server.") from error

    if not isinstance(accounts, list) or any(
        not isinstance(account, dict)
        or not isinstance(account.get("username"), str)
        or not isinstance(account.get("email"), str)
        or not isinstance(account.get("salt"), str)
        or not re.fullmatch(r"[0-9a-f]{32}", account["salt"])
        or not isinstance(account.get("password_hash"), str)
        or not re.fullmatch(r"[0-9a-f]{64}", account["password_hash"])
        or ("is_admin" in account and not isinstance(account["is_admin"], bool))
        for account in accounts
    ):
        raise RuntimeError("accounts.json must contain an array of valid account records.")
    needs_migration = any("is_admin" not in account for account in accounts)
    for account in accounts:
        account.setdefault("is_admin", False)
    if migrate_legacy_roles and needs_migration:
        save_accounts(accounts)
    return accounts


def save_accounts(accounts):
    temporary_file = None
    try:
        descriptor, temporary_path = tempfile.mkstemp(prefix=".accounts-", suffix=".tmp", dir=ROOT)
        temporary_file = Path(temporary_path)
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(accounts, output, indent=2)
            output.write("\n")
        os.replace(temporary_file, ACCOUNTS_FILE)
        temporary_file = None
    except OSError as error:
        raise RuntimeError("Could not save accounts.json. Check folder permissions and available disk space.") from error
    finally:
        if temporary_file is not None:
            try:
                temporary_file.unlink()
            except FileNotFoundError:
                pass


class ReplayHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        super().end_headers()

    def list_directory(self, path):
        self.send_error(404, "Directory listing is disabled")
        return None

    def is_private_file(self):
        requested_path = Path(super().translate_path(self.path)).resolve()
        return requested_path in (ACCOUNTS_FILE.resolve(), REPLAYS_FILE.resolve(), Path(__file__).resolve())

    def do_GET(self):
        route = urlsplit(self.path).path
        if route == "/api/session":
            self.handle_session()
            return
        if route == "/api/replays":
            self.handle_public_replays()
            return
        if route == "/api/admin/replays":
            self.handle_admin_replays()
            return
        if route.startswith("/api/youtube/title/"):
            self.handle_youtube_title(route.rsplit("/", 1)[-1])
            return
        if route.startswith("/api/"): 
            self.send_json(404, {"error": "API route not found."})
            return
        if self.is_private_file():
            self.send_error(404)
            return
        super().do_GET()

    def do_HEAD(self):
        if self.is_private_file():
            self.send_error(404)
            return
        super().do_HEAD()

    def do_POST(self):
        route = urlsplit(self.path).path
        handlers = {
            "/api/signup": self.handle_signup,
            "/api/login": self.handle_login,
            "/api/logout": self.handle_logout,
            "/api/replays": self.handle_submit_replay,
            "/api/contact": self.handle_contact,
            "/api/admin/replays/action": self.handle_admin_action,
        }
        handler = handlers.get(route)
        if handler is None:
            self.send_json(404, {"error": "API route not found."})
            return

        try:
            payload = self.read_json()
            handler(payload)
        except ValueError as error:
            self.send_json(400, {"error": str(error)})
        except RuntimeError as error:
            self.send_json(500, {"error": str(error)})

    def read_json(self):
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValueError("Invalid request length.") from error

        if content_length < 1 or content_length > MAX_REQUEST_BYTES:
            raise ValueError("Request body is empty or too large.")

        try:
            payload = json.loads(self.rfile.read(content_length))
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise ValueError("Request body must be valid JSON.") from error

        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")
        return payload

    def send_json(self, status, payload, cookie=None):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, status, message):
        self.send_json(status, {"error": message})

    def read_session_token(self):
        cookie = SimpleCookie()
        cookie.load(self.headers.get("Cookie", ""))
        morsel = cookie.get("replays_session")
        return morsel.value if morsel else None

    def create_session(self, username):
        token = secrets.token_urlsafe(32)
        with SESSIONS_LOCK:
            SESSIONS[token] = username
        return token

    def handle_session(self):
        token = self.read_session_token()
        with SESSIONS_LOCK:
            username = SESSIONS.get(token)
        if not username:
            self.send_json(200, {"account": None})
            return

        with ACCOUNTS_LOCK:
            account = next(
                (candidate for candidate in load_accounts() if candidate["username"] == username),
                None,
            )
        if not account:
            with SESSIONS_LOCK:
                SESSIONS.pop(token, None)
            self.send_json(200, {"account": None})
            return

        self.send_json(
            200,
            {"account": {"username": username, "is_admin": account["is_admin"]}},
        )

    def current_account(self):
        token = self.read_session_token()
        with SESSIONS_LOCK:
            username = SESSIONS.get(token)
        if not username:
            return None
        with ACCOUNTS_LOCK:
            return next((account for account in load_accounts() if account["username"] == username), None)

    def handle_youtube_title(self, video_id):
        if not re.fullmatch(r"[A-Za-z0-9_-]{6,20}", video_id):
            self.send_json(400, {"error": "Invalid video ID."})
            return
        try:
            request = Request(
                f"https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={video_id}&format=json",
                headers={"User-Agent": "Replays-HUB/1.0"},
            )
            with urlopen(request, timeout=5) as response:
                data = json.loads(response.read().decode("utf-8"))
            title = data.get("title") if isinstance(data, dict) else None
            if not isinstance(title, str) or not title.strip():
                raise ValueError("No title returned")
            self.send_json(200, {"title": title.strip()})
        except Exception:
            self.send_json(200, {"title": None})

    def handle_contact(self, payload):
        fields = ("name", "email", "subject", "message")
        values = {field: payload.get(field) for field in fields}
        if not all(isinstance(value, str) and value.strip() for value in values.values()):
            self.send_error_json(400, "Name, email, subject, and message are required.")
            return

        name = values["name"].strip()
        sender_email = values["email"].strip()
        subject = values["subject"].strip()
        message_text = values["message"].strip()
        if len(name) > 100 or len(sender_email) > 254 or len(subject) > 200 or len(message_text) > 5000:
            self.send_error_json(400, "One or more contact fields are too long.")
            return
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", sender_email):
            self.send_error_json(400, "Enter a valid email address.")
            return
        if SMTP_HOST == "smtp.example.com" or SMTP_PASSWORD == "YOUR_SMTP_PASSWORD_PLACEHOLDER":
            self.send_error_json(503, "Email service is not configured on the server.")
            return

        email = EmailMessage()
        email["Subject"] = f"Replays HUB contact: {subject}"
        email["From"] = SMTP_FROM
        email["To"] = CONTACT_RECIPIENT
        email["Reply-To"] = sender_email
        email.set_content(
            f"Name: {name}\nEmail: {sender_email}\nSubject: {subject}\n\n{message_text}"
        )

        try:
            context = ssl.create_default_context()
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as smtp:
                smtp.ehlo()
                smtp.starttls(context=context)
                smtp.login(SMTP_USERNAME, SMTP_PASSWORD)
                smtp.send_message(email)
        except (smtplib.SMTPException, OSError, ssl.SSLError) as error:
            self.send_error_json(502, "The email service could not send this message.")
            return

        self.send_json(200, {"ok": True})

    def handle_public_replays(self):
        with REPLAYS_LOCK:
            replays = [replay.copy() for replay in load_replays() if replay.get("status") == "approved"]
        self.send_json(200, {"replays": replays})

    def handle_submit_replay(self, payload):
        account = self.current_account()
        if not account:
            self.send_error_json(401, "You must be signed in to submit a replay.")
            return

        fields = ("title", "youtube_url", "game", "player1", "player2", "player1_char", "player2_char")
        values = {field: payload.get(field) for field in fields}
        if not all(isinstance(value, str) and value.strip() for value in values.values()):
            self.send_error_json(400, "All replay fields are required.")
            return

        youtube_url = values["youtube_url"].strip()
        video_id = youtube_video_id(youtube_url)
        if not video_id or not re.fullmatch(r"[A-Za-z0-9_-]{6,20}", video_id):
            self.send_error_json(400, "Enter a valid YouTube video, short, or youtu.be link.")
            return

        game_aliases = {
            "GUILTY GEAR STRIVE": "GUILTY GEAR -STRIVE-",
            "GUILTY GEAR XX ACCENT CORE +R": "GUILTY GEAR XX ACCENT CORE + R",
        }
        normalized_game = game_aliases.get(values["game"].strip().upper(), values["game"].strip())

        replay = {
            "id": str(uuid.uuid4()),
            "title": values["title"].strip(),
            "youtube_url": youtube_url,
            "video_id": video_id,
            "game": normalized_game,
            "player1": values["player1"].strip(),
            "player2": values["player2"].strip(),
            "player1_char": values["player1_char"].strip(),
            "player2_char": values["player2_char"].strip(),
            "submitted_by": account["username"],
            "submitted_at": datetime.now(timezone.utc).isoformat(),
            "status": "pending",
        }
        with REPLAYS_LOCK:
            replays = load_replays()
            replays.insert(0, replay)
            save_replays(replays)
        self.send_json(201, {"ok": True, "replay": replay})

    def handle_admin_replays(self):
        account = self.current_account()
        if not account or not account["is_admin"]:
            self.send_error_json(403, "Administrator access required.")
            return
        with REPLAYS_LOCK:
            replays = load_replays()
        self.send_json(200, {"replays": replays})

    def handle_admin_action(self, payload):
        account = self.current_account()
        if not account or not account["is_admin"]:
            self.send_error_json(403, "Administrator access required.")
            return
        replay_id = payload.get("id")
        action = payload.get("action")
        if not isinstance(replay_id, str) or action not in ("approve", "reject", "edit", "delete"):
            self.send_error_json(400, "Invalid replay action.")
            return
        with REPLAYS_LOCK:
            replays = load_replays()
            replay = next((item for item in replays if item.get("id") == replay_id), None)
            if not replay:
                self.send_error_json(404, "Replay not found.")
                return
            if action == "delete":
                replays.remove(replay)
                save_replays(replays)
                self.send_json(200, {"ok": True, "deleted": replay_id})
                return
            if action == "edit":
                for field in ("title", "game", "player1", "player2", "player1_char", "player2_char"):
                    value = payload.get(field)
                    if isinstance(value, str) and value.strip():
                        replay[field] = value.strip()
                youtube_url = payload.get("youtube_url")
                if isinstance(youtube_url, str) and youtube_url.strip():
                    new_video_id = youtube_video_id(youtube_url.strip())
                    if not new_video_id or not re.fullmatch(r"[A-Za-z0-9_-]{6,20}", new_video_id):
                        self.send_error_json(400, "Enter a valid YouTube video, short, or youtu.be link.")
                        return
                    replay["youtube_url"] = youtube_url.strip()
                    replay["video_id"] = new_video_id
                replay["updated_by"] = account["username"]
                replay["updated_at"] = datetime.now(timezone.utc).isoformat()
            else:
                replay["status"] = "approved" if action == "approve" else "rejected"
                replay["reviewed_by"] = account["username"]
                replay["reviewed_at"] = datetime.now(timezone.utc).isoformat()
            save_replays(replays)
        self.send_json(200, {"ok": True, "replay": replay})

    def handle_signup(self, payload):
        username = payload.get("username")
        email = payload.get("email")
        password = payload.get("password")
        if not all(isinstance(value, str) for value in (username, email, password)):
            raise ValueError("Username, email, and password are required.")

        username = username.strip()
        email = email.strip().lower()
        if not re.fullmatch(r"[A-Za-z0-9._-]{3,24}", username):
            raise ValueError("Username must be 3-24 characters and use only letters, numbers, ., _ or -.")
        if len(email) > 254 or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
            raise ValueError("Enter a valid email address.")
        if len(password) < 8 or len(password) > 128:
            raise ValueError("Password must be between 8 and 128 characters.")

        salt = secrets.token_bytes(16)
        password_hash = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS
        )
        account = {
            "username": username,
            "email": email,
            "salt": salt.hex(),
            "password_hash": password_hash.hex(),
            "is_admin": False,
        }

        with ACCOUNTS_LOCK:
            accounts = load_accounts()
            if any(existing["username"].casefold() == username.casefold() for existing in accounts):
                raise ValueError("That username is already in use.")
            if any(existing["email"].casefold() == email.casefold() for existing in accounts):
                raise ValueError("That email is already registered.")
            accounts.append(account)
            save_accounts(accounts)

        token = self.create_session(username)
        self.send_json(
            201,
            {"username": username, "is_admin": account["is_admin"]},
            f"replays_session={token}; Path=/; HttpOnly; SameSite=Strict",
        )

    def handle_login(self, payload):
        identifier = payload.get("identifier")
        password = payload.get("password")
        if not isinstance(identifier, str) or not isinstance(password, str):
            raise ValueError("Username or email and password are required.")

        identifier = identifier.strip().casefold()
        with ACCOUNTS_LOCK:
            accounts = load_accounts()
        account = next(
            (
                candidate for candidate in accounts
                if candidate["username"].casefold() == identifier
                or candidate["email"].casefold() == identifier
            ),
            None,
        )

        salt = bytes.fromhex(account["salt"]) if account else bytes(16)
        expected_hash = bytes.fromhex(account["password_hash"]) if account else bytes(32)
        actual_hash = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS
        )
        if not account or not hmac.compare_digest(actual_hash, expected_hash):
            self.send_error_json(401, "Incorrect username, email, or password.")
            return

        token = self.create_session(account["username"])
        self.send_json(
            200,
            {"username": account["username"], "is_admin": account["is_admin"]},
            f"replays_session={token}; Path=/; HttpOnly; SameSite=Strict",
        )

    def handle_logout(self, _payload):
        token = self.read_session_token()
        if token:
            with SESSIONS_LOCK:
                SESSIONS.pop(token, None)
        self.send_json(
            200,
            {"ok": True},
            "replays_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
        )


def main():
    if not ACCOUNTS_FILE.exists():
        ACCOUNTS_FILE.write_text("[]\n", encoding="utf-8")
    if not REPLAYS_FILE.exists():
        REPLAYS_FILE.write_text("[]\n", encoding="utf-8")
    load_accounts(migrate_legacy_roles=True)
    server = ThreadingHTTPServer(("127.0.0.1", 8000), ReplayHandler)
    print("Replays HUB running at http://127.0.0.1:8000")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Replays HUB.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
