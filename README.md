# Replays HUB

Replays HUB is a fighting game replay website concept for browsing match replays and submitting replay details. It uses a dark, cyber-inspired visual style and adapts to mobile screens.

## Pages

- **Home (`index.html`)** - featured replay, sample archive list, working client-side search/filter/sort controls, published status, and structured match details.
- **Upload (`upload.html`)** - signed-in submission form for YouTube replay links, requiring administrator review before publication.
- **Contact (`contact.html`)** - contact form for sending a message.
- **Login (`login.html`)** - local-server demo sign-up, login, and logout flow.
- **Admin (`admin.html`)** - administrator-only replay validation queue with player-name editing, approval, and rejection.

## Project files

- `styles.css` - shared layout, visual styles, and responsive mobile breakpoints.
- `script.js` - client-side replay archive search, game filtering, and sorting.
- `server.py` - local static-file server and demo authentication API.
- `accounts.json` - local demo account records with an `is_admin` flag; passwords are stored as salted hashes.
- `replays.json` - replay submissions and approval state; automatically initialized by the server.
- `logo.png`, `icon.png`, `kulabluewhitewide.png` - site logo, favicon, and background artwork.
- The HTML files contain the individual pages.

## Current status

The home-page archive controls search, filter, and sort the sample replay cards in the browser; they do not retrieve replay data from a server. The login demo uses the included local Python server to save accounts in `accounts.json`; passwords are stored as salted PBKDF2 hashes, and accounts have an `is_admin` boolean (new sign-ups are never administrators). Sessions are held in server memory. This is for local development only, not production authentication; the server binds to localhost and must not be exposed to the internet. Existing browser-only demo accounts are not migrated automatically.

## Run locally

Use Python 3 and run the server from the project folder:

```powershell
python server.py
```

Then open <http://127.0.0.1:8000/login.html>. Stop the server with Ctrl+C. The account records persist in `accounts.json`; active sessions end when the server restarts. Do not open the HTML files directly with `file://`, because the login API requires the local server.

## Configure Contact Us email

Set SMTP environment variables before starting the server. The recipient is fixed as `miguelabood@live.com`.

```powershell
$env:REPLAYS_SMTP_HOST="smtp.example.com"
$env:REPLAYS_SMTP_PORT="587"
$env:REPLAYS_SMTP_USERNAME="your-smtp-username"
$env:REPLAYS_SMTP_PASSWORD="YOUR_SMTP_PASSWORD_PLACEHOLDER"
$env:REPLAYS_SMTP_FROM="sender@example.com"
python server.py
```

The server uses STARTTLS. A placeholder configuration returns HTTP 503 until real SMTP values are supplied; never commit real credentials to the project.

Replay submissions require a signed-in local account and enter an administrator review queue before they become searchable and playable on the home page. Playback uses the stored YouTube video ID with privacy-enhanced embeds; no YouTube Data API key is required. The archive is efficient in this implementation because it searches local approved replay records and fetches only the selected stored video ID, rather than performing a title search against the YouTube API. Replay and account storage remain local-demo implementations, not production databases.
