# Ponisha Notifier

<img src="assets/icon.png" width="72" align="right" alt="Po icon">

A tiny **Windows system-tray** app that watches your [ponisha.ir](https://ponisha.ir)
account for **unread messages** and pings a webhook (kimiasoft SMS → Telegram) so
you get notified on your phone.

- Right-click tray menu: **Check now** · **Exit**
- Polls ponisha every *N* minutes (default **5**)
- On unread messages it fires your SMS/Telegram webhook with the unread count
- Pure HTTPS login (no browser) → compiles to a single **`.exe`**
- Credentials + interval live in a plain **`.conf`** file next to the exe

> ⚖️ ponisha.ir's terms permit automation; this tool only reads your own
> notification count and never posts anything to the site.

---

## How it works

1. **Login** — `POST https://api.ponisha.ir/api/v1/auth/login` with your
   email/mobile + password, returns a bearer token (cached in
   `.ponisha-notifier.session.json` so restarts reuse the session).
2. **Check** — `GET https://chat.ponisha.ir/v1/conversations` (same bearer
   token) and sums each conversation's `unread_count`. That's the unread
   **message** badge. If the token has expired (HTTP 401) it logs in again
   automatically.
   > Note: `api/v1/users/me/notifications/count` only counts *site
   > notifications* (bids, etc.), **not** chat messages — that's why unread
   > messages don't show up there.
3. **Notify** — when `unread > 0`, it GETs your `sms_url` with `{count}`
   replaced by the number of unread messages. By default it re-sends every
   interval while `unread > 0`.

The request headers mimic a normal Chrome-on-Windows browser.

## Configure

Copy the sample and fill in your details (keep it next to the `.exe`):

```
copy ponisha-notifier.conf.sample ponisha-notifier.conf
```

```ini
interval=5
username=you@example.com      # email OR mobile you log in with
password=your-ponisha-password
```

`sms_url`, `api_base`, and `resend_every_interval` are optional overrides — see
the sample file. `username` with an `@` is sent as `email`, otherwise as
`mobile`.

## Run from source

Requires Node 18+ (built and tested on Node 24). No runtime npm dependencies.

```
node src/index.js
```

## Build the .exe

```
npm install       # fetches @yao-pkg/pkg + rcedit (build-time only)
npm run build     # -> dist/ponisha-notifier.exe
```

Then put `ponisha-notifier.conf` next to `dist/ponisha-notifier.exe` and run it.
The app auto-starts checking on launch; **Check now** forces an immediate check
and restarts the interval.

## Files

| File | Purpose |
|------|---------|
| `src/index.js` | orchestrator: config → interval → tray |
| `src/ponisha.js` | login / unread-count / webhook (pure HTTPS) |
| `src/config.js` | `.conf` + session-token loader |
| `src/tray.js` | spawns and talks to the tray host |
| `src/tray.ps1` | .NET `NotifyIcon` tray (draws its own icon) |
| `assets/icon.*` | the "Po" app icon |
| `build.js` | pkg build + icon stamping |

## Notes

- The tray UI is a small PowerShell/.NET `NotifyIcon` process the exe launches —
  no native Node modules, so the exe stays self-contained. Closing the tray (or
  the exe) shuts the other down.
- `.conf`, the cached session, and the log are git-ignored — never commit
  credentials.

## License

MIT
