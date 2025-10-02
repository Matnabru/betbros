# BetBros Discord Bot

A Node.js Discord bot for custom and standard betting, lootboxes, inventory, and leaderboards.

## Features
- Standard bets (odds imported from bookmakers)
- Weekly lootbox claim
- User inventory (coins, lootboxes)
- Bet placement and voting
- Display active bets
- Automatic bet resolver
- (TODO) Custom bets (created by moderators)
- (TODO) Bonus lootbox for top weekly performer
- (TODO) Channel and moderator role configuration
- (TODO) Leaderboards (weekly, monthly, total)

## Tech Stack
- Node.js
- discord.js
- MongoDB

## Setup
1. Install dependencies:
   ```sh
   npm install
   ```
2. Create a `.env` file with your Discord bot token:
   ```env
   DISCORD_TOKEN=your-bot-token-here
   ```
3. Start the bot:
   ```sh
   node src/index.js
   ```

## Folder Structure
- `src/` - Main source code
  - `commands/` - Command handlers
  - `events/` - Event listeners
  - `features/` - Betting, lootbox, inventory logic
  - `db/` - Database setup and models

---
Replace placeholders and extend features as needed for your use case.
