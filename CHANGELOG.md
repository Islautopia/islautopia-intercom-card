# Changelog

Earlier versions are described in the GitHub release notes of each tag.

## 1.10.0 — 2026-09-26: no configuration, live doorbell switcher

### Added
- **Doorbell switcher.** One card shows every doorbell of the `islautopia_doorbell` integration and
  switches between them live: a header capsule with a status dot, the doorbell's own name (never
  its id) and a double chevron (only when there is more than one). Switching hangs up the old
  doorbell at once (`bye`, peer connection, microphone, talk turn, timers) and builds a brand-new
  view for the new one, so nothing of the old doorbell (notices, quick replies, role, pause, open
  panels, an armed door) can show up on the new one. The dot is the session's own state and turns
  green only when video is actually playing. Last choice remembered per browser, else the first by
  name.
- Translated strings for the switcher, the empty state and the editor note in all 9 languages.

### Changed
- **The card has no options.** `type: custom:islautopia-intercom-card` is the whole YAML. The old
  options (`device_id`, `unlock_entity`, `unlock_duration`, `ring_entity`, `rec_entity`,
  `mode_entity`, `motion_entity`, `height`, `idle_release_seconds`) are ignored silently, so an
  existing dashboard keeps loading. Entities come from Home Assistant's registries (by translation
  key: `mode`, `rec`, `events`, `visitor`); the door always goes through the doorbell's own `open`
  (a Home Assistant lock is actuated by the doorbell, configured in the integration); the live view
  timeout is the integration's `number` entity; the size is measured.
- The visual editor only explains that there is nothing to configure and where the settings are.
- The card is no longer offered with a live preview in the card picker (a preview would open a real
  video session against a doorbell just by browsing the list).
- "Live" (tag and dot) now means *video is playing*: it is set by the first frames, no longer when
  the doorbell's offer is applied.

### Fixed
- The microphone button straddling the bottom edge of the video (controls scattered), when the
  stacked layout and the side rail were active at the same time (e.g. Panel view with a `height`,
  phones in landscape). They now exclude each other.
- Door open: the card waited 6 s for `open_result`, but a doorbell whose lock is a Home Assistant
  entity answers when Home Assistant confirms (up to ~8 s): the card said "the door did NOT open"
  while it was opening. It now waits 10 s.
- A microphone permission granted after the session changed (reconnection or doorbell switch) is
  released instead of opening the mic on a session nobody is in.
- The mode chip no longer shows the word "unavailable" as if it were a mode when the doorbell is
  unreachable.

### Removed
- The decorative "signal bars" at the bottom right of the video: they only repeated the connection
  state already shown by the live tag and responded to nothing.
