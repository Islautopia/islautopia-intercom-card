# Islautopia Intercom Card

A lightning-fast, custom WebRTC 2-way audio intercom card for Home Assistant, purpose-built for
Islautopia Doorbell hardware. Visual language (colors, video frame, HUD, action buttons) matches
the official Islautopia mobile apps.

Set `device_id` and this card talks the doorbell's own WebRTC protocol directly (ICE-Lite +
DTLS-SRTP + RTP) — local signaling over the doorbell's real HTTPS certificate, with automatic
fallback to the relay/TURN when viewed remotely. Requires the
[`islautopia-doorbell-integration`](https://github.com/Islautopia/islautopia-doorbell-integration)
to be installed and the doorbell paired — the integration hands this card everything it needs
(host, credentials, TURN) with nothing pasted into YAML by hand.

> **Breaking change (2026-07-10):** the legacy `go2rtc`/`stream`/`go2rtc_url` configuration mode
> (for third-party RTSP intercoms served through `go2rtc`) has been removed entirely. This card
> now only speaks the native IG Doorbell WebRTC protocol, and `device_id` is required. If you were
> relying on the legacy mode, pin to a card version prior to this change — it will not come back.

## ✨ Features

* **Native visual language:** same color palette, rounded video frame with an in-video HUD ("LIVE" tag, "Audio active"/"Motion detected" pills), asymmetric action buttons (large mic, smaller door) and a door-status line, matching the official Islautopia apps.
* **Mode chips (optional):** point `mode_entity` at the doorbell's mode `select.*` entity to show Normal/Away/Night/Custom chips, tinted by mode, tap to switch modes without leaving the card.
* **Motion badge (optional):** point `motion_entity` at a presence/motion `binary_sensor.*` to show an amber "Motion detected" badge over the video — automatically hidden whenever the mic is active, so it never competes with the audio indicator.
* **Ultra-Fast Video Loading:** Uses `recvonly` initialization and a dummy audio track to load video streams in ~1 second without waiting for microphone permissions.
* **Flawless 2-Way Audio (Hot-Swap):** Replaces tracks on the fly. No SDP renegotiation, no ICE restarts, and no dropped connections when you toggle the microphone.
* **Background Lifecycle Management:** Automatically closes connections when you navigate away from the Lovelace tab to save resources, instantly revives the stream when you return, and auto-reconnects (with backoff) if the live connection drops mid-session.
* **Visual Lovelace Editor:** Fully configurable via the Home Assistant UI. No YAML required.
* **Native door open:** sends the doorbell's own `open`/`open_result` signaling message — works local and remote, distinguishes "opened" from "no lock configured", with a live "Door open · Closing in Ns" countdown under the video. `unlock_entity` (below) remains available as an explicit alternative if you'd rather route door-open through an HA entity/Automation.
* **Voice turn-taking (multi-client):** the doorbell has a *single* voice channel. The card asks for the turn before unmuting and only opens the mic once the doorbell grants it. If someone else is already talking you get a clear "voice channel busy" message and stay in **listen-only** — you still hear the door, you just can't talk yet — and the card tells you the moment the channel frees up. If the doorbell takes the turn back (silence timeout, or another user), you're told which of the two happened instead of being cut off mid-sentence.
* **Connected-viewer counter:** a `👥 N` pill shows how many WebRTC clients are watching this doorbell right now (RTSP/NVR recorders are not counted — they're not people). It highlights when there's more than one.
* **Per-viewer quality selector:** Auto / High / Low / Audio only, right over the video, affecting **only your own stream** — never the doorbell's recording or other viewers. "Low" means *keyframes only* (~1 frame per second), which is labelled as such so it never looks like a fault. Automatic changes made by the doorbell itself are shown with their reason (packet loss / bandwidth).
* **Works with older doorbell firmware:** all three features above degrade gracefully. A doorbell that doesn't know about turn-taking answers with *silence*, not an error, so the card opens the mic anyway after 3s with a one-time notice; the quality selector simply doesn't appear if the doorbell doesn't confirm it. No dead buttons, no endless spinners.
* **Fullscreen that works everywhere — including the companion app:** the video takes the whole screen, with the mic and door buttons floating over the image, the viewer counter still visible, and exit via `Esc` or the same icon. **The controls never auto-hide**: this isn't a video player — somebody is waiting at the door, and a door-open button that vanishes after three seconds vanishes at exactly the wrong moment. The screen is kept awake while the mode is active.

  It works in two levels, because the browser's Fullscreen API is genuinely unavailable in a large part of where this card is used, and each case has a traceable cause. On **Android**, Chromium only grants the API if the host app implements `WebChromeClient.onShowCustomView`; the Home Assistant Android app didn't, until it was added on 2026-05-06 ([home-assistant/android#6790](https://github.com/home-assistant/android/pull/6790)) — so updating the app fixes that one. On **iOS**, `WKWebView` ships with element fullscreen switched *off* and it must be enabled via `WKPreferences.isElementFullscreenEnabled`; the Home Assistant iOS app doesn't touch it, and iPhone Safari has no element fullscreen either.

  So where the API isn't granted, the card falls back to its own CSS fullscreen filling the whole app window. It can't hide the phone's system bars — only the real API can — but it **keeps the card's own mic and door buttons**, which is what you lose with the usual fallback of handing the `<video>` to the native iOS player. On a video intercom that difference is not cosmetic: it's the difference between talking to whoever rang and just watching them. The icon therefore never does nothing — only the path behind it changes. And in the rare case where even the fallback can't fill the window (an ancestor with `transform`/`filter`/`contain` traps any `position: fixed` inside it — a theme or card-mod can introduce one), the card measures the result, undoes it, and hides the icon rather than offering a mode that doesn't work.
* **No door button when there's no door:** if the doorbell has no lock configured, the open button isn't drawn at all instead of being offered and failing. The doorbell reports its lock type over the signaling channel every few seconds, so the button is correct from the first frame — and if you change the lock type from the doorbell's own dashboard while the card is open, the button appears or disappears within seconds, with nothing to reload. Against older doorbell firmware that doesn't report it, the card falls back to hiding the button after a genuine "no lock configured" reply.
* **Upright picture, wherever the camera is mounted:** the camera module inside the doorbell is fitted rotated 90° on purpose — vertically it fits a whole person *and* a parcel on the ground, which landscape does not. Rotating on the doorbell itself was measured at 65–71 ms per frame against a 66.7 ms budget at 15 fps, so it is the client that straightens the picture, which is free. The doorbell reports the angle on the signaling channel and the card applies it, switching the frame to 9:16 so a portrait video is *big* on a phone. It never crops to fill: zooming until the width is covered throws away the top and the bottom, which is exactly what the rotated sensor was for. In fullscreen on a landscape screen — a wall tablet — the two buttons move to a narrow side rail and the video keeps the full height. The last known angle for that doorbell is remembered, so the card reserves the right shape before the first frame instead of visibly jumping on every start.
* **Watching is not listening:** the speaker starts **muted**. A wall panel showing the street 24/7 must not pipe the street into your living room 24/7. Sound turns on when *you* turn it on, or by itself when somebody rings — point the optional `ring_entity` at the doorbell's chime `binary_sensor.*`. Listening and talking are independent: you can hear the visitor without taking the voice turn, and closing the mic puts the sound back the way it was. This also fixes a control that used to lie: the volume slider changed the volume of an element that stayed muted, so turning it up made nothing audible.
* **Door-open asks twice:** the open button arms on the first press and only opens on the second, with an inline message and a countdown ring — no modal to dismiss with somebody waiting at the door. The confirmation **expires after ~3 s** (otherwise an accidental press leaves the door armed and the next accidental press opens it) and a fast double-tap under ~300 ms doesn't count (a phone in a pocket, or a bouncing finger, produces exactly that). Not configurable, on purpose: a safety mechanism you can switch off stops being one.
* **Nothing happens in silence:** anything that isn't instant shows that it's running, from the first moment, and always ends. Opening the door shows **Opening…** while the doorbell is asked, and only turns green and says **Open** once the doorbell has actually confirmed it — a timeout is a timeout, never an "opened". (Until now the button went green the instant you pressed it, so a reply that never arrived left you looking at a button reading "Open" with the door shut. On a video intercom that isn't a UI detail: it's somebody walking away believing they let the visitor in.) Falling back to the cloud relay says so instead of leaving a black rectangle, and a reconnection shows the countdown to the next attempt rather than a spinner that turns forever with no explanation.
* **Tells you when it needs re-pairing:** if the doorbell or the relay rejects the pairing credential — after a factory reset, or a revoked app instance — the card says so in plain language instead of retrying in silence behind a permanent "Connecting…". It keeps retrying anyway, and clears the notice by itself the moment video comes back.
* **Smart Volume Memory:** Native volume slider that remembers your preferred listening level via `localStorage`. The level is remembered; whether sound is *on* deliberately is not.
* **Multi-Language Support (i18n):** Automatically translates the UI based on your Home Assistant language (Supports EN, ES, PT, DE, FR, RU, ZH, HI, AR).

## 📥 Installation

### Option A: via HACS (Recommended)
1. Open HACS in Home Assistant.
2. Click on the 3 dots in the top right corner and select **Custom repositories**.
3. Add the URL of this repository and select **Lovelace** as the category.
4. Click **Add**, then search for "Islautopia Intercom Card" and click **Download**.
5. Refresh your browser cache.

### Option B: Manual Installation
1. Download the `islautopia-intercom-card.js` file.
2. Copy it into your `<config>/www/` directory.
3. Go to **Settings > Dashboards > 3 dots (top right) > Resources**.
4. Add `/local/islautopia-intercom-card.js?v=1` as a **JavaScript Module** (see the note on
   `?v=` below — don't register the bare URL with no query string).

> ⚠️ **Cache warning, read this before updating the card later.** Unlike the HACS-managed
> resource (`/hacsfiles/...`, which HACS tags with its own `?hacstagXXXXXXX` on every release so
> browsers know to refetch it), a manually-registered resource has **no built-in cache-busting**.
> If you overwrite `islautopia-intercom-card.js` in `<config>/www/` later (a bugfix, a new
> version) without changing the resource **URL**, browsers that already loaded the old file may
> keep serving it from cache indefinitely — there is nothing in a plain HTTP GET for the exact
> same URL that tells the browser "this changed, refetch it". This can make a real fix look like
> it "didn't take" even though the file on disk is correct.
>
> **To update safely**: every time you replace the file, also bump the query string on the
> resource entry (`Settings > Dashboards > Resources`, edit the URL from `?v=1` to `?v=2`, etc.)
> — changing the URL is what actually forces browsers to refetch, a hard refresh (Ctrl+Shift+R)
> alone is not reliable across all browsers/proxies. As of this file, `islautopia-intercom-card.js`
> logs `[islautopia-intercom-card] modulo cargado - build=<id>` to the browser console the moment
> it loads (see `CARD_BUILD_ID` near the top of the file) — check that log against the `build` in
> the actual `.js` file you copied if you're ever unsure whether the browser is really running the
> version you just deployed.

## ⚙️ Configuration

The easiest way to configure the card is using the **Visual Editor** in your Lovelace dashboard. Just click "Add Card", search for "Islautopia Intercom", and fill in the fields.

### YAML Configuration Example

```yaml
type: custom:islautopia-intercom-card
# REQUIRED: the doorbell's device_id, as shown in
# Settings > Devices & services > Islautopia Doorbell after pairing it.
device_id: a1b2c3d4e5f60718

# OPTIONAL: a switch/light/lock/cover/button entity to trigger door-open through Home
# Assistant instead of the doorbell's own native open/open_result signaling message.
unlock_entity: switch.front_door_relay

# OPTIONAL: auto-turn off unlock_entity after X seconds, only used if unlock_entity is set
unlock_duration: 3

# OPTIONAL: a select.* entity (e.g. the doorbell's own mode selector) to show Normal/Away/
# Night/Custom mode chips above the video. Leave blank to hide the row entirely.
mode_entity: select.front_door_mode

# OPTIONAL: a binary_sensor.* entity (e.g. presence/motion detection) to show an amber
# "Motion detected" badge over the video while it's "on". Never shown while the mic is active.
motion_entity: binary_sensor.front_door_motion

# OPTIONAL: the doorbell's chime entity. The speaker starts muted -- watching is not
# listening -- and this is the one thing that turns sound on by itself: somebody ringing.
# Works with a binary_sensor.* (transition to "on") or an event.* entity.
ring_entity: binary_sensor.front_door_chime

# OPTIONAL: card height (e.g., 400px, 60vh, auto). Default is auto: 16/9, or 9/16 when the
# doorbell reports a rotated camera (capped so it can't grow absurdly tall on a wide panel).
height: auto
```

## 🧠 How it Works (The Magic)

1. It creates a silent software audio track on load so video starts immediately without waiting for microphone permissions.
2. When you click the microphone button, it performs a native `replaceTrack()` to swap the silent track with your actual physical microphone — no SDP renegotiation.
3. Connection info (device host, relay URL, pairing credential) and fresh TURN credentials come from the `islautopia_doorbell` integration over `hass.connection.sendMessagePromise(...)` — nothing is ever pasted into this card's config by hand.
4. It always tries local signaling first, against the doorbell's own real HTTPS hostname (`https://<device_id>.doorbell.islautopia.com:8443`, never a raw local IP — required both to avoid mixed-content blocking when your Home Assistant dashboard itself is served over HTTPS, and for the doorbell's Let's Encrypt certificate to validate correctly), with a short timeout. If that's unreachable (e.g. you're viewing the dashboard remotely), it falls back to the relay over `wss://`.
5. Note: if your own Home Assistant dashboard is served over plain HTTP, the browser will still block microphone access for the whole page regardless of what this card does — that's a property of your HA instance's own origin, not something this card (or the doorbell's own HTTPS certificate) can work around. See the [Islautopia Intercom Engine](https://github.com/Islautopia/ig_hassio_addons) add-on if you need to put your whole HA dashboard behind HTTPS locally.

---
*Developed for Islautopia Garage.*
