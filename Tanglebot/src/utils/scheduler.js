const schedule = require('node-schedule');
const { readJson, writeJson } = require('./db');
const { EmbedBuilder } = require('discord.js');

const jobs = new Map();

function scheduleReminder(client, event) {
  const eventTime = new Date(event.datetime);
  const oneHourBefore = new Date(eventTime.getTime() - 60 * 60 * 1000);
  const now = Date.now();

  if (oneHourBefore > now) {
    const job = schedule.scheduleJob(`reminder-${event.id}`, oneHourBefore, () => {
      sendReminder(client, event, '1 hour');
    });
    if (job) jobs.set(`reminder-${event.id}`, job);
  }

  if (eventTime > now) {
    const job = schedule.scheduleJob(`start-${event.id}`, eventTime, () => {
      sendReminder(client, event, 'now');
      // Remove the event from storage after it fires
      const events = readJson('events.json');
      delete events[event.id];
      writeJson('events.json', events);
    });
    if (job) jobs.set(`start-${event.id}`, job);
  }
}

async function sendReminder(client, event, when) {
  try {
    const channel = await client.channels.fetch(event.channelId);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setColor(0xc8a951) // OSRS gold
      .setTitle(`⏰ Event Reminder: ${event.name}`)
      .setDescription(event.description || 'No description provided.')
      .addFields({ name: 'Starting', value: when === 'now' ? '**Right now!**' : 'in **1 hour**' })
      .setFooter({ text: 'Tanglebot • OSRS Clan Events' });

    await channel.send({ content: `@here`, embeds: [embed] });
  } catch (err) {
    console.error(`Failed to send reminder for event ${event.id}:`, err);
  }
}

function cancelReminders(eventId) {
  for (const key of [`reminder-${eventId}`, `start-${eventId}`]) {
    const job = jobs.get(key);
    if (job) {
      job.cancel();
      jobs.delete(key);
    }
  }
}

function restoreReminders(client) {
  const events = readJson('events.json');
  const now = Date.now();
  let restored = 0;

  for (const event of Object.values(events)) {
    if (new Date(event.datetime) > now) {
      scheduleReminder(client, event);
      restored++;
    }
  }

  if (restored > 0) console.log(`Restored ${restored} event reminder(s).`);
}

module.exports = { scheduleReminder, cancelReminders, restoreReminders };
