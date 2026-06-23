import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Wyświetla instrukcje i opis wszystkich komend bota'),
  async execute(interaction: ChatInputCommandInteraction) {
    const helpMessage = `# 🎯 **BetBros Bot - Instrukcja**

## 🏆 **Predykcje**

### \`/balance\` - Sprawdź swój wynik

### \`/bet\` - Wybierz mecz i predykcję (bot wysyła opcje w DM)
### \`/mybets\` - Twoje aktywne predykcje
### \`/bets\` - Aktywne predykcje wszystkich

## 📊 **Ranking i Statystyki**
### \`/leaderboard\` - Ranking według wyniku

## 💰 **Zasady Punktacji**

• **Start:** Każdy gracz zaczyna od 0 punktów
• **Przegrana:** -1 punkt
• **Wygrana:** kurs - 1 punktów
• **Zwrot:** 0 punktów

## ⚽ **Rozstrzyganie Zakładów**

• Predykcje są automatycznie rozstrzygane co godzinę
• Stare komendy monetowe są dostępne z prefixem \`legacy\`, np. \`/legacybet\`

---
**🎮 Powodzenia w typowaniu! 🎮**`;

    await interaction.reply({ content: helpMessage });
  },
};
