import fetch from 'node-fetch';

const GEMINI_API_KEY = 'AIzaSyCs9ziMDLSwlruol8b9U7v5dsTFRq3k9sA';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=' + GEMINI_API_KEY;

/**
 * Query Gemini for a football match result by team names, league, and date.
 * @param homeTeam Home team name
 * @param awayTeam Away team name
 * @param league League name
 * @param date Date string (YYYY-MM-DD)
 * @returns JSON object with { home, away, homeScore, awayScore, winner } or { winner: 'not found' }
 */
export async function queryGeminiMatchResult(homeTeam: string, awayTeam: string, league: string, date: string) {
    const prompt = `Given the following football match info, return a JSON like: { "home": "Team A", "away": "Team B", "homeScore": 2, "awayScore": 1, "winner": "Team A" } If you can't find the result, return: { "winner": "not found" }\nMatch: ${homeTeam} vs ${awayTeam}, League: ${league}, Date: ${date}`;
    const body = {
        contents: [{ parts: [{ text: prompt }] }]
    };
    const res = await fetch(GEMINI_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
    const data = await res.json();
    // Gemini returns the text in data.candidates[0].content.parts[0].text
    try {
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) return { winner: 'not found' };
        // Try to extract JSON from the response
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
            return JSON.parse(match[0]);
        }
        return { winner: 'not found' };
    } catch (err) {
        return { winner: 'not found' };
    }
}
