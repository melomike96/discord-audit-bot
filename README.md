# Spotify Player Bot

This bot is now a Spotify-first Discord controller.

It connects to one Spotify account, reads that account's playlists, and lets Discord users start or control playback on that Spotify account's active Spotify Connect device.

## What It Does

- connects to your Spotify account with a refresh token
- lists your playlists in Discord
- starts one of your playlists on your Spotify device
- controls playback with pause, resume, next, previous, and volume commands
- stores a preferred Spotify device id locally for easier playback routing
- keeps a local account store ready for future per-user Spotify linking

## Important Constraint

This bot does not stream Spotify audio into Discord voice channels.

Spotify's API supports remote playback control on Spotify devices tied to the authenticated Spotify account, not arbitrary Discord voice streaming. So the bot acts as a Spotify controller for your account.

## Commands

- `!playlists [page]`
- `!play <number|playlist name>`
- `!spotify`
- `!pause`
- `!resume`
- `!next`
- `!previous`
- `!devices`
- `!setdevice <name|id>`
- `!volume <0-100>`
- `!spotifyaccount`
- `!linkspotify`

`!linkspotify` is a placeholder command for the future multi-account flow.

## Environment

Required:

- `DISCORD_TOKEN`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `SPOTIFY_REFRESH_TOKEN`

Optional:

- `SPOTIFY_DEVICE_ID`

## Spotify Setup

You need a Spotify app plus a user refresh token with playback scopes for the owner account.

At minimum, the token should cover:

- `user-read-playback-state`
- `user-modify-playback-state`
- `playlist-read-private`
- `playlist-read-collaborative`
- `user-read-currently-playing`

The account should have an active Spotify Connect device available when you start playback.

## Local Run

```bash
npm install
```

```bash
node index.js
```

For development:

```bash
npm run dev
```

## Local Storage

The bot writes `.spotify-accounts.json` in the repo root.

Right now it stores the preferred owner playback device. The same file is structured to support linked Discord user Spotify accounts later.

## Next Phase

The codebase now has a clean base for:

- Discord user to Spotify account linking
- user-specific playlist browsing
- permissions around who can control the owner account
- a future web companion for OAuth and account management
