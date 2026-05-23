const { Events } = require('discord.js');
const { restoreReminders } = require('../utils/scheduler');

function loadEvents(client) {
  client.once(Events.ClientReady, async (c) => {
    console.log(`Logged in as ${c.user.tag}`);
    restoreReminders(client);
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) return;

    // Owner-only lock
    if (interaction.user.id !== process.env.OWNER_ID) {
      const deny = { content: 'You are not authorised to use this bot.', ephemeral: true };
      if (interaction.isAutocomplete()) return interaction.respond([]);
      return interaction.reply(deny);
    }

    if (interaction.isAutocomplete()) {
      try {
        await command.autocomplete(interaction);
      } catch (err) {
        console.error('Autocomplete error:', err);
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(err);
      const msg = { content: 'Something went wrong running that command.', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(msg);
      } else {
        await interaction.reply(msg);
      }
    }
  });
}

module.exports = { loadEvents };
