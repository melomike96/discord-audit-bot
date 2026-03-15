# Melo Lounge Bot

Melo Lounge Bot is a custom Discord bot built for a music-first community server.

It handles lounge radio playback, library browsing, YouTube track importing, and lightweight voice presence features designed to make a server feel active without turning every event into channel spam.

## What It Does

- plays a curated lounge library in voice channels
- lets members browse the library from Discord with an embed and dropdown UI
- imports tracks from YouTube with `!addtrack`
- keeps a single live lounge status message instead of posting repeated join/leave messages
- supports optional GitHub sync for restoring the library after redeploys

## Current Features

- `!start` starts radio playback in the caller's current voice channel
- `!stop` stops playback and disconnects the bot
- `!skip` skips the current track
- `!track` shows the current track
- `!library` opens a paginated library view with track selection
- `!addtrack <youtube-url>` downloads and adds a new track to the library

## Project Goals

This project is part Discord bot, part community tooling sandbox.

The focus is simple:

- make the server feel alive
- keep the music experience central
- add personality without over-automating the community

## Tech Stack

- Node.js
- `discord.js`
- `@discordjs/voice`
- `yt-dlp`
- `ffmpeg`

## Local Run

Install dependencies:

```bash
npm install
```

Start the bot:

```bash
node index.js
```

For local development:

```bash
npm run dev
```

## Environment

At minimum, the bot expects:

- `DISCORD_TOKEN`
- `GENERAL_CHANNEL_ID`
- `LOUNGE_VOICE_CHANNEL_ID`
- `PRIVATE_VOICE_CHANNEL_ID`
- `LOG_CHANNEL_ID`

Optional YouTube import support:

- `YT_DLP_COOKIES_B64`
- `YT_DLP_USER_AGENT`
- `YT_DLP_PATH`

Optional GitHub library persistence:

- `GITHUB_SYNC_TOKEN`
- `GITHUB_SYNC_REPO`
- `GITHUB_SYNC_BRANCH`
- `GITHUB_SYNC_FILE_PATH`

## Deployment Notes

The repo uses a `postinstall` step to download a project-local `yt-dlp` binary into `.runtime/bin/` when needed.

Recommended deploy commands:

```bash
npm install
```

```bash
node index.js
```

If GitHub sync is configured, successful `!addtrack` imports can be written back to the repo and restored on startup.

## Status

This bot is active development software. The current direction is:

- cleaner Discord-native UI
- better music library flow
- stronger persistence and admin visibility
- eventual expansion into a companion website

## License

Private project unless otherwise stated.
