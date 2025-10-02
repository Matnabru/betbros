import fetch from 'node-fetch';

const apiKey = '72e2a0d1bbcfb50a7dd0eb4d2cbfcf9d'; // Your API-Football key

async function fetchLeagues() {
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
