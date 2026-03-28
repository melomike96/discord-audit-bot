# Bot Commands and Testing

This bot now supports both Spotify Connect control and native Discord voice playback sourced from YouTube matches.

## Where Commands Come From

- Main command routing: `index.js`
- Spotify API calls: `spotifyService.js`
- YouTube resolving (`yt-dlp`): `youtubeService.js`
- Discord voice queue/streaming: `discordPlaybackService.js`
- Shared library add/download flow: `audio/library/addTrackService.js`

## Commands

### `!playlists [page]`
Lists Spotify playlists for the connected owner account.

### `!play <number|playlist name>`
Starts playlist playback on Spotify Connect devices.

### `!discordplay <number|playlist name>`
Builds a Discord voice queue from Spotify playlist tracks by resolving each track against YouTube, then streams those tracks natively in Discord voice.

### `!nowplaying`
Shows Discord queue now-playing if active, otherwise falls back to Spotify now-playing.

### `!skip`, `!stop`
Discord voice queue controls.

### `!addmusic <youtube-url>`
Downloads and stores a YouTube track in `audio/library`, updating `library.json` and optional GitHub sync.

### Existing Spotify control commands
`!spotify`, `!pause`, `!resume`, `!next`, `!previous`, `!devices`, `!setdevice`, `!volume`, `!spotifyaccount`, `!linkspotify`
