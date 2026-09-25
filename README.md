# Islautopia Intercom Card

A lightning-fast, custom WebRTC 2-way audio intercom card for Home Assistant, purpose-built for
Islautopia Doorbell hardware. Visual language (colors, video frame, HUD, action buttons) matches
the official Islautopia mobile apps.

Set `device_id` and this card talks the doorbell's own WebRTC protocol (ICE-Lite + DTLS-SRTP +
RTP) straight to the doorbell on your local network. Signalling goes through your own Home
Assistant (the `islautopia_doorbell` integration, >= 0.7.0), which adds the pairing credential on
the server side: **the credential never reaches the browser.** **Local only (since 1.9.0):** no
cloud relay, no STUN/TURN — the live view works wherever the browser can reach the doorbell on your
network, and not from outside.

> **Breaking change (2026-07-10):** the legacy `go2rtc`/`stream`/`go2rtc_url` configuration mode
> (for third-party RTSP intercoms served through `go2rtc`) has been removed entirely. This card
> now only speaks the native IG Doorbell WebRTC protocol, and `device_id` is required. If you were
> relying on the legacy mode, pin to a card version prior to this change — it will not come back.

## ✨ Features

* **Native visual language:** same color palette, rounded video frame with an in-video HUD ("LIVE" tag, "Audio active"/"Motion detected" pills), asymmetric action buttons (speaker, large mic, door — same order as the mobile apps) and a door-status line, matching the official Islautopia apps.
* **Mode dropdown chip (automatic since 1.9.3; dropdown since 1.9.5):** a single pill — icon + the current mode's label + a caret — that opens a small menu to switch Normal/Away/Do not disturb/Custom without leaving the card, matching the mobile apps' own mode pill. The card finds the doorbell's own mode `select` by itself (see *Entities found automatically* below); `mode_entity` is only a manual override.
* **REC pill (admins only, since 1.9.2; automatic since 1.9.3; header pill since 1.9.5):** a small red-dot capsule in the header — same look as the mobile apps' REC indicator, "REC" always shown untranslated — that starts/stops a manual recording through the manual-recording `switch` published by the `islautopia_doorbell` integration (>= 0.7.2), found automatically for the card's own doorbell. The card never talks recording protocol to the doorbell directly — "the card shows, the integration exposes" — it only calls the entity's own service, and the blinking state always reflects what the *entity* says, never the last tap. Visible only when the doorbell paired this Home Assistant as an admin (`_connInfo.role`, not the Home Assistant user). `rec_entity` is only a manual override.
* **Recordings button (admins only, since 1.9.5):** below the video, same look as the mobile apps' "Recordings" button — opens Home Assistant's own native media browser against the recordings this doorbell already exposes as a `media_source` (`islautopia_doorbell` integration), never a card-built player. Same admin gating as REC. There is no "Settings" button here on purpose — configuration lives in the integration and its entities.
* **Motion badge (optional):** point `motion_entity` at a presence/motion `binary_sensor.*` to show an amber "Motion detected" badge over the video — automatically hidden whenever the mic is active, so it never competes with the audio indicator.
* **Ultra-Fast Video Loading:** Uses `recvonly` initialization and a dummy audio track to load video streams in ~1 second without waiting for microphone permissions.
* **Flawless 2-Way Audio (Hot-Swap):** Replaces tracks on the fly. No SDP renegotiation, no ICE restarts, and no dropped connections when you toggle the microphone.
* **Background Lifecycle Management:** Automatically closes connections when you navigate away from the Lovelace tab to save resources, instantly revives the stream when you return, and auto-reconnects (with backoff) if the live connection drops mid-session.
* **Visual Lovelace Editor:** Fully configurable via the Home Assistant UI. No YAML required.
* **Native door open:** sends the doorbell's own `open`/`open_result` signaling message — works local and remote, distinguishes "opened" from "no lock configured", with a live "Door open · Closing in Ns" countdown under the video. `unlock_entity` (below) remains available as an explicit alternative if you'd rather route door-open through an HA entity/Automation.
* **Voice turn-taking (multi-client):** the doorbell has a *single* voice channel. The card asks for the turn before unmuting and only opens the mic once the doorbell grants it. If someone else is already talking you get a clear "voice channel busy" message and stay in **listen-only** — you still hear the door, you just can't talk yet — and the card tells you the moment the channel frees up. If the doorbell takes the turn back (silence timeout, or another user), you're told which of the two happened instead of being cut off mid-sentence.
* **Connected-viewer counter:** a `👥 N` pill shows how many WebRTC clients are watching this doorbell right now (RTSP/NVR recorders are not counted — they're not people). It highlights when there's more than one.
* **Quality stays automatic on Home Assistant (since 1.9.2):** the picker to force Low/Audio-only was removed from this card — on a dashboard the choice is always automatic (or high once the doorbell is at full quality), the same as the mobile apps' behaviour for a home-network viewer. Automatic changes made by the doorbell itself are still shown with their reason (packet loss / bandwidth) if the picture degrades.
* **Works with older doorbell firmware:** turn-taking degrades gracefully — a doorbell that doesn't know about it answers with *silence*, not an error, so the card opens the mic anyway after 3s with a one-time notice. No dead buttons, no endless spinners.
* **Fullscreen that works everywhere — including the companion app:** the video takes the whole screen, with the mic and door buttons floating over the image, the viewer counter still visible, and exit via `Esc` or the same icon. **The controls never auto-hide**: this isn't a video player — somebody is waiting at the door, and a door-open button that vanishes after three seconds vanishes at exactly the wrong moment. The screen is kept awake while the mode is active.

  It works in two levels, because the browser's Fullscreen API is genuinely unavailable in a large part of where this card is used, and each case has a traceable cause. On **Android**, Chromium only grants the API if the host app implements `WebChromeClient.onShowCustomView`; the Home Assistant Android app didn't, until it was added on 2026-05-06 ([home-assistant/android#6790](https://github.com/home-assistant/android/pull/6790)) — so updating the app fixes that one. On **iOS**, `WKWebView` ships with element fullscreen switched *off* and it must be enabled via `WKPreferences.isElementFullscreenEnabled`; the Home Assistant iOS app doesn't touch it, and iPhone Safari has no element fullscreen either.

  So where the API isn't granted, the card falls back to its own CSS fullscreen filling the whole app window. It can't hide the phone's system bars — only the real API can — but it **keeps the card's own mic and door buttons**, which is what you lose with the usual fallback of handing the `<video>` to the native iOS player. On a video intercom that difference is not cosmetic: it's the difference between talking to whoever rang and just watching them. The icon therefore never does nothing — only the path behind it changes. And in the rare case where even the fallback can't fill the window (an ancestor with `transform`/`filter`/`contain` traps any `position: fixed` inside it — a theme or card-mod can introduce one), the card measures the result, undoes it, and hides the icon rather than offering a mode that doesn't work.

  **Measured on a real device (2026-09-25, HA Android app on a wall tablet, with WebView remote debugging):** the API *was* granted, but `document.fullscreenElement` returns the outermost shadow host (`<home-assistant>`), not the card — standard Shadow DOM retargeting. Up to 1.9.2 the card compared it with itself, concluded it was *not* fullscreen and undid its fullscreen layout right after entering: the element was 1280×800 but its content kept its dashboard height, leaving a black band at the bottom. Since 1.9.3 the card walks down each `shadowRoot.fullscreenElement`; measured afterwards, card, video frame and video all fill 1280×800 CSS px (the full 1920×1200 screen, no system or Home Assistant bars).
* **Pinch to zoom (since 1.9.3):** two fingers zoom into the picture (up to ×5), one finger pans once zoomed, a double tap zooms ×2.5 at that point or, if already zoomed, fits the picture back. Works in fullscreen and embedded in the dashboard (where one finger still scrolls the dashboard until you zoom). Ctrl + mouse wheel / trackpad pinch does the same on a desktop. Zoom resets when entering or leaving fullscreen.
* **No door button when there's no door:** if the doorbell has no lock configured, the open button isn't drawn at all instead of being offered and failing. The doorbell reports its lock type over the signaling channel every few seconds, so the button is correct from the first frame — and if you change the lock type from the doorbell's own dashboard while the card is open, the button appears or disappears within seconds, with nothing to reload. Against older doorbell firmware that doesn't report it, the card falls back to hiding the button after a genuine "no lock configured" reply.
* **Upright picture, wherever the camera is mounted:** the camera module inside the doorbell is fitted rotated 90° on purpose — vertically it fits a whole person *and* a parcel on the ground, which landscape does not. Rotating on the doorbell itself was measured at 65–71 ms per frame against a 66.7 ms budget at 15 fps, so it is the client that straightens the picture, which is free. The doorbell reports the angle on the signaling channel and the card applies it, switching the frame to 9:16 so a portrait video is *big* on a phone. It never crops to fill: zooming until the width is covered throws away the top and the bottom, which is exactly what the rotated sensor was for. In fullscreen on a landscape screen — a wall tablet — the two buttons move to a narrow side rail and the video keeps the full height. The last known angle for that doorbell is remembered, so the card reserves the right shape before the first frame instead of visibly jumping on every start.
* **Watching is not listening:** the speaker starts **muted**. A wall panel showing the street 24/7 must not pipe the street into your living room 24/7. Sound turns on when *you* turn it on, or by itself when somebody rings — by default the card listens to the integration's events entity (only `ring` counts); `ring_entity` overrides it. Listening and talking are independent: you can hear the visitor without taking the voice turn, and closing the mic puts the sound back the way it was. The speaker toggle lives in the main action row now (since 1.9.2, same place as the mobile apps); the volume slider that used to sit next to it was removed — volume is the device's own, no client in this product has one in its live view.
* **Door-open asks twice:** the open button arms on the first press and only opens on the second, with an inline message and a countdown ring — no modal to dismiss with somebody waiting at the door. The confirmation **expires after ~3 s** (otherwise an accidental press leaves the door armed and the next accidental press opens it) and a fast double-tap under ~300 ms doesn't count (a phone in a pocket, or a bouncing finger, produces exactly that). Not configurable, on purpose: a safety mechanism you can switch off stops being one.
* **Nothing happens in silence:** anything that isn't instant shows that it's running, from the first moment, and always ends. Opening the door shows **Opening…** while the doorbell is asked, and only turns green and says **Open** once the doorbell has actually confirmed it — a timeout is a timeout, never an "opened". (Until now the button went green the instant you pressed it, so a reply that never arrived left you looking at a button reading "Open" with the door shut. On a video intercom that isn't a UI detail: it's somebody walking away believing they let the visitor in.) When Home Assistant cannot reach the doorbell on the network the card says so instead of leaving a black rectangle, and a reconnection shows the countdown to the next attempt rather than a spinner that turns forever with no explanation.
* **Tells you when it needs re-pairing:** if the doorbell rejects the pairing credential — after a factory reset, or a revoked app instance — the card says so in plain language instead of retrying in silence behind a permanent "Connecting…". It keeps retrying anyway, and clears the notice by itself the moment video comes back.
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

## 🔔 Notices (the bell, since 1.9.7)

The bell in the header opens the doorbell's notices — rings, detections, door openings, mode
changes — with a **type filter** and the **same time filter as the apps' recordings** (last hour,
6 hours, day, week; day and week can be stepped back). A red dot means there is something new
since this browser last opened it. The data is the history Home Assistant's recorder keeps for the
integration's `event` entity (fed by the doorbell's local webhook), read with Home Assistant's own
`history/history_during_period`: no doorbell credential in the browser, no cloud, works without
internet. How far back it goes is your recorder's `purge_keep_days`. Events generated by the cloud
relay (call answered/missed, doorbell offline) never reach Home Assistant and do not appear.

## ⚙️ Configuration

The easiest way to configure the card is using the **Visual Editor** in your Lovelace dashboard. Just click "Add Card", search for "Islautopia Intercom", and fill in the fields.

### Entities found automatically (since 1.9.3)

Only `device_id` is needed. From it the card finds the Home Assistant device registered by the
`islautopia_doorbell` integration for that doorbell, and takes the integration's own entities of
that device by their **translation key** (never by entity_id, which you may rename): the mode
`select` (`mode`), the manual-recording `switch` (`rec`) and the events entity (`events`, for the
ring). `mode_entity`, `rec_entity` and `ring_entity` still work, as manual overrides.

### YAML Configuration Example

```yaml
type: custom:islautopia-intercom-card
# REQUIRED: the doorbell's device_id, as shown in
# Settings > Devices & services > Islautopia Doorbell after pairing it.
device_id: a1b2c3d4e5f60718

# LIVE VIEW TIMEOUT (1.9.0): set it with the integration's entity
# `number.<doorbell>_live_view_timeout` (default 120 s, 0 = never) — an automation or any dashboard
# can change it. When it expires with nobody touching the card, the card does what the apps do in
# the background: `live_pause` at once, and after 15 s it hangs up and FREES THE DOORBELL'S SLOT.
# It never expires with the microphone open, a tap resumes, and a new ring wakes it by itself.
#
# LEAVING THE VIEW (1.9.1): switching dashboard view or tab, or the screen turning off, pauses the
# live view at once (`live_pause`) and coming back resumes it in the same state (sound, microphone
# and talk turn), call or no call. Without a call the doorbell's slot is freed after 15 s away.
#
# `idle_release_seconds` below is only the fallback for an integration older than 0.7.0.
#
# OPTIONAL: seconds without any interaction (touch, pointer or keyboard) before the card releases
# the video stream, letting the screen turn off. Default 120. Set to 0 to disable.
#
# WHY THIS EXISTS: while video is playing the card holds a screen wake lock so the display does
# not dim mid-conversation. On a phone that lasts as long as the call. On a WALL PANEL it does
# not: after a doorbell ring the screen stayed on forever, and the wake lock also overrode Home
# Assistant's `command_screen_off` — measured on a Galaxy Tab. That is a deadlock: releasing the
# stream requires hiding the card, and the wake lock would not let the screen turn off to hide it.
#
# With this, an untouched panel lets go after a minute, the OS turns the screen off on its own
# timeout, the card becomes hidden and the stream is released. A touch brings it all back.
idle_release_seconds: 120

# OPTIONAL: a switch/light/lock/cover/button entity to trigger door-open through Home
# Assistant instead of the doorbell's own native open/open_result signaling message.
unlock_entity: switch.front_door_relay

# OPTIONAL: auto-turn off unlock_entity after X seconds, only used if unlock_entity is set
unlock_duration: 3

# OPTIONAL OVERRIDE: since 1.9.3 the card finds the doorbell's own mode select.* by itself.
# Set this only to show the chips of a different select.* entity.
mode_entity: select.front_door_mode

# OPTIONAL: a binary_sensor.* entity (e.g. presence/motion detection) to show an amber
# "Motion detected" badge over the video while it's "on". Never shown while the mic is active.
motion_entity: binary_sensor.front_door_motion

# OPTIONAL: the doorbell's chime entity. The speaker starts muted -- watching is not
# listening -- and this is the one thing that turns sound on by itself: somebody ringing.
# Works with a binary_sensor.* (transition to "on") or an event.* entity.
ring_entity: binary_sensor.front_door_chime

# OPTIONAL OVERRIDE: since 1.9.3 the card finds the manual-recording switch.* of the
# islautopia_doorbell integration (>= 0.7.2) by itself. The REC button is visible only to
# Home Assistant administrators. The card
# never talks recording protocol to the doorbell itself: it calls this entity's own service, and
# the blinking state always reflects what the ENTITY says, never the last tap (so two admins
# watching the same door see the same state, and an automatic recording blinks too).
rec_entity: switch.front_door_rec

# OPTIONAL: MAXIMUM height of the video frame in px (e.g., 650px). Since 1.9.7 the card sizes
# itself: it measures the space the dashboard gives it, keeps the controls and Recordings on
# screen, and gives the video what is left at its real aspect ratio. This value only caps it.
height: auto
```

## 🧠 How it Works (The Magic)

1. It creates a silent software audio track on load so video starts immediately without waiting for microphone permissions.
2. When you click the microphone button, it performs a native `replaceTrack()` to swap the silent track with your actual physical microphone — no SDP renegotiation.
3. The card asks the `islautopia_doorbell` integration (over `hass.connection.sendMessagePromise(...)`) for a short-lived signed URL of its signalling proxy and for the entities it reads (live view timeout, events). No credential, host or relay URL ever reaches the browser.
4. Signalling goes through Home Assistant only; media goes peer-to-peer over UDP between the browser and the doorbell's LAN address (host candidates, no STUN/TURN). If Home Assistant cannot reach the doorbell on the network, the card says so and retries — it never falls back to the cloud.
5. Note: if your own Home Assistant dashboard is served over plain HTTP, the browser will still block microphone access for the whole page regardless of what this card does — that's a property of your HA instance's own origin, not something this card (or the doorbell's own HTTPS certificate) can work around. See the [Islautopia Intercom Engine](https://github.com/Islautopia/ig_hassio_addons) add-on if you need to put your whole HA dashboard behind HTTPS locally.

---
*Developed for Islautopia Garage.*
