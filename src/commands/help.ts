import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Wyświetla instrukcje i opis wszystkich komend bota'),
  async execute(interaction: ChatInputCommandInteraction) {
    const helpMessage = `# 🎯 **BetBros Bot - Instrukcja**

## 🏆 **Podstawowe Komendy Zakładów**

### \`/balance\` - Sprawdź saldo

### \`/bet\` - Postaw zakład (bot wysyła formularz w DM)
### \`/mybets\` - Twoje zakłady
### \`/bets\` - Zakłady wszystkich

## 📊 **Ranking i Statystyki**
### \`/leaderboard\` - Ranking graczy

## 🎁 **System Skrzynek**

### \`/crate\` - Odbierz skrzynkę raz w tygodniu
### \`/opencrate\` - Otwórz skrzynkę
• **Nagrody:** Monety (1-200)

## 💰 **Zasady Ekonomii**

• **Start:** Każdy nowy gracz otrzymuje 1000 monet
• **Zakłady:** Minimalna kwota zależy od kursu
• **Wypłaty:** Wygrana = Postawiona kwota × Kurs

## ⚽ **Rozstrzyganie Zakładów**

• Zakłady są automatycznie rozstrzygane co godzinę

---
**🎮 Powodzenia w zakładach! 🎮**`;

    await interaction.reply({ content: helpMessage });
  },
};