const { Events, MessageFlags } = require('discord.js');
const { syncCommands } = require('./commandHandler');
const { handleSubmissionMessage, loadSubmissionConfig } = require('../utils/submissionIntake');
const {
  handleHoneypotButtonInteraction,
  handleHoneypotMessage,
  loadHoneypotConfig,
  sendHoneypotStartupMessage,
} = require('../utils/honeypot');

function loadEvents(client) {
  const submissionConfig = loadSubmissionConfig();
  client.submissionConfig = submissionConfig;
  if (submissionConfig.enabled) {
    console.log('[eventHandler] Discord submission intake enabled.');
  }

  const honeypotConfig = loadHoneypotConfig();
  client.honeypotConfig = honeypotConfig;
  if (honeypotConfig.enabled) {
    console.log('[eventHandler] Honeypot channel trap enabled.');
  }

  client.once(Events.ClientReady, async (c) => {
    console.log(`[eventHandler] Logged in as ${c.user.tag}`);
    await syncCommands(client);

    const adminLogChannelId = process.env.ADMIN_LOG_CHANNEL_ID;
    if (adminLogChannelId) {
      try {
        const channel = await client.channels.fetch(adminLogChannelId);
        await channel.send('Bot is online and ready.');
      } catch (err) {
        console.error('[eventHandler] Failed to send startup message to admin log channel:', err);
      }
    }

    await sendHoneypotStartupMessage(client, honeypotConfig);
  });

  client.on(Events.MessageCreate, async (message) => {
    try {
      await handleSubmissionMessage(message, submissionConfig);
    } catch (err) {
      console.error('[eventHandler] Submission intake error:', err);
    }

    try {
      await handleHoneypotMessage(message, honeypotConfig, client);
    } catch (err) {
      console.error('[eventHandler] Honeypot error:', err);
    }
  });

  client.on(Events.MessageUpdate, async (_oldMessage, newMessage) => {
    const channelId = process.env.ANNOUNCEMENT_CHANNEL_ID;
    if (!channelId) return;
    if (newMessage.channelId !== channelId) return;
    if (newMessage.content !== '[Original Message Deleted]') return;
    try {
      await newMessage.delete();
    } catch (err) {
      console.error('[eventHandler] Failed to delete stale announcement message:', err);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isButton()) {
      if (interaction.customId.startsWith('hp:')) {
        try {
          await handleHoneypotButtonInteraction(interaction);
        } catch (err) {
          console.error('[eventHandler] Honeypot button interaction error:', err);
        }
      }
      return;
    }

    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) return;

    if (interaction.isAutocomplete()) {
      try {
        await command.autocomplete(interaction);
      } catch (err) {
        console.error('[eventHandler] Autocomplete error:', err);
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    try {
      await command.execute(interaction);
    } catch (err) {
      console.error('[eventHandler]', err);
      const msg = { content: 'Something went wrong running that command.', flags: MessageFlags.Ephemeral };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(msg);
      } else {
        await interaction.reply(msg);
      }
    }
  });
}

module.exports = { loadEvents };
