import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.API_FOOTBALL_KEY || process.env.API_SPORTS_KEY;

async function fetchLeagues() {
    if (!apiKey) {
        throw new Error('API_FOOTBALL_KEY is not set');
    }

    try {
        const res = await fetch('https://v3.football.api-sports.io/leagues', {
            method: 'GET',
            headers: {
                'x-apisports-key': apiKey
            }
        });
        const data = await res.json();
        if (data.response) {
            for (const league of data.response) {
                console.log(`Name: ${league.league.name}, Country: ${league.country.name}, ID: ${league.league.id}`);
            }
        } else {
            console.log('No leagues found:', data);
        }
    } catch (err) {
        console.error('Error fetching leagues:', err);
    }
}

fetchLeagues();
