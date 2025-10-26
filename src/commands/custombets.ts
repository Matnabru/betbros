import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { connectMongo } from '../db/mongo';
import { CustomEvent } from '../db/customEvent';
import { CustomBet } from '../db/customBet';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('custombets')
        .setDescription('View all active custom bets'),
    async execute(interaction: ChatInputCommandInteraction) {
        await connectMongo();

        const activeEvents = await CustomEvent.find({ resolved: false });

        if (activeEvents.length === 0) {
            await interaction.reply({ content: 'No active custom bets at the moment.', ephemeral: true });
            return;
        }

        const embed = new EmbedBuilder()
            .setTitle('📊 Active Custom Bets')
            .setColor(0x00AE86)
            .setTimestamp();

        for (const event of activeEvents) {
            // Calculate current odds for each outcome
            const bets = await CustomBet.find({ customEventId: event.customEventId, resolved: false });
            const totalsByOutcome: { [key: string]: number } = {};
            
            // Initialize with initial pool from event (handle Map type)
            event.outcomes.forEach(outcome => {
                const poolValue = event.initialPool instanceof Map 
                    ? event.initialPool.get(outcome) 
                    : (event.initialPool as any)?.[outcome];
                totalsByOutcome[outcome] = poolValue || 0;
            });

            // Add real user bets to the pool
            bets.forEach(bet => {
                totalsByOutcome[bet.outcome] = (totalsByOutcome[bet.outcome] || 0) + bet.amount;
            });

            const totalPool = Object.values(totalsByOutcome).reduce((a, b) => a + b, 0);

            let oddsText = '';
            event.outcomes.forEach(outcome => {
                const outcomeTotal = totalsByOutcome[outcome];
                const odds = outcomeTotal > 0 ? (totalPool / outcomeTotal).toFixed(2) : '0.00';
                const betCount = bets.filter(b => b.outcome === outcome).length;
                oddsText += `**${outcome}**: ${odds}x (${outcomeTotal} coins, ${betCount} bets)\n`;
            });

            embed.addFields({
                name: `🎲 ${event.title}`,
                value: oddsText || 'No bets placed yet',
                inline: false
            });
        }

        await interaction.reply({ embeds: [embed] });
    }
};
