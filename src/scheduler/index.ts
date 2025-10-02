import cron from 'node-cron';
import { autoResolveBets } from './autoresolve';
import { Client } from 'discord.js';

/**
 * Initialize scheduled tasks for the bot
 */
export function initializeScheduler(client: Client) {
  console.log('[Scheduler] Initializing scheduled tasks...');

  // Run auto-resolve every hour
  cron.schedule('0 * * * *', async () => {
    console.log('[Scheduler] Running hourly auto-resolve task...');
    try {
      await autoResolveBets(client);
    } catch (err) {
      console.error('[Scheduler] Error in hourly auto-resolve:', err);
    }
  }, {
    timezone: "UTC"
  });

  // Optional: Run at startup with delay
  setTimeout(async () => {
    console.log('[Scheduler] Running initial auto-resolve...');
    try {
      await autoResolveBets(client);
    } catch (err) {
      console.error('[Scheduler] Error in initial auto-resolve:', err);
    }
  }, 10000); // Wait 10 seconds after startup

  console.log('[Scheduler] Scheduled tasks initialized');
}