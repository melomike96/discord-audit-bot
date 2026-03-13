

Melo Lounge is a community-first Discord server built around gaming, music, and a consistently active social vibe.

The goal is not to make just another generic server with default bots and dead channels. The goal is to create a place people actually want to join because it feels alive, has personality, and gives friends a reason to invite other friends.

This project also serves as a technical sandbox for building custom Discord features, automation, activity systems, and community tooling.

## Vision

Build Melo Lounge into a private-but-growing community of around 60 members where:

* friends invite other friends because the server has a strong communal vibe
* the environment feels active even when people are casually dropping in and out
* gaming, music, voice chat, and light automation all work together naturally
* custom features add personality without feeling invasive or over-engineered

## Core Principles

### Community first

Features should support the social atmosphere, not overpower it.

### Opt-in over surveillance

Anything involving activity or game presence should feel fun and voluntary, not like user tracking.

### Background polish

The best features should make the server feel alive without spamming or demanding attention.

### Identity matters

Melo Lounge should feel distinct from a generic Discord server through its culture, sound, theme, and custom tools.

### Build in public, grow carefully

The server can stay friend-rooted while slowly becoming a place others want to join through word of mouth.

## High-Level Roadmap

## Phase 1 - Foundation

**Goal:** Establish the core identity and basic custom behavior of the server.

### Focus

* define the tone and purpose of Melo Lounge
* get the custom Discord bot stable and always online
* create early “wow” moments that make the server feel unique

### Planned features

* custom bot deployment and uptime
* join/leave lounge presence messaging
* voice channel audio cues
* basic status logging for lounge activity
* clean channel structure and branding
* role setup for members, regulars, and admins

### Success criteria

* server feels different from a default Discord
* bot is reliable enough for everyday use
* members notice that the server has personality

## Phase 2 - Presence and Activity Layer

**Goal:** Make the server feel socially alive without becoming intrusive.

### Focus

* show who is around, what is active, and when people are gaming
* avoid making members feel watched or judged
* create lightweight ambient engagement

### Planned features

* “who’s loungin” activity feed
* optional gaming presence integration
* current game/activity posts in a dedicated channel
* lightweight session start/stop announcements
* active-now summaries such as who is gaming or in voice
* opt-in controls for users who want activity shown

### Success criteria

* activity feels fun, not invasive
* members can quickly tell if the server is alive
* people are more likely to hop in because they see motion

## Phase 3 - Culture and Identity Systems

**Goal:** Strengthen Melo Lounge as a place with a recognizable vibe.

### Focus

* deepen the music/gaming/community identity
* make the environment memorable
* create repeatable social rituals

### Planned features

* themed music integrations
* hip-hop inspired server flavor and messaging
* game night announcement system
* curated moments such as Friday-night lounge prompts
* member milestones or activity shoutouts
* custom emojis, sounds, and lounge-themed events

### Success criteria

* new members immediately understand the vibe
* regulars start associating Melo Lounge with a specific atmosphere
* the server feels like a community, not just a utility

## Phase 4 - Member Experience and Growth

**Goal:** Make the server easy to join, understand, and recommend.

### Focus

* improve onboarding for people who are not direct friends
* preserve the culture while allowing gradual growth
* encourage friend-of-friend expansion

### Planned features

* welcome flow for new members
* onboarding channel with server purpose and etiquette
* invite/referral growth through trusted members
* basic “start here” guidance for roles and channels
* community prompts to help new people join the conversation
* soft moderation and access controls

### Success criteria

* new members can quickly understand the server
* friend-of-friend invites become natural
* the server grows without losing identity

## Phase 5 - Analytics and Community Intelligence

**Goal:** Learn what makes the server active and worth returning to.

### Focus

* understand engagement patterns without overcomplicating things
* measure server health in a practical way
* use insights to improve vibe, not to micromanage members

### Planned features

* simple dashboards for active hours and popular games
* voice/activity trend summaries
* top community activity windows
* event participation tracking
* admin-only summaries for engagement patterns
* data used to improve timing of events and features

### Success criteria

* insights help create better activity, not just more data
* admin visibility improves without harming member trust
* the server becomes easier to grow intentionally

## Phase 6 - Public-Facing Brand Expansion

**Goal:** Turn Melo Lounge from a good Discord server into a recognizable small brand/community.

### Focus

* extend identity outside Discord
* support a broader community presence while keeping the original vibe
* test whether Melo Lounge can become a larger concept

### Planned features

* simple Melo Lounge website
* public landing page explaining the vibe and purpose
* branded visuals and identity system
* showcase of custom features or community highlights
* possible social accounts or community content clips
* future experiments with web dashboards or companion tools

### Success criteria

* Melo Lounge feels like more than a single server
* outsiders can understand the brand before joining
* community growth stays intentional and curated

## Feature Buckets

### Social presence

* lounge status posts
* active-now summaries
* voice presence indicators
* game/activity visibility

### Audio and atmosphere

* voice join sounds
* themed sound effects
* music-related integrations
* ambient server personality features

### Engagement

* game night prompts
* casual event announcements
* highlight posts
* community-driven channels and rituals

### Growth and onboarding

* welcome experience
* member roles
* invite-based growth
* server etiquette and orientation

### Admin tooling

* status logging
* lightweight analytics
* activity summaries
* moderation/support utilities

## Risks to Avoid

* overbuilding features that members never asked for
* making the server feel like it tracks people too aggressively
* spamming channels with too many bot messages
* building for novelty instead of real atmosphere
* turning the project into a performance instead of a community tool

## Product Philosophy

The best version of Melo Lounge is not a hyper-automated or over-engineered Discord server.

It is a server where the custom technology quietly supports a real social atmosphere.

People should join because it feels active, personal, and different.
The bot should enhance the lounge, not become the whole point of it.

## Near-Term Priorities

1. Stabilize the current bot and keep it simple.
2. Refine join/leave lounge behavior so it feels natural.
3. Design an opt-in activity concept that feels fun rather than invasive.
4. Keep building the identity of the server through subtle features.
5. Focus on features that make people say, “this server actually has personality.”

## Long-Term Outcome

A small but memorable community where:

* people regularly hang out
* gaming and music both matter
* the server has its own distinct flavor
* friends recommend it to others
* custom tooling supports the vibe behind the scenes

---

This README is meant to guide the project at a high level. Specific implementation details, bot commands, architecture, and deployment notes can be documented separately as the project evolves.
## Deployment

This bot's `!addtrack` command needs `yt-dlp` available on the host. The repo now handles that during `npm install` by downloading a project-local binary into `.runtime/bin/` when needed.

Use these commands in your deploy platform:

```bash
npm install
```

```bash
node index.js
```

The bot will first try `YT_DLP_PATH`, then a repo-local binary, then the system `PATH`. The older `render-build.sh` and `render-start.sh` wrappers can still be used, but they are no longer required for the default deploy path.

### Optional YouTube cookies

If YouTube blocks `!addtrack` with a sign-in or bot-check error, configure yt-dlp cookies for the bot process.

Supported environment variables:

- `YT_DLP_COOKIES_PATH`: path to a Netscape-format `cookies.txt` file available on the server
- `YT_DLP_COOKIES_B64`: base64-encoded Netscape-format `cookies.txt` contents
- `YT_DLP_USER_AGENT`: optional browser user-agent string to send alongside those cookies

The bot uses one shared server-side cookie session for all `!addtrack` requests. Any Discord member can trigger the command, but none of them provide their own browser session. If the cookies expire, an admin needs to refresh them.

### Library commands

- `!addtrack <youtube-url>` adds a YouTube track into `audio/library/library.json`
- `!library` (or `/library` as a text command) prints a preview of tracks currently marked `ready`

### Optional GitHub library sync

By default, `!addtrack` writes `audio/library/library.json` on the machine where the bot runs.

If you want added tracks to survive host restarts or redeploys, configure GitHub sync so the bot writes both the catalog and generated `.wav` files back into your repo:

- `GITHUB_SYNC_TOKEN`: GitHub token with `repo` content write access
- `GITHUB_SYNC_REPO`: repo in `owner/name` format
- `GITHUB_SYNC_BRANCH`: branch to update (optional, default `main`)
- `GITHUB_SYNC_FILE_PATH`: path to catalog file in repo (optional, default `audio/library/library.json`)

When these vars are set, each successful `!addtrack` will also PUT:

- `audio/library/library.json`
- the generated `audio/library/*.wav` file for that track
