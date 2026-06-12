# Seedlist Warmup Service

Standalone runner for the seedlist engagement warmer scripts (Brevo,
HubSpot, Mailchimp, ActiveCampaign, MailerLite — test + seedlist variants),
connecting to the same Supabase database as `maxify-proj`.

## What's already set up here

```
backend/
├── .env.example          <- copy to .env and fill in (see below)
├── .gitignore
├── index.js               <- entrypoint, requires services/cronJobs.js
├── package.json           <- deps already listed
├── middlewares/trackers/rollbar.js
├── services/
│   └── cronJobs.js         <- all 10 cron jobs wired (env-flag gated, locked)
└── scripts/
    └── seedlist engagments/
        ├── seedlist engagments/   <- paste 5 production scripts here
        └── test engagments/       <- paste 5 test scripts here
```

## Remaining manual steps

1. **Paste the 10 script files** from
   `maxify-proj/backend/scripts/seedlist engagments/` into the matching
   subfolders here (see `PASTE_FILES_HERE.md` in each folder, then delete
   those placeholder files).

2. **Install dependencies**:
   ```bash
   cd backend
   npm install
   ```

3. **Create `.env`**:
   ```bash
   cp .env.example .env
   ```
   Then fill in:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_ANON_KEY`),
     `ENCRYPTION_KEY` — **copy these verbatim from `maxify-proj/backend/.env`**.
     Do not regenerate them; this project reads the same
     `auto_responder_mailboxes` rows and must decrypt the same
     `app_password` values.
   - `*_WARMER` flags — set to `'true'` only for the platforms/modes this
     project should own. Coordinate with `maxify-proj` so the same warmer
     isn't enabled in both projects at once (avoids double-processing the
     same mailboxes/emails).
   - Optional tuning vars and `ROLLBAR_ACCESS_TOKEN`.

4. **Review hardcoded data** in each pasted script:
   - `TARGET_SENDERS` — set to this project's actual sending addresses per
     platform.
   - `TEST_EMAILS` (in the 5 test scripts) — review/replace as needed.

5. **Verify before enabling cron** — run one test script standalone:
   ```bash
   node "scripts/seedlist engagments/test engagments/engage-test-mailerlite.js"
   ```
   Confirms Supabase connection, decryption, and IMAP login all work.

6. **Run**:
   ```bash
   npm start
   ```

Full background/rationale: see `maxify-proj/backend/scripts/seedlist engagments/NEW_PROJECT_SETUP.md`.
