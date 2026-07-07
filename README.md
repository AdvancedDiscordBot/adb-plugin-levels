# Levels & XP System

A plugin for AdvancedDiscordBot that adds experience points, levels, and role rewards based on user activity.

## Features

- Track XP per user per guild
- Award XP on message activity (with configurable rate limiting)
- Level-up notifications
- Role rewards for reaching specific levels
- Leaderboard commands
- Admin configuration

## Commands

- `/level` - Check your or another user's level and XP
- `/leaderboard` - View the server XP ranking (top 10)
- `/level-config` - Admin: Configure XP rates, cooldowns, and level-up channel
- `/level-roles` - Admin: Manage role rewards for specific levels

## Installation

1. Copy this folder to your bot's `plugins/` directory
2. Restart the bot (required for slash command registration)
3. Use `/level-config` to set up the plugin

## Configuration

- `xpPerMessage`: Amount of XP awarded per message (default: 5)
- `xpCooldown`: Seconds between XP awards for the same user (default: 60)
- `xpPerMinuteLimit`: Maximum XP a user can earn per minute (default: 100)
- `levelUpChannelId`: Channel ID for level-up announcements (optional)

## How It Works

XP is awarded based on message activity with anti-spam protection. Levels are calculated using the formula: `level = floor(sqrt(xp / 100))`.

When a user levels up:
- Their level is updated in the database
- A level-up event is emitted for other plugins to listen to
- A message is sent in the configured level-up channel (if set)
- Any role rewards for the new level are automatically assigned

## Database Models

The plugin creates three namespaced collections:
- `plugin_adb-plugin-levels_level` - Stores user XP and levels
- `plugin_adb-plugin-levels_levelconfig` - Stores guild configuration
- `plugin_adb-plugin-levels_leaderole` - Stores level-to-role mappings

## Dependencies

- discord.js ^14.14.1
- mongoose ^8.0.3

## License

MIT
