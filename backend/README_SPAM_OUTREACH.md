# Spam outreach

Code: `services/spamOutreach/`. Two cron jobs in `services/cronJobs.js`, both off until
their flag is `true` in `.env`:

| Job | Flag | Schedule | What it does |
|---|---|---|---|
| Spam Outreach Sweeper | `SPAM_OUTREACH_SWEEPER` | every 15s | Moves everything in the trap mailbox's Inbox to Spam (IMAP) |
| Spam Outreach Cycle | `SPAM_OUTREACH_CYCLE` | every 15 min | Screenshots new Spam, finds who to write to (GetLeads), forwards the company's own email to them |

State is in Supabase, in the `spam_outreach_*` tables. All settings are under
"Spam outreach" in `.env.example`.

## Setup

1. Run `migrations/013_spam_outreach.sql` in the Supabase SQL editor.
2. If moving from the standalone spam-outreach project, import its state, so nobody is
   emailed twice:
   ```bash
   node scripts/spam-outreach/import-state.js /path/to/old/spam-outreach
   ```
3. Sign in to the trap mailbox's Gmail on this server (below).
4. Fill in the `SPAM_OUTREACH_*` settings in `.env`. Leave `SPAM_OUTREACH_SEND_ENABLED`
   blank for the first run; forwards then go to the mailbox's Drafts for review.
5. Set `SPAM_OUTREACH_SWEEPER=true` and `SPAM_OUTREACH_CYCLE=true`, restart the service,
   and check `pm2 logs`. Once the drafts look right, set `SPAM_OUTREACH_SEND_ENABLED=true`.

## Signing in to Gmail on the server (once)

Google won't accept a login copied from another machine, so a person signs in on the
server itself, in a Chrome window using the profile the cycle reads
(`SPAM_OUTREACH_CHROME_PROFILE_DIR`, default `backend/spam-outreach-data/chrome-profile`).
The server has no screen, so a temporary one is shared over VNC.

On the server, from `backend/`:

```bash
sudo apt-get install -y xvfb x11vnc
Xvfb :99 -screen 0 1400x1000x24 &
CHROME=$(node -e "console.log(require('puppeteer').executablePath())")
DISPLAY=:99 "$CHROME" --user-data-dir="$PWD/spam-outreach-data/chrome-profile" \
  --no-first-run https://mail.google.com &
x11vnc -display :99 -localhost -nopw -once &
```

On your own computer:

```bash
ssh -L 5900:localhost:5900 <user>@<server>
```

Then open a VNC viewer to `localhost:5900` (on a Mac: Finder → Go → Connect to Server →
`vnc://localhost:5900`). Sign in to the mailbox in that Chrome window, including 2-step
verification, and wait for the inbox to load. Then close everything on the server:

```bash
pkill -f chrome-profile; pkill x11vnc; pkill Xvfb
```

Only one Chrome can use the profile at a time, so make sure that sign-in window is closed
before the next cycle runs. If Google ever signs it out, cycles log `Not signed in to
Gmail` — repeat these steps.
