import { SlashCommandBuilder, ChatInputCommandInteraction, User as DiscordUser } from 'discord.js';
import { connectMongo } from '../db/mongo';
import { Bet } from '../db/bet';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bets')
    .setDescription('Show all active bets for a user or everyone.')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to view bets for (leave empty for all)')
        .setRequired(false)
    ),
  async execute(interaction: ChatInputCommandInteraction) {
    await connectMongo();
    const targetUser = interaction.options.getUser('user');
    let bets;
    if (targetUser) {
      bets = await Bet.find({ userId: targetUser.id, resolved: false });
    } else {
      bets = await Bet.find({ resolved: false });
    }
    if (!bets.length) {
      await interaction.reply({ content: 'No active bets found.', ephemeral: true });
      return;
    }
    
    // Fetch usernames from Discord guild
    const usernames = await Promise.all(bets.map(async (bet) => {
      try {
        const member = await interaction.guild?.members.fetch(bet.userId);
        return member ? member.displayName : `Unknown (${bet.userId})`;
      } catch {
        return `Unknown (${bet.userId})`;
      }
    }));
    
    // Group bets by event (use eventName as key since eventId might not be unique)
    const eventGroups = new Map<string, { bets: any[], usernames: string[], matchDate: Date | null, eventName: string, league: string }>();
    
    bets.forEach((bet, i) => {
      const key = `${bet.eventName}_${bet.league}`;
      if (!eventGroups.has(key)) {
        eventGroups.set(key, {
          bets: [],
          usernames: [],
          matchDate: bet.matchDate || null,
          eventName: bet.eventName,
          league: bet.league
        });
      }
      const group = eventGroups.get(key)!;
      group.bets.push(bet);
      group.usernames.push(usernames[i]);
    });
    
    // Sort events by match date (events with date first, then events without date)
    const sortedEvents = Array.from(eventGroups.values()).sort((a, b) => {
      if (a.matchDate && b.matchDate) {
        return a.matchDate.getTime() - b.matchDate.getTime();
      }
      if (a.matchDate && !b.matchDate) return -1;
      if (!a.matchDate && b.matchDate) return 1;
      return 0;
    });
    
    // Build the message
    let desc = sortedEvents.map(event => {
      const dateStr = event.matchDate ? event.matchDate.toLocaleString('pl-PL', { 
        timeZone: 'Europe/Warsaw',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit'
      }) : '';
      
      const header = `**${event.eventName}**${dateStr ? ` (${dateStr})` : ''}`;
      const betLines = event.bets.map((bet, i) => {
        const name = event.usernames[i].padEnd(12);
        const amount = bet.amount.toString().padStart(4);
        const outcome = bet.outcome.padEnd(20);
        const odds = `(${bet.odds})`.padStart(6);
        return `${name} ${amount} ${outcome} ${odds}`;
      }).join('\n');
      
      return `${header}\n\`\`\`\n${betLines}\n\`\`\``;
    }).join('\n');
    
    await interaction.reply({ content: `**Active Bets:**\n${desc}` });
  },
};
