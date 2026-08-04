const { SlashCommandBuilder } = require('discord.js');
const { sendCategoryPicker } = require('../utils/lfgSuggestion');

module.exports = {
  requiredEnv: ['ADMIN_LOG_CHANNEL_ID'],

  data: new SlashCommandBuilder()
    .setName('lfg-suggestion')
    .setDescription('Suggest a new LFG activity or changes to an existing one')
    .addSubcommand((sub) => sub.setName('new').setDescription('Suggest a brand new activity (boss/raid/minigame)'))
    .addSubcommand((sub) =>
      sub.setName('edit').setDescription('Suggest changes to an existing activity (size, color, emoji, name)')
    ),

  async execute(interaction) {
    const mode = interaction.options.getSubcommand(); // 'new' | 'edit'
    await sendCategoryPicker(interaction, mode);
  },
};
