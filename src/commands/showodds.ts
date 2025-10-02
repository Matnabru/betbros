import { SlashCommandBuilder, ChatInputCommandInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle, Interaction, ComponentType, StringSelectMenuBuilder, StringSelectMenuInteraction, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { connectMongo } from '../db/mongo';
import { User } from '../db/user';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('bet')
        .setDescription('Show upcoming soccer events with odds.')
        .addStringOption(option =>
            option.setName('search')
                .setDescription('Search for a team or event name')
                .setRequired(false)
        ),
    async execute(interaction: ChatInputCommandInteraction) {
    // Always DM the user for betting flow
    await interaction.reply({ content: 'Check your DMs to place your bet!', ephemeral: true });
    const user = interaction.user;
    const dm = await user.createDM();
    const apiKey = process.env.ODDS_API_KEY;
    const region = 'eu';
    const leagueOptions = [
            { label: 'La Liga (Spain)', value: 'soccer_spain_la_liga' },
            { label: 'Premier League', value: 'soccer_epl' },
            { label: 'Ekstraklasa (Poland)', value: 'soccer_poland_ekstraklasa' },
            { label: 'FA Cup', value: 'soccer_fa_cup' },
            { label: 'FIFA World Cup Qualifiers - Europe', value: 'soccer_fifa_world_cup_qualifiers_europe' },
            { label: 'FIFA World Cup Winner', value: 'soccer_fifa_world_cup_winner' },
            { label: 'UEFA Champions League', value: 'soccer_uefa_champs_league' },
            { label: 'UEFA Europa Conference League', value: 'soccer_uefa_europa_conference_league' },
            { label: 'UEFA Europa League', value: 'soccer_uefa_europa_league' }
        ];
        const search = interaction.options.getString('search')?.toLowerCase() || '';
        // Show select menu for league selection in DM
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('select_league')
            .setPlaceholder('Select one or more leagues/tournaments')
            .setMinValues(1)
            .setMaxValues(leagueOptions.length)
            .addOptions(leagueOptions);
        const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
        await dm.send({
            content: 'Select the leagues/tournaments to search:',
            components: [selectRow]
        });

        // Wait for user to select leagues in DM
        const selectCollector = dm.createMessageComponentCollector({
            filter: (i) => i.isStringSelectMenu() && i.user.id === user.id,
            componentType: ComponentType.StringSelect,
            time: 60000
        });
        selectCollector?.on('collect', async (selectInteraction: StringSelectMenuInteraction) => {
            const selectedLeagues = selectInteraction.values;
            let foundEvents: any[] = [];
            let leagueMap: Record<string, string> = {};
            try {
                for (const league of selectedLeagues) {
                    const url = `https://api.the-odds-api.com/v4/sports/${league}/odds/?apiKey=${apiKey}&regions=${region}&markets=h2h&oddsFormat=decimal`;
                    const res = await fetch(url);
                    if (!res.ok) continue;
                    const data = await res.json();
                    if (!data.length) continue;
                    let events = data;
                    if (search) {
                        events = data.filter((ev: any) =>
                            ev.home_team.toLowerCase().includes(search) ||
                            ev.away_team.toLowerCase().includes(search)
                        );
                        if (!events.length) continue;
                    }
                    for (const ev of events) {
                        foundEvents.push({ ...ev, league });
                        leagueMap[ev.id] = leagueOptions.find(opt => opt.value === league)?.label || league;
                    }
                }
                if (!foundEvents.length) {
                    await selectInteraction.update({ content: 'No upcoming events found.', components: [] });
                    return;
                }
                // Show select menu for events only if there are any
                const eventOptions = foundEvents.slice(0, 25).map(ev => ({
                    label: `${ev.home_team} vs ${ev.away_team}`.slice(0, 100),
                    value: ev.id
                }));
                if (eventOptions.length === 0) {
                    await selectInteraction.update({ content: 'No upcoming events found.', components: [] });
                    return;
                }
                const eventMenu = new StringSelectMenuBuilder()
                    .setCustomId('select_event')
                    .setPlaceholder('Select an event')
                    .setMinValues(1)
                    .setMaxValues(1)
                    .addOptions(eventOptions);
                const eventRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(eventMenu);

                await selectInteraction.update({
                    content: 'Select the event to view odds:',
                    components: [eventRow]
                });
                // Stop the select menu collector to prevent further 'collect' events
                selectCollector?.stop();

                // Wait for event selection in DM
                const eventCollector = dm.createMessageComponentCollector({
                    filter: (i) => i.isStringSelectMenu() && i.user.id === user.id && i.customId === 'select_event',
                    componentType: ComponentType.StringSelect,
                    time: 60000
                });
                eventCollector?.on('collect', async (eventInteraction: StringSelectMenuInteraction) => {
                    const eventId = eventInteraction.values[0];
                    const event = foundEvents.find(ev => ev.id === eventId);
                    if (!event) {
                        await eventInteraction.update({ content: 'Event not found.', components: [] });
                        return;
                    }
                    await connectMongo();
                    const userId = eventInteraction.user.id;
                    let user = await User.findOne({ userId });
                    if (!user) user = await User.create({ userId });
                    const teams = event.home_team + ' vs ' + event.away_team;
                    const bookmaker = event.bookmakers[0];
                    const outcomes = bookmaker.markets[0].outcomes;
                    const row = new ActionRowBuilder<ButtonBuilder>();
                    outcomes.forEach((o: any, idx: number) => {
                        row.addComponents(
                            new ButtonBuilder()
                                .setCustomId(`bet_${idx}`)
                                .setLabel(`${o.name} (${o.price})`)
                                .setStyle(ButtonStyle.Primary)
                        );
                    });
                    await eventInteraction.update({
                        content: `**${teams}** (League: ${leagueMap[event.id]})\nYou have **${user.coins}** coins.\nEnter your bet amount and click a button to bet:`,
                        components: [row]
                    });

                    // Listen for bet button clicks
                    const filter = (i: Interaction) => i.isButton();
                    const collector = eventInteraction.channel?.createMessageComponentCollector({
                        filter,
                        componentType: ComponentType.Button,
                        time: 24 * 60 * 60 * 1000 // 24 hours
                    });
                    // Store for use in end handler
                    let lastEventInteraction = eventInteraction;
                    let lastOutcomes = outcomes;
                    collector?.on('collect', async (i) => {
                        const idx = parseInt(i.customId.replace('bet_', ''));
                        // Show modal for bet amount
                        const modal = new ModalBuilder()
                            .setCustomId(`betmodal_${event.id}_${idx}`)
                            .setTitle('Place Your Bet');
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
                        // Update last interaction for end handler
                        lastEventInteraction = eventInteraction;
                        lastOutcomes = outcomes;
                    });
                    collector?.on('end', async () => {
                        // Disable bet buttons after collector ends
                        try {
                            const disabledRow = new ActionRowBuilder<ButtonBuilder>();
                            lastOutcomes.forEach((o: any, idx: number) => {
                                disabledRow.addComponents(
                                    new ButtonBuilder()
                                        .setCustomId(`bet_${idx}`)
                                        .setLabel(`${o.name} (${o.price})`)
                                        .setStyle(ButtonStyle.Primary)
                                        .setDisabled(true)
                                );
                            });
                            await lastEventInteraction.editReply({ components: [disabledRow] });
                        } catch {}
                    });
                }); // <-- closes eventCollector?.on('collect', ...)
            // End of try block
            } catch (error) {
                await selectInteraction.update({ content: 'An error occurred while fetching events.', components: [] });
            }
        }); // <-- closes selectCollector?.on('collect', ...)
    } // <-- closes execute
};
