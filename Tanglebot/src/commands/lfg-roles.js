const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { buildMenuEmbed, buildCategoryButtonsRow, buildClearAllRow, MENU_MESSAGE_LIFETIME_MS } = require('../utils/roleMenu');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lfg-roles')
    .setDescription('Get your private LFG Roles menu (Bossing / Raids)'),

  async execute(interaction) {
    const embed = buildMenuEmbed();
    const row = buildCategoryButtonsRow();
    const clearRow = buildClearAllRow();

    await interaction.reply({ embeds: [embed], components: [row, clearRow], flags: MessageFlags.Ephemeral });

    // Auto-delete this menu after 60 seconds. Roles already picked stay assigned.
    setTimeout(() => {
      interaction.deleteReply().catch((err) => {
        console.error('Could not delete /lfg-roles menu message:', err.message);
      });
    }, MENU_MESSAGE_LIFETIME_MS);
  },
};
