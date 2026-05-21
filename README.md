# Islautopia Intercom Card

A lightning-fast, custom WebRTC 2-way audio intercom card for Home Assistant. Designed to work flawlessly with `go2rtc` and optimized for the Islautopia Garage ecosystem, but fully compatible with any standard `go2rtc` setup.

## ✨ Features

* **Ultra-Fast Video Loading:** Uses `recvonly` initialization and a dummy audio track to load video streams in ~1 second without waiting for microphone permissions.
* **Flawless 2-Way Audio (Hot-Swap):** Replaces tracks on the fly. No SDP renegotiation, no ICE restarts, and no dropped connections when you toggle the microphone.
* **Background Lifecycle Management:** Automatically closes connections when you navigate away from the Lovelace tab to save resources, and instantly revives the stream when you return.
* **Visual Lovelace Editor:** Fully configurable via the Home Assistant UI. No YAML required.
* **Integrated Door Unlock:** Built-in relay/door unlock button with a smart auto-close timer (1 to 20 seconds).
* **Smart Volume Memory:** Native volume slider that remembers your preferred listening level via `localStorage`.
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
4. Add `/local/islautopia-intercom-card.js` as a **JavaScript Module**.

## ⚙️ Configuration

The easiest way to configure the card is using the **Visual Editor** in your Lovelace dashboard. Just click "Add Card", search for "Islautopia Intercom", and fill in the fields.

### YAML Configuration Example

If you prefer YAML, here is a full configuration example:

```yaml
type: custom:islautopia-intercom-card
# REQUIRED: The name of your stream exactly as defined in your go2rtc config
stream: videoportero

# OPTIONAL: The URL to your external go2rtc instance. 
# Leave blank if you are using the Islautopia Add-on gateway.
go2rtc_url: [https://g2r.yourdomain.com](https://g2r.yourdomain.com)

# OPTIONAL: A switch, light, lock, or button entity to trigger the door relay
unlock_entity: switch.front_door_relay

# OPTIONAL: Auto-turn off the relay after X seconds (Default: 3)
unlock_duration: 3

# OPTIONAL: Card height (e.g., 400px, 60vh, auto). Default is auto (16/9 aspect ratio)
height: auto
```

## 🧠 How it Works (The Magic)

Unlike other WebRTC cards that drop the secure context (`https`) or fail to open the audio return channel dynamically, the Islautopia Intercom Card uses advanced WebRTC handling:
1. It creates a silent software audio track on load to trick `go2rtc` into opening a full bidirectional channel immediately.
2. When you click the microphone button, it simply performs a native `replaceTrack()` to swap the silent track with your actual physical microphone. 
3. It strictly matches the WebSocket protocol (`ws://` or `wss://`) to your current browser URL to prevent Mixed Content security blocking in modern browsers.

---
*Developed for Islautopia Garage.*
