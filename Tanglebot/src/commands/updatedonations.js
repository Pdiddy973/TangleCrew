const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const axios = require('axios');
const { parse } = require('csv-parse/sync');
const { readJson, writeJson } = require('../utils/db');

const TEMPLAR_ROLE_ID = process.env.TEMPLAR_ROLE_ID;

// Donation tiers ordered highest → lowest so we label each entry with the highest earned tier.
// Thresholds are read from env at startup; defaults match the .env.example values.
const DONATION_TIERS = [
  {
    name:      'Zenyte',
    threshold: parseInt(process.env.DONATION_ZENYTE_THRESHOLD     ?? '1000000000', 10),
    roleEnv:   'DONATION_ZENYTE_ROLE_ID',
    emojiEnv:  'DONATION_EMOJI_ZENYTE',
  },
  {
    name:      'Onyx',
    threshold: parseInt(process.env.DONATION_ONYX_THRESHOLD       ??  '600000000', 10),
    roleEnv:   'DONATION_ONYX_ROLE_ID',
    emojiEnv:  'DONATION_EMOJI_ONYX',
  },
  {
    name:      'Dragonstone',
    threshold: parseInt(process.env.DONATION_DRAGONSTONE_THRESHOLD ?? '300000000', 10),
    roleEnv:   'DONATION_DRAGONSTONE_ROLE_ID',
    emojiEnv:  'DONATION_EMOJI_DRAGONSTONE',
  },
  {
    name:      'Diamond',
    threshold: parseInt(process.env.DONATION_DIAMOND_THRESHOLD    ?? '150000000', 10),
    roleEnv:   'DONATION_DIAMOND_ROLE_ID',
    emojiEnv:  'DONATION_EMOJI_DIAMOND',
  },
  {
    name:      'Ruby',
    threshold: parseInt(process.env.DONATION_RUBY_THRESHOLD       ??   '75000000', 10),
    roleEnv:   'DONATION_RUBY_ROLE_ID',
    emojiEnv:  'DONATION_EMOJI_RUBY',
  },
];

// Build a Discord custom-emoji string; falls back to empty string if the ID isn't set.
function customEmoji(id, name) {
  return id ? `<:${name}:${id}>` : '';
}

function tierEmoji(tier) {
  return customEmoji(process.env[tier.emojiEnv], tier.name.toLowerCase());
}

const COINS_EMOJI = '💰';

// Handles raw numbers, "300M", "150m", "75,000,000", etc.
function parseDonationAmount(raw) {
  const str = String(raw).trim().toUpperCase().replace(/,/g, '');
  if (!str) return 0;
  const m = str.match(/^([\d.]+)\s*([KMBT]?)$/);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const suffix = m[2];
  if (suffix === 'K') return Math.round(n * 1_000);
  if (suffix === 'M') return Math.round(n * 1_000_000);
  if (suffix === 'B') return Math.round(n * 1_000_000_000);
  if (suffix === 'T') return Math.round(n * 1_000_000_000_000);
  return Math.round(n);
}

function formatGP(amount) {
  return amount.toLocaleString('en-US');
}

function normalise(str) {
  return String(str).toLowerCase().replace(/[\s_-]/g, '');
}

async function fetchDonations() {
  const shareUrl = process.env.DONATIONS_SHEET_URL;
  if (!shareUrl) throw new Error('DONATIONS_SHEET_URL is not set in .env');

  let downloadUrl;
  const sheetsMatch = shareUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (sheetsMatch) {
    downloadUrl = `https://docs.google.com/spreadsheets/d/${sheetsMatch[1]}/export?format=csv`;
  } else {
    downloadUrl = shareUrl.includes('?') ? `${shareUrl}&download=1` : `${shareUrl}?download=1`;
  }

  console.log(`[updatedonations] Downloading from: ${downloadUrl}`);

  const response = await axios.get(downloadUrl, {
    responseType: 'text',
    maxRedirects: 10,
    timeout: 15_000,
    headers: { 'User-Agent': 'Tanglebot/1.0' },
  });

  const records = parse(response.data, { columns: true, skip_empty_lines: true });

  if (records.length === 0) throw new Error('No data found in the spreadsheet.');

  const headers    = Object.keys(records[0]);
  const idKey      = headers.find(k => normalise(k) === 'discordid');
  const donatedKey = headers.find(k =>
    ['donated', 'total', 'donations', 'gp', 'amount'].includes(normalise(k))
  );
  const nameKey = headers.find(k => normalise(k) === 'name');

  if (!idKey || !donatedKey) throw new Error(
    'Could not find donation data in the spreadsheet. ' +
    'Make sure a sheet has "DiscordID" and "Donated" column headers.'
  );

  return records
    .filter(r => r[idKey])
    .map(r => ({
      name:      nameKey ? String(r[nameKey]).trim() : null,
      discordId: String(r[idKey]).trim().replace(/\D/g, ''),
      donated:   parseDonationAmount(r[donatedKey]),
    }))
    .filter(r => r.discordId.length >= 17);
}

// Build one leaderboard entry line
function buildLine(entry) {
  const topTier = DONATION_TIERS.find(t => entry.donated >= t.threshold);
  const badge   = topTier ? `${tierEmoji(topTier)} ` : '';
  return `${badge}<@${entry.discordId}> — ${formatGP(entry.donated)}`;
}

const LEADERBOARD_HEADER = `# ${COINS_EMOJI} Donation High Scores ${COINS_EMOJI}`;

// Appends a header + list of lines to a summary, truncating the list (rather
// than the whole reply) so we stay under Discord's 2000-char message limit
// even when a large batch of members changed in one run.
function appendTruncatedList(base, header, lines) {
  if (!lines.length) return base;

  let body = lines.join('\n');
  if ((base + header + body).length > 1900) {
    let shown = 0;
    let truncated = '';
    for (const line of lines) {
      if ((base + header + truncated + line).length > 1850) break;
      truncated += (truncated ? '\n' : '') + line;
      shown++;
    }
    body = `${truncated}\n…and ${lines.length - shown} more`;
  }

  return base + header + body;
}

// Fallback for when the stored message ID(s) are stale (message deleted,
// data file reset by a redeploy, etc). Scans recent channel history for the
// bot's own previous leaderboard post(s) so we can still edit in place
// instead of spamming a brand-new message every time.
async function findPreviousLeaderboardMessages(channel, botUserId) {
  const fetched = await channel.messages.fetch({ limit: 50 });
  const ownMessages = [...fetched.values()]
    .filter(m => m.author.id === botUserId)
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  // Only trust the recovery if the earliest message actually looks like our
  // leaderboard header — otherwise we could hijack an unrelated bot message.
  if (!ownMessages.length || !ownMessages[0].content.startsWith(LEADERBOARD_HEADER)) return [];
  return ownMessages;
}

module.exports = {
  requiredEnv: ['DONATIONS_SHEET_URL', 'DONATIONS_CHANNEL_ID'],

  data: new SlashCommandBuilder()
    .setName('updatedonations')
    .setDescription('Sync donation roles and post the ranked leaderboard to the donations channel'),

  async execute(interaction) {
    // Role guard — Templar only
    if (TEMPLAR_ROLE_ID && !interaction.member.roles.cache.has(TEMPLAR_ROLE_ID)) {
      return interaction.reply({
        content: 'You need the Templar role to use this command.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const channelId = process.env.DONATIONS_CHANNEL_ID;
    if (!channelId) {
      return interaction.reply({
        content: '`DONATIONS_CHANNEL_ID` is not configured in `.env`.',
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    console.log(`[updatedonations] Started by ${interaction.user.tag}`);

    try {
      // ── 1. Fetch, deduplicate & sort donations ─────────────────────────────
      const raw = await fetchDonations();

      // Merge duplicate Discord IDs by summing their donations
      const merged = new Map();
      for (const entry of raw) {
        if (merged.has(entry.discordId)) {
          merged.get(entry.discordId).donated += entry.donated;
        } else {
          merged.set(entry.discordId, { ...entry });
        }
      }
      const entries = [...merged.values()].sort((a, b) => b.donated - a.donated);
      console.log(`[updatedonations] ${raw.length} rows → ${entries.length} unique donor(s) after dedup.`);

      // ── 1b. Diff against totals from the last run to see who donated since ─
      // Skip on the very first run (no prior totals) so we don't report every
      // existing donor's full total as a fresh "addition".
      const prevTotals = readJson('donations_totals.json');
      const hasPrevTotals = Object.keys(prevTotals).length > 0;
      const contributions = hasPrevTotals
        ? entries
            .map(entry => ({ discordId: entry.discordId, delta: entry.donated - (prevTotals[entry.discordId] ?? 0) }))
            .filter(c => c.delta > 0)
            .sort((a, b) => b.delta - a.delta)
        : [];

      // ── 2. Cache guild members so we can look them up by Discord ID ────────
      const guild = interaction.guild;
      await guild.members.fetch();

      // ── 3. Assign / remove donation tier roles ─────────────────────────────
      let assigned = 0;
      let removed  = 0;
      let notFound = 0;
      const upgrades = []; // { discordId, tier } — highest new tier earned per member this run

      for (const entry of entries) {
        const member = guild.members.cache.get(entry.discordId);
        if (!member) { notFound++; continue; }

        // DONATION_TIERS is ordered highest → lowest.
        // Find the highest tier earned; every tier below it is also granted.
        const highestIndex = DONATION_TIERS.findIndex(t => entry.donated >= t.threshold);
        let newTier = null;

        for (let i = 0; i < DONATION_TIERS.length; i++) {
          const tier   = DONATION_TIERS[i];
          const roleId = process.env[tier.roleEnv];
          if (!roleId) continue;

          const role = guild.roles.cache.get(roleId);
          if (!role) continue;

          const qualifies = highestIndex !== -1 && i >= highestIndex;
          const hasRole   = member.roles.cache.has(roleId);

          if (qualifies && !hasRole) {
            await member.roles.add(role);
            assigned++;
            // Tiers are iterated highest → lowest, so the first newly-added
            // role for this member is the highest new tier they reached.
            if (!newTier) newTier = tier;
          } else if (!qualifies && hasRole) {
            await member.roles.remove(role);
            removed++;
          }
        }

        if (newTier) upgrades.push({ discordId: entry.discordId, tier: newTier });
      }

      console.log(`[updatedonations] Roles done — +${assigned} assigned, -${removed} removed, ${notFound} not found in server.`);

      // ── 4. Build all lines ─────────────────────────────────────────────────
      const totalDonated = entries.reduce((sum, e) => sum + e.donated, 0);
      const ce = customEmoji(process.env.DONATION_EMOJI_COINS, 'coins');

      const allLines = [];
      allLines.push(`# ${COINS_EMOJI} Donation High Scores ${COINS_EMOJI}`);
      allLines.push('');
      allLines.push(`# ${ce} Total Donated: ${formatGP(totalDonated)} ${ce}`.trim());
      allLines.push('');

      entries.forEach((entry, i) => {
        const line = buildLine(entry);
        allLines.push(i === 0 ? `# ${line}` : line);
      });

      // Split lines into chunks that fit within Discord's 2000-char message limit
      const chunks = [];
      let current = '';
      for (const line of allLines) {
        const candidate = current ? `${current}\n${line}` : line;
        if (candidate.length > 2000) {
          chunks.push(current);
          current = line;
        } else {
          current = candidate;
        }
      }
      if (current) chunks.push(current);

      // ── 5. Post or edit in donations channel ───────────────────────────────
      const channel = await guild.channels.fetch(channelId);
      const stored  = readJson('donations_message.json');
      const prevIds = Array.isArray(stored.messageIds) ? stored.messageIds : (stored.messageId ? [stored.messageId] : []);

      let prevMessages = await Promise.all(
        prevIds.map(id => channel.messages.fetch(id).catch(() => null))
      );

      if (prevIds.length > 0 && prevMessages.every(m => m)) {
        console.log(`[updatedonations] Found previous message(s) from stored ID(s): ${prevIds.join(', ')}.`);
      } else {
        console.log(
          prevIds.length === 0
            ? '[updatedonations] No stored message ID(s), scanning channel history for a previous leaderboard post...'
            : '[updatedonations] Stored message ID(s) stale, scanning channel history for a previous leaderboard post...'
        );

        const recovered = await findPreviousLeaderboardMessages(channel, interaction.client.user.id);
        if (recovered.length) {
          console.log(`[updatedonations] Scan found ${recovered.length} previous leaderboard message(s): ${recovered.map(m => m.id).join(', ')}.`);
          prevMessages = recovered;
        } else {
          console.log('[updatedonations] Scan found no previous leaderboard message(s), will post new.');
        }
      }

      const newIds = [];

      for (let i = 0; i < chunks.length; i++) {
        const existing = prevMessages[i];
        if (existing) {
          try {
            await existing.edit({ content: chunks[i] });
            newIds.push(existing.id);
          } catch (err) {
            console.error(`[updatedonations] Could not edit message ${existing.id} (${err.message}), sending new...`);
            const sent = await channel.send({ content: chunks[i] });
            newIds.push(sent.id);
          }
        } else {
          const sent = await channel.send({ content: chunks[i] });
          newIds.push(sent.id);
        }
      }

      // Delete any leftover messages from a previous run that had more chunks
      for (let i = chunks.length; i < prevMessages.length; i++) {
        const leftover = prevMessages[i];
        if (!leftover) continue;
        try {
          await leftover.delete();
        } catch {
          // Already deleted — ignore
        }
      }

      writeJson('donations_message.json', { messageIds: newIds });

      const newTotals = {};
      for (const entry of entries) newTotals[entry.discordId] = entry.donated;
      writeJson('donations_totals.json', newTotals);

      console.log('[updatedonations] Done.');

      let summary = `Leaderboard posted to <#${channelId}>.`;

      summary = appendTruncatedList(
        summary,
        '\n\nDonations added this update:\n',
        contributions.map(c => `<@${c.discordId}> — +${formatGP(c.delta)}`)
      );

      if (assigned > 0 || removed > 0) {
        summary += `\n\nRoles updated: **+${assigned}** assigned, **-${removed}** removed.`;
      }

      summary = appendTruncatedList(
        summary,
        '\n\nNew roles granted:\n',
        upgrades.map(u => `${tierEmoji(u.tier)} <@${u.discordId}> → **${u.tier.name}**`.trim())
      );

      await interaction.editReply(summary);

    } catch (err) {
      console.error('[updatedonations] Fatal error:', err);
      await interaction.editReply(`Error: ${err.message}`);
    }
  },
};
