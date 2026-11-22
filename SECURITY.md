# Security and privacy

## What the app touches

* **Camera.** Opened by the game page only after the consent screen, at 640 by 360. Each frame is copied to the Presage SDK in the Electron main process and dropped. Frames are never written to disk or sent anywhere by the game.
* **Presage key.** Read from the `PRESAGE_API_KEY` environment variable, from `.env` in development builds only, or from the key the player pastes in the game. A pasted key is encrypted with Electron safeStorage (Windows DPAPI) and saved to `%APPDATA%\The Vault\presage-key.json`. The game page can save or forget the key but can never read it back; the main process hands it only to the SDK constructor. It is never logged.
* **Local storage.** Job results, tell summaries (a few numbers per signal), stash and settings. No video, images or raw signal traces. The jobs screen has **Wipe my history**.
* **Network.** The game page's content security policy lets it load only its own files. The only outbound traffic is the Presage SDK signing in and metering usage, with SDK telemetry turned off. The one outside link (to get a free Presage key) opens in the system browser; any other navigation is blocked.
* **IPC.** The key and camera bridges only accept calls from the game's own page.

## Reporting a problem

Open a private security advisory on this repository, or email the maintainer listed on the GitHub profile. Please do not open a public issue for a security problem.
