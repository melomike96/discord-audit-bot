# Spotify + YouTube Discord Audio Bot

This bot now supports **native Discord voice playback** powered by Spotify playlist selection and YouTube audio sources.

## What It Does

- Connects to one Spotify account and reads that account's playlists.
- Keeps Spotify Connect controls (`!play`, `!pause`, etc.) for remote Spotify playback.
- Plays playlist audio natively in Discord voice using `!discordplay`:
  - reads tracks from a Spotify playlist
  - resolves each track to YouTube with `yt-dlp`
  - streams audio into Discord voice
- Lets users add YouTube tracks to the shared repo library with `!addmusic <youtube-url>`.

## Commands

- `!playlists [page]`
- `!play <number|playlist name>` (Spotify Connect playback)
- `!discordplay <number|playlist name>` (Discord voice playback)
- `!spotify`
- `!nowplaying`
- `!pause`
- `!resume`
- `!next`
- `!previous`
- `!devices`
- `!setdevice <name|id>`
- `!volume <0-100>`
- `!skip` (skip Discord voice track)
- `!stop` (stop Discord voice queue)
- `!addmusic <youtube-url>` (add to shared library repo)
- `!spotifyaccount`
- `!linkspotify`

## Environment

Required:

- `DISCORD_TOKEN`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `SPOTIFY_REFRESH_TOKEN`

Optional:

- `SPOTIFY_DEVICE_ID`
- `DISCORD_PLAYLIST_TRACK_LIMIT` (default `20`)
- `YT_DLP_PATH` (custom yt-dlp binary path)

For shared-library GitHub sync in `!addmusic`, existing optional sync vars still apply (`GITHUB_SYNC_*`).

## Notes

- Spotify audio is **not** directly streamed (Spotify API does not provide raw audio streaming for Discord bots).
- Native Discord playback is sourced from YouTube matches for Spotify track metadata.
- Best results require a working `yt-dlp` binary and ffmpeg (provided by `ffmpeg-static`).
