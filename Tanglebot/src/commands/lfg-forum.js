const { SlashCommandBuilder } = require('discord.js');
const { sendSetupMenu } = require('../utils/lfgForum');

module.exports = {
  requiredEnv: ['LFG_FORUM_CHANNEL_ID'],

  data: new SlashCommandBuilder()
    .setName('lfg-forum')
    .setDescription('Create a Looking For Group post as a forum thread (test version)'),

  async execute(interaction) {
    await sendSetupMenu(interaction);
  },
};
