const { SlashCommandBuilder, MessageFlags, EmbedBuilder } = require('discord.js');
const { readJson, writeJson } = require('../utils/db');
const { getRows, updateRow, appendRow } = require('../utils/googleSheets');
const { DEFAULT_EMBED_COLOR } = require('../utils/embedColor');

const TEMPLAR_ROLE_ID = process.env.TEMPLAR_ROLE_ID;

// Fixed tab name matching Tanglebot/example/donationhighscores_template.xlsx —
// the setup docs have users copy that file as their sheet, so this isn't configurable.
const SHEET_TAB = 'Donations';
const DATA_RANGE = `${SHEET_TAB}!A2:C`;
const APPEND_RANGE = `${SHEET_TAB}!A:C`;

// Donation tiers ordered highest → lowest so the first match is always the
// highest tier a total qualifies for; tiers below it stack (a Zenyte donor
// also keeps Onyx/Dragonstone/Diamond/Ruby). Thresholds are read from env at
// startup; defaults match the values already set in production.
const DONATION_TIERS = [
  {
    name:      'Zenyte',
    threshold: parseInt(process.env.DONATION_ZENYTE_THRESHOLD      ?? '1000000000', 10),
    roleEnv:   'DONATION_ZENYTE_ROLE_ID',
    emoji:     '<:Zenyte:1534398798384861214>',
  },
  {
    name:      'Onyx',
    threshold: parseInt(process.env.DONATION_ONYX_THRESHOLD        ??  '600000000', 10),
    roleEnv:   'DONATION_ONYX_ROLE_ID',
    emoji:     '<:Onyx:1534398660916543661>',
  },
  {
    name:      'Dragonstone',
    threshold: parseInt(process.env.DONATION_DRAGONSTONE_THRESHOLD ??  '300000000', 10),
    roleEnv:   'DONATION_DRAGONSTONE_ROLE_ID',
    emoji:     '<:Dragonstone:1534398539201904700>',
  },
  {
    name:      'Diamond',
    threshold: parseInt(process.env.DONATION_DIAMOND_THRESHOLD     ??  '150000000', 10),
    roleEnv:   'DONATION_DIAMOND_ROLE_ID',
    emoji:     '<:Diamond:1534398533074157568>',
  },
  {
    name:      'Ruby',
    threshold: parseInt(process.env.DONATION_RUBY_THRESHOLD        ??   '75000000', 10),
    roleEnv:   'DONATION_RUBY_ROLE_ID',
    emoji:     '<:Ruby:1534398699961188533>',
  },
];

function highestTierFor(donated) {
  return DONATION_TIERS.find(t => donated >= t.threshold) || null;
}

// Handles raw numbers, "300M", "150m", "75,000,000", "10.1m", etc. Returns
// null (rather than 0) for unparseable input so callers can tell "no amount"
// apart from a genuine zero.
function parseDonationAmount(raw) {
  const str = String(raw).trim().toUpperCase().replace(/,/g, '');
  const m = str.match(/^([\d.]+)([KMBT]?)$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (Number.isNaN(n)) return null;
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

const COINS_EMOJI = '<:coins:1534943128145105158>';
const HEADER_TITLE = `${COINS_EMOJI} How to Get on the Leaderboard ${COINS_EMOJI}`;
const EMBED_COLOR = DEFAULT_EMBED_COLOR;

// The badge shown next to a donor's mention on the leaderboard: their
// highest earned tier's emoji, or nothing if they haven't reached one.
function donorBadge(entry) {
  const tier = highestTierFor(entry.donated);
  return tier ? tier.emoji : '';
}

// A mention only renders as a clickable chip if the viewer's client has the
// user cached, which for a member who's left the guild it won't — falls back
// to their last known display name so the leaderboard doesn't show raw
// "<@id>" text for former members.
function mentionOrName(entry, memberIds) {
  return memberIds.has(entry.discordId) ? `<@${entry.discordId}>` : `**${entry.displayName}**`;
}

// Static instructions embed, prepended to the leaderboard on every post.
// The title lives as a "# " heading in the description rather than the
// embed's .setTitle() — that field is plain text only, no markdown, so it
// can't be rendered any larger than Discord's fixed title size.
function buildHeaderEmbed() {
  const templarMention = TEMPLAR_ROLE_ID ? `<@&${TEMPLAR_ROLE_ID}>` : '@Templar';

  return new EmbedBuilder()
    .setDescription(
      [
        `# ${HEADER_TITLE}`,
        '',
        'This is a list of donations to the clan! To make a donation, please reach out to ' +
          `${templarMention} directly, or add straight to the clan coffer in the Clan Hall and ` +
          `send a screenshot of your donation to ${templarMention} to get added or updated.`,
      ].join('\n')
    )
    .setColor(EMBED_COLOR);
}

// The leaderboard's heading is the combined total rather than a static
// "Donation High Scores" label — same "# " size, just the more useful number.
function totalDonatedHeading(totalDonated) {
  return `${COINS_EMOJI} Total Donated: ${formatGP(totalDonated)} ${COINS_EMOJI}`;
}

function buildEmbeds(entries, memberIds) {
  const header = buildHeaderEmbed();

  if (entries.length === 0) {
    return [
      header,
      new EmbedBuilder()
        .setDescription(`# ${totalDonatedHeading(0)}\n\nNo donations logged yet.`)
        .setColor(EMBED_COLOR),
    ];
  }

  const totalDonated = entries.reduce((sum, e) => sum + e.donated, 0);
  const heading = totalDonatedHeading(totalDonated);

  // entries is already sorted highest-first — the top donor's line gets the
  // full "# " heading size, everyone else gets the smaller "### " heading
  // (still bigger than plain text, without every mention looking oversized).
  const blocks = entries.map((entry, i) => {
    const badge = donorBadge(entry);
    const namePart = mentionOrName(entry, memberIds);
    const line = badge
      ? `${badge} ${namePart} | **${formatGP(entry.donated)}**`
      : `${namePart} | **${formatGP(entry.donated)}**`;
    return i === 0 ? `# ${line}` : `### ${line}`;
  });

  const bodies = [];
  let current = '';
  for (const block of blocks) {
    const candidate = current ? `${current}\n${block}` : block;
    if (candidate.length > 3900) {
      bodies.push(current);
      current = block;
    } else {
      current = candidate;
    }
  }
  if (current) bodies.push(current);

  return [
    header,
    ...bodies.map((body) =>
      new EmbedBuilder()
        .setDescription(`# ${heading}\n\n${body}`)
        .setColor(EMBED_COLOR)
    ),
  ];
}

// Discord caps a message at 10 embeds and ~6000 chars combined (separate
// from the ~4096 per-embed description cap already enforced in buildEmbeds).
// Packing must respect both or a big leaderboard gets rejected outright.
const MAX_EMBEDS_PER_MESSAGE = 10;
const MAX_MESSAGE_TOTAL_CHARS = 5800;

function embedCharCount(embed) {
  return embed.data.description?.length || 0;
}

function packEmbedsIntoMessages(embeds) {
  const messages = [];
  let current = [];
  let currentTotal = 0;

  for (const embed of embeds) {
    const size = embedCharCount(embed);
    const overCount = current.length >= MAX_EMBEDS_PER_MESSAGE;
    const overTotal = currentTotal + size > MAX_MESSAGE_TOTAL_CHARS;

    if (current.length > 0 && (overCount || overTotal)) {
      messages.push(current);
      current = [];
      currentTotal = 0;
    }

    current.push(embed);
    currentTotal += size;
  }

  if (current.length) messages.push(current);
  return messages;
}

// Fallback for stale stored message IDs (message deleted, data file reset
// by a redeploy, etc.) — scans recent channel history for the bot's own
// previous leaderboard post(s) so we can edit in place instead of spamming.
async function findPreviousLeaderboardMessages(channel, botUserId) {
  const fetched = await channel.messages.fetch({ limit: 50 });
  return [...fetched.values()]
    .filter(m => {
      if (m.author.id !== botUserId) return false;
      // Both the header and leaderboard embeds lead with a "# " heading
      // wrapping the coins emoji — the leaderboard heading's exact text
      // varies with the total, so match on that shared, stable prefix.
      return m.embeds[0]?.description?.startsWith(`# ${COINS_EMOJI}`);
    })
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

// entries is the FULL, freshly re-sorted leaderboard each run — message
// index i always gets whatever lands there this time, so a member moving
// between embeds just shows up correctly next post; no per-member state to patch.
async function postLeaderboard(guild, channelId, entries, botUserId) {
  const channel = await guild.channels.fetch(channelId);
  // Warmed once per post so mentionOrName can tell current members from
  // former ones without a fetch per leaderboard entry.
  await guild.members.fetch().catch(() => null);
  const memberIds = new Set(guild.members.cache.keys());
  const groups = packEmbedsIntoMessages(buildEmbeds(entries, memberIds));

  const stored = readJson('donationhighscores_message.json');
  const prevIds = Array.isArray(stored.messageIds) ? stored.messageIds : [];

  let prevMessages = await Promise.all(prevIds.map(id => channel.messages.fetch(id).catch(() => null)));

  if (!(prevIds.length > 0 && prevMessages.every(m => m))) {
    console.log('[DHS] Stored leaderboard message ID(s) missing or stale — scanning channel history to recover');
    const recovered = await findPreviousLeaderboardMessages(channel, botUserId);
    if (recovered.length) prevMessages = recovered;
  }

  const newIds = [];
  for (let i = 0; i < groups.length; i++) {
    const existing = prevMessages[i];
    if (existing) {
      try {
        await existing.edit({ embeds: groups[i] });
        newIds.push(existing.id);
        continue;
      } catch (err) {
        console.error(`[DHS] Could not edit message ${existing.id} (${err.message}), sending new...`);
      }
    }
    const sent = await channel.send({ embeds: groups[i] });
    newIds.push(sent.id);
  }

  // Delete any leftover messages from a previous run that had more chunks.
  for (let i = groups.length; i < prevMessages.length; i++) {
    const leftover = prevMessages[i];
    if (!leftover) continue;
    try {
      await leftover.delete();
    } catch {
      // Already deleted — ignore
    }
  }

  writeJson('donationhighscores_message.json', { messageIds: newIds });
  console.log(`[DHS] Leaderboard updated (${newIds.length} message${newIds.length === 1 ? '' : 's'})`);
}

async function loadEntries() {
  const rows = await getRows(process.env.DONATIONS_SHEET_ID, DATA_RANGE);
  return rows
    .map((r, i) => ({
      rowNumber: i + 2, // +2: header row + 1-indexed; kept pre-filter so blank rows don't shift it
      discordId: r[0] ? String(r[0]).trim() : '',
      displayName: r[1] ? String(r[1]).trim() : '',
      donated: r[2] ? parseInt(String(r[2]).replace(/,/g, '').trim(), 10) || 0 : 0,
    }))
    .filter(e => e.discordId);
}

function sortedForDisplay(entries) {
  return entries
    .filter(e => e.donated > 0)
    .sort((a, b) => b.donated - a.donated || a.displayName.localeCompare(b.displayName));
}

// Reposts the leaderboard once on bot startup, so manual edits to the
// Donations sheet (bulk imports, fixes, etc.) show up after a restart
// without needing a throwaway /donationhighscore add or remove. Checks the
// same vars as requiredEnv, since this runs outside commandHandler.
async function refreshLeaderboardOnStartup(client) {
  const channelId = process.env.DONATIONS_CHANNEL_ID;
  if (!process.env.DONATIONS_SHEET_ID || !channelId || !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return;

  try {
    const guild = await client.guilds.fetch(process.env.CLAN_ID);
    const entries = await loadEntries();
    await postLeaderboard(guild, channelId, sortedForDisplay(entries), client.user.id);
  } catch (err) {
    console.error('[DHS] Failed to refresh leaderboard on startup:', err);
  }
}

// Assigns every tier role the member's new total qualifies for and removes
// any tier role they no longer qualify for (tiers stack, so more than one
// role can change in a single call). Returns { tier } if their highest tier
// changed (tier is null if they now qualify for none), or null if unchanged.
async function syncDonationRoles(guild, discordId, previousDonated, newDonated) {
  const member = await guild.members.fetch(discordId).catch(() => null);
  if (!member) {
    console.warn(`[DHS] Could not fetch member ${discordId} to sync donation tier roles`);
    return null;
  }

  const highestIndex = DONATION_TIERS.findIndex(t => newDonated >= t.threshold);

  for (let i = 0; i < DONATION_TIERS.length; i++) {
    const tier = DONATION_TIERS[i];
    const roleId = process.env[tier.roleEnv];
    if (!roleId) continue;

    const role = guild.roles.cache.get(roleId);
    if (!role) {
      console.warn(`[DHS] ${tier.roleEnv} (${roleId}) not found in this guild`);
      continue;
    }

    const qualifies = highestIndex !== -1 && i >= highestIndex;
    const hasRole = member.roles.cache.has(roleId);

    if (qualifies && !hasRole) {
      await member.roles.add(role);
      console.log(`[DHS] Granted ${tier.name} donation role to ${member.user.tag}`);
    } else if (!qualifies && hasRole) {
      await member.roles.remove(role);
      console.log(`[DHS] Removed ${tier.name} donation role from ${member.user.tag}`);
    }
  }

  const prevTier = highestTierFor(previousDonated);
  const newTier = highestTierFor(newDonated);
  return prevTier?.name !== newTier?.name ? { tier: newTier } : null;
}

module.exports = {
  requiredEnv: ['DONATIONS_SHEET_ID', 'DONATIONS_CHANNEL_ID', 'GOOGLE_SERVICE_ACCOUNT_JSON'],
  refreshLeaderboardOnStartup,

  data: new SlashCommandBuilder()
    .setName('donationhighscore')
    .setDescription('Manage the donation high scores leaderboard')
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription("Add to a member's donation total")
        .addUserOption(o => o.setName('player').setDescription('Member who donated').setRequired(true))
        .addStringOption(o =>
          o.setName('amount').setDescription('Amount donated, e.g. 10m, 10k, 1b, 10.1m, or a raw number').setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription("Remove from a member's donation total (for fixing mistakes)")
        .addUserOption(o => o.setName('player').setDescription('Member to adjust').setRequired(true))
        .addStringOption(o =>
          o.setName('amount').setDescription('Amount to subtract, e.g. 10m, 10k, 1b, 10.1m, or a raw number').setRequired(true)
        )
    ),

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (TEMPLAR_ROLE_ID && !interaction.member.roles.cache.has(TEMPLAR_ROLE_ID)) {
      console.log(`[DHS] ${interaction.user.tag} was denied /donationhighscore ${subcommand} (missing Templar role)`);
      return interaction.reply({
        content: 'You need the Templar role to use this command.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const sheetId = process.env.DONATIONS_SHEET_ID;
    const channelId = process.env.DONATIONS_CHANNEL_ID;

    const targetUser = interaction.options.getUser('player', true);
    const amountInput = interaction.options.getString('amount', true);
    const amount = parseDonationAmount(amountInput);

    if (amount === null || amount <= 0) {
      console.warn(`[DHS] ${interaction.user.tag} submitted invalid amount "${amountInput}" for /donationhighscore ${subcommand}`);
      return interaction.reply({
        content: `Couldn't read a donation amount from "${amountInput}" — use a raw number or shorthand like \`10m\`, \`10k\`, \`1b\`, or \`10.1m\`.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const guild = interaction.guild;
      const member = await guild.members.fetch(targetUser.id).catch(() => null);
      if (!member) console.warn(`[DHS] Could not fetch member ${targetUser.id} (${targetUser.tag}) — falling back to username`);
      const displayName = member?.displayName || targetUser.username;

      const entries = await loadEntries();
      const existingIndex = entries.findIndex(e => e.discordId === targetUser.id);
      const existing = existingIndex === -1 ? null : entries[existingIndex];
      const currentAmount = existing ? existing.donated : 0;

      if (subcommand === 'remove' && currentAmount === 0) {
        console.log(`[DHS] ${interaction.user.tag} tried to remove from ${targetUser.tag}, who has no donations logged`);
        return interaction.editReply(`<@${targetUser.id}> doesn't have any donations logged.`);
      }

      let clamped = false;
      let newAmount;
      if (subcommand === 'add') {
        newAmount = currentAmount + amount;
      } else {
        newAmount = currentAmount - amount;
        if (newAmount < 0) {
          clamped = true;
          newAmount = 0;
        }
      }

      const rowValues = [targetUser.id, displayName, newAmount];

      if (existing) {
        await updateRow(sheetId, `${SHEET_TAB}!A${existing.rowNumber}:C${existing.rowNumber}`, rowValues);
        entries[existingIndex] = { ...existing, displayName, donated: newAmount };
      } else {
        await appendRow(sheetId, APPEND_RANGE, rowValues);
        entries.push({ discordId: targetUser.id, displayName, donated: newAmount });
      }

      if (subcommand === 'add') {
        console.log(`[DHS] ${interaction.user.tag} added ${formatGP(amount)} to ${targetUser.tag} (now ${formatGP(newAmount)})`);
      } else {
        console.log(`[DHS] ${interaction.user.tag} removed ${formatGP(amount)} from ${targetUser.tag} (now ${formatGP(newAmount)})`);
        if (clamped) console.warn(`[DHS] ${targetUser.tag}'s total would have gone negative — clamped to 0`);
      }

      const tierChange = await syncDonationRoles(guild, targetUser.id, currentAmount, newAmount);

      await postLeaderboard(guild, channelId, sortedForDisplay(entries), interaction.client.user.id);

      const verb = subcommand === 'add' ? 'Added' : 'Removed';
      const prep = subcommand === 'add' ? 'to' : 'from';
      let summary = `${verb} **${formatGP(amount)}** ${prep} <@${targetUser.id}>'s donation total. They now have **${formatGP(newAmount)}** GP donated.`;
      if (clamped) summary += ' (Clamped at 0 — they had less than that logged.)';

      if (tierChange) {
        summary += tierChange.tier
          ? `\n<@${targetUser.id}> is now at the **${tierChange.tier.name}** donation tier — roles updated.`
          : `\n<@${targetUser.id}> dropped below every donation tier and lost their tier role(s).`;
      }

      await interaction.editReply(summary);
    } catch (err) {
      console.error('[DHS] Fatal error:', err);
      await interaction.editReply(`Error: ${err.message}`);
    }
  },
};
