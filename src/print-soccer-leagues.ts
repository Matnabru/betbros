import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

async function printAllSoccerLeagues() {
    const apiKey = process.env.ODDS_API_KEY;
    const url = `https://api.the-odds-api.com/v4/sports/?apiKey=${apiKey}`;
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to fetch sports list');
        const sports = await res.json();
        const soccerLeagues = sports.filter((sport: any) => sport.group.toLowerCase().includes('soccer'));
        soccerLeagues.forEach((league: any) => {
            console.log(`${league.title} | key: ${league.key}`);
        });
        console.log(`\nTotal soccer leagues/tournaments: ${soccerLeagues.length}`);
    } catch (err) {
        console.error('Error:', err);
    }
}

printAllSoccerLeagues();
