# BetBros Discord Bot

A Node.js Discord bot for score-based soccer predictions and leaderboards.

## Features
- Score-based predictions using external bookmaker odds
- Fixed-risk scoring: loss = -1, win = odds - 1, void = 0
- Match-winner, draw no bet, BTTS, goal totals, and exact-score predictions
- Leaderboards based on prediction score
- Automatic bet resolver
- Legacy coin commands kept under `/legacy...`
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
   API_FOOTBALL_KEY=your-api-football-key-here
   API_FOOTBALL_HOST=v3.football.api-sports.io
   USE_PROXY=false
   SOFASCORE_PROXY_PROVIDER=scrape-do
   SCRAPE_DO_TOKEN=your-scrape-do-token-here
   SCRAPE_DO_SUPER=true
   SCRAPE_DO_GEO_CODE=pl
   SCRAPE_DO_DEVICE=
   SCRAPE_DO_RENDER=false
   SCRAPE_DO_CUSTOM_HEADERS=false
   ODDSCHECKER_SCRAPE_DO_SUPER=true
   ODDSCHECKER_SCRAPE_DO_GEO_CODE=gb
   ODDSCHECKER_SCRAPE_DO_DEVICE=
   ODDSCHECKER_SCRAPE_DO_RENDER=false
   SCRAPING_ANT_API_KEY=your-scrapingant-key-here
   SCRAPING_ANT_BROWSER=false
   SCRAPING_ANT_PROXY_TYPE=
   SCRAPING_ANT_PROXY_COUNTRY=
   SOFASCORE_BOOKMAKER_ID=1137
   ```
   Set `USE_PROXY=true` to route SofaScore fallback requests through a scraping provider. Scrape.do worked against SofaScore odds with `SOFASCORE_PROXY_PROVIDER=scrape-do`, `SCRAPE_DO_SUPER=true`, and `SCRAPE_DO_GEO_CODE=pl`. `/bet` can also use OddsChecker as a World Cup Correct Score source through Scrape.do; keep `SCRAPE_DO_TOKEN` set and use `ODDSCHECKER_SCRAPE_DO_GEO_CODE=gb`. If using ScrapingAnt instead, set `SOFASCORE_PROXY_PROVIDER=scraping-ant`; if SofaScore still returns `423 Locked`, try ScrapingAnt settings such as `SCRAPING_ANT_PROXY_TYPE=residential` and `SCRAPING_ANT_PROXY_COUNTRY=pl`.
3. Start the bot:
   ```sh
   npm run start
   ```

## Folder Structure
- `src/` - Main source code
  - `commands/` - Command handlers
  - `events/` - Event listeners
  - `features/` - Betting, lootbox, inventory logic
  - `db/` - Database setup and models

---
Replace placeholders and extend features as needed for your use case.
