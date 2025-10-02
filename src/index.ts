
import dotenv from 'dotenv';
dotenv.config();
import { Client, GatewayIntentBits, Collection } from 'discord.js';
import fs from 'fs';
import path from 'path';
import { connectMongo } from './db/mongo';
import { initializeScheduler } from './scheduler/index';

import { ErrorLog } from './db/error';

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

(client as any).commands = new Collection();


// Load commands (if directory exists)
const commandsPath = path.join(__dirname, 'commands');
if (fs.existsSync(commandsPath)) {
    fs.readdirSync(commandsPath).forEach(file => {
        if (file.endsWith('.ts') || file.endsWith('.js')) {
            const command = require(path.join(commandsPath, file));
            (client as any).commands.set(command.data.name, command);
        }
    });
}

// Load events (if directory exists)
const eventsPath = path.join(__dirname, 'events');
if (fs.existsSync(eventsPath)) {
    fs.readdirSync(eventsPath).forEach(file => {
        if (file.endsWith('.ts') || file.endsWith('.js')) {
            const event = require(path.join(eventsPath, file));
            if (event.once) {
                client.once(event.name, (...args) => event.execute(...args, client));
            } else {
                client.on(event.name, (...args) => event.execute(...args, client));
            }
        }
    });
}

connectMongo().then(() => {

    // Initialize scheduled tasks
    initializeScheduler(client);

    // Global error handler
    async function logErrorToMongo(error: Error, location: string) {
        try {
            // Remove previous error log (keep only latest)
            await ErrorLog.deleteMany({});
            await ErrorLog.create({
                message: error.message,
                stack: error.stack || '',
                location,
                createdAt: new Date(),
            });
        } catch (mongoErr) {
            console.error('Failed to log error to MongoDB:', mongoErr);
        }
    }

    process.on('uncaughtException', async (err) => {
        console.error('Uncaught Exception:', err);
        await logErrorToMongo(err, 'uncaughtException');
    });

    process.on('unhandledRejection', async (reason: any) => {
        const error = reason instanceof Error ? reason : new Error(String(reason));
        console.error('Unhandled Rejection:', error);
        await logErrorToMongo(error, 'unhandledRejection');
    });

    client.login(process.env.DISCORD_TOKEN).catch(async (err) => {
        console.error('Login Error:', err);
        await logErrorToMongo(err, 'client.login');
    });
});
