# Bot Commands and Testing

This file documents the current Spotify-only Discord command flow.

## Where Commands Come From

User text commands are handled in [index.js](/abs/path/C:/Users/mikes/Documents/GitHub/discord-audit-bot/index.js) inside the `client.on("messageCreate", ...)` listener.

Spotify API calls live in [spotifyService.js](/abs/path/C:/Users/mikes/Documents/GitHub/discord-audit-bot/spotifyService.js).

Local account and preferred-device storage lives in [spotifyAccountStore.js](/abs/path/C:/Users/mikes/Documents/GitHub/discord-audit-bot/spotifyAccountStore.js).

## Commands

### `!playlists [page]`

What it does:
- reads playlists from the connected Spotify owner account
- filters to playlists owned by that Spotify account
- caches the result for `!play <number>`

How to test:
1. Start the bot with valid Spotify credentials.
2. Type `!playlists`.
3. Confirm the playlist names match the owner Spotify account.
4. If there are more than 10 playlists, test `!playlists 2`.

### `!play <number|playlist name>`

What it does:
- starts a selected playlist on Spotify
- uses `SPOTIFY_DEVICE_ID` or the saved preferred device if present
- otherwise targets the currently active Spotify device on the connected account

How to test:
1. Open Spotify on the owner account on at least one device.
2. Type `!playlists`.
3. Type `!play 1`.
4. Confirm playback starts on the expected Spotify device.

### `!spotify`

What it does:
- shows the current Spotify playback item, playback state, and progress

How to test:
1. Start a playlist with `!play`.
2. Type `!spotify`.
3. Confirm the current track and state are correct.

### `!pause`, `!resume`, `!next`, `!previous`

What they do:
- control Spotify playback for the connected account

How to test:
1. Start playback.
2. Run each command once.
3. Confirm the Spotify device responds correctly.

### `!devices`

What it does:
- lists Spotify Connect devices available to the connected account
- marks the active device
- marks the locally saved preferred device if one exists

How to test:
1. Open Spotify on one or more devices.
2. Type `!devices`.
3. Confirm the listed devices match Spotify Connect.

### `!setdevice <name|id>`

What it does:
- stores a preferred Spotify device id in the local bot store

How to test:
1. Run `!devices`.
2. Copy a device id or use a unique device name.
3. Run `!setdevice <value>`.
4. Confirm `.spotify-accounts.json` is updated.

### `!volume <0-100>`

What it does:
- sets Spotify playback volume through the Web API

How to test:
1. Ensure the target device supports remote volume control.
2. Run `!volume 50`.
3. Confirm the device volume changes.

### `!spotifyaccount`

What it does:
- shows which Spotify owner account the bot is currently controlling
- shows the saved preferred device id if present

### `!linkspotify`

What it does:
- placeholder response only
- reserved for future Discord user to Spotify account linking

## Important Constraint

This bot does not send Spotify audio into Discord voice channels.

It controls playback on Spotify devices tied to the authenticated Spotify account. That is the supported Spotify path for this bot.
