import { SlashCommandBuilder, ChatInputCommandInteraction, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuInteraction, ComponentType, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { connectMongo } from '../db/mongo';
import { CustomEvent } from '../db/customEvent';
import { CustomBet } from '../db/customBet';
import { User } from '../db/user';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('custombet')
        .setDescription('Place a bet on a custom event'),
    async execute(interaction: ChatInputCommandInteraction) {
        await interaction.reply({ content: 'Check your DMs to place your custom bet!', ephemeral: true });
        const user = interaction.user;
        const dm = await user.createDM();

        await connectMongo();

        // Get all unresolved custom events
        const activeEvents = await CustomEvent.find({ resolved: false });

        if (activeEvents.length === 0) {
            await dm.send('No active custom bets at the moment.');
            return;
        }

        // Show select menu for event selection
        const eventOptions = activeEvents.slice(0, 25).map(event => ({
            label: event.title.slice(0, 100),
            value: event.customEventId
        }));

        const eventMenu = new StringSelectMenuBuilder()
            .setCustomId('select_custom_event')
            .setPlaceholder('Select a custom bet event')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(eventOptions);

        const eventRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(eventMenu);

        await dm.send({
            content: 'Select the custom bet event:',
            components: [eventRow]
        });

        // Wait for event selection
        const eventCollector = dm.createMessageComponentCollector({
            filter: (i) => i.isStringSelectMenu() && i.user.id === user.id && i.customId === 'select_custom_event',
            componentType: ComponentType.StringSelect,
            time: 60000
        });

        eventCollector.once('collect', async (eventInteraction: StringSelectMenuInteraction) => {
            const customEventId = eventInteraction.values[0];
            const event = activeEvents.find(e => e.customEventId === customEventId);

            if (!event) {
                await eventInteraction.update({ content: 'Event not found.', components: [] });
                return;
            }

            // Get current user coins
            let dbUser = await User.findOne({ userId: user.id });
            if (!dbUser) dbUser = await User.create({ userId: user.id });

            // Calculate current odds
            const bets = await CustomBet.find({ customEventId: event.customEventId, resolved: false });
            const totalsByOutcome: { [key: string]: number } = {};
            
            // Initialize with initial pool from event (handle Map type)
            event.outcomes.forEach(outcome => {
                const poolValue = event.initialPool instanceof Map 
                    ? event.initialPool.get(outcome) 
                    : (event.initialPool as any)?.[outcome];
                totalsByOutcome[outcome] = poolValue || 0;
            });

            // Add real user bets
            bets.forEach(bet => {
                totalsByOutcome[bet.outcome] = (totalsByOutcome[bet.outcome] || 0) + bet.amount;
            });

            const totalPool = Object.values(totalsByOutcome).reduce((a, b) => a + b, 0);

            // Create buttons for each outcome
            const row = new ActionRowBuilder<ButtonBuilder>();
            event.outcomes.slice(0, 5).forEach((outcome, idx) => {
                const outcomeTotal = totalsByOutcome[outcome];
                const odds = outcomeTotal > 0 ? (totalPool / outcomeTotal).toFixed(2) : '1.00';
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`custombet_${idx}`)
                        .setLabel(`${outcome} (${odds}x)`)
                        .setStyle(ButtonStyle.Primary)
                );
            });

            await eventInteraction.update({
                content: `**${event.title}**\nYou have **${dbUser.coins}** coins.\nCurrent total pool: **${totalPool}** coins\nEnter your bet amount and click a button to bet:`,
                components: [row]
            });

            // Listen for bet button clicks
            const collector = dm.createMessageComponentCollector({
                filter: (i) => i.isButton() && i.user.id === user.id,
                componentType: ComponentType.Button,
                time: 24 * 60 * 60 * 1000
            });

            let lastOutcomes = event.outcomes;
            let lastEventInteraction = eventInteraction;

            collector.on('collect', async (i) => {
                const idx = parseInt(i.customId.replace('custombet_', ''));
                
                // Show modal for bet amount
                const modal = new ModalBuilder()
                    .setCustomId(`custombetmodal_${customEventId}_${idx}`)
                    .setTitle('Place Your Custom Bet');

                const amountInput = new TextInputBuilder()
                    .setCustomId('bet_amount')
                    .setLabel('Enter amount to bet')
                    .setStyle(TextInputStyle.Short)
                    .setPlaceholder('e.g. 100')
                    .setRequired(true);

                modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(amountInput));

                try {
                    await i.showModal(modal);
                } catch (err) {
                    try {
                        await i.reply({ content: 'This bet is no longer available or the interaction expired.', ephemeral: true });
                    } catch {}
                }

                lastEventInteraction = eventInteraction;
                lastOutcomes = event.outcomes;
            });

            collector.on('end', async () => {
                try {
                    const disabledRow = new ActionRowBuilder<ButtonBuilder>();
                    lastOutcomes.slice(0, 5).forEach((outcome, idx) => {
                        disabledRow.addComponents(
                            new ButtonBuilder()
                                .setCustomId(`custombet_${idx}`)
                                .setLabel(outcome)
                                .setStyle(ButtonStyle.Primary)
                                .setDisabled(true)
                        );
                    });
                    await lastEventInteraction.editReply({ components: [disabledRow] });
                } catch {}
            });
        });
    }
};
