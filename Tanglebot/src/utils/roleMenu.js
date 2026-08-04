const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');

// How long the ephemeral role menus stay open before auto-deleting.
// Roles already assigned are unaffected — this only deletes the menu message.
const MENU_MESSAGE_LIFETIME_MS = 60 * 1000;

// Roles this system manages get this prefix (e.g. "LFG-Yama") so they're easy to spot in the role list.
const ROLE_PREFIX = 'LFG-';

function lfgRoleName(baseName) {
  return `${ROLE_PREFIX}${baseName}`;
}

// Reports an operational issue to ADMIN_LOG_CHANNEL_ID as a red embed. Silently skipped if unset.
async function notifyAdminLog(client, title, description) {
  const adminLogChannelId = process.env.ADMIN_LOG_CHANNEL_ID;
  if (!adminLogChannelId) return;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(0xed4245)
    .setTimestamp();

  try {
    const channel = await client.channels.fetch(adminLogChannelId);
    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('Could not send LFG admin log notification:', err.message);
  }
}

// Builds a size-options list of 2..max players, plus an appended "Mass" option (for "N/mass" activities).
function sizeRangeWithMass(max) {
  const options = [];
  for (let n = 2; n <= max; n++) {
    options.push({ value: String(n), label: `${n} Players` });
  }
  options.push({ value: 'mass', label: 'Mass' });
  return options;
}

// ---- Category definitions ----
// Feeds /lfg-roles (buttons) and the /lfg-post Category -> Activity accordion.
// Missing roles are auto-created as "LFG-<roleName>" the first time they're actually needed (see ROLE_PREFIX above and ensureRoleExists below) — nothing is created up front.
// Rename any pre-existing plain-named role to add the "LFG-" prefix so it's reused instead of duplicated.
//
// ---- Copy/paste templates ----
// value, label, roleName, maxPlayers are required on every role entry below.
// emoji, sizeOptions, and color are all optional and independent — add any combination of them to any entry.
//
// Basic role:
//   { value: 'unique_key', label: 'Display Name', roleName: 'Exact Name', maxPlayers: N },
//
// + a "Mass" size option:
//   sizeOptions: sizeRangeWithMass(N),
//
// + a custom emoji (by ID only — no name needed):
//   emoji: { id: 'PUT_EMOJI_ID_HERE' },
//
// + a custom /lfg-post embed color — accepts a '#RRGGBB' hex string or a 0xRRGGBB number, whichever's easier.
// Omit to use the default (see DEFAULT_GROUP_COLOR in lfgGroup.js):
//   color: '#3498db',
//
// All combined on one entry:
//   { value: 'unique_key', label: 'Display Name', emoji: { id: 'PUT_EMOJI_ID_HERE' }, roleName: 'Exact Name', maxPlayers: N, sizeOptions: sizeRangeWithMass(N), color: '#3498db' },
//
// New category:
//   new_key: {
//     key: 'new_key',
//     buttonLabel: 'Label',
//     buttonEmoji: '🔥',
//     buttonStyle: ButtonStyle.Primary,
//     prompt: 'Pick the activities you want to be pingable for. Selected ones turn red and stay red until you click them again.',
//     roles: [ /* role entries above */ ],
//   },
const CATEGORIES = {
  bossing: {
    key: 'bossing',
    buttonLabel: 'Bossing',
    buttonEmoji: { id: '1381713946591105187' },
    buttonStyle: ButtonStyle.Primary,
    prompt: 'Pick the bosses you want to be pingable for. Selected ones turn red and stay red until you click them again.',
    roles: [
      { value: 'yama', label: 'Yama', emoji: { id: '1381816093336801340' }, roleName: 'Yama', maxPlayers: 2, color: '#9F0D19' },
      { value: 'nightmare', label: 'Nightmare', emoji: { id: 'PUT_EMOJI_ID_HERE' }, roleName: 'Nightmare', maxPlayers: 5, sizeOptions: sizeRangeWithMass(5) },
      { value: 'royal_titans', label: 'Titans', emoji: { id: 'PUT_EMOJI_ID_HERE' }, roleName: 'Royal Titans', maxPlayers: 2 },
      { value: 'hueycoatl', label: 'Huey', emoji: { id: 'PUT_EMOJI_ID_HERE' }, roleName: 'Hueycoatl', maxPlayers: 5 },
      { value: 'callisto', label: 'Callisto', roleName: 'Callisto', maxPlayers: 5 },
      { value: 'zilyana', label: 'Zilyana', roleName: 'Zilyana', maxPlayers: 5 },
      { value: 'corp', label: 'Corp', roleName: 'Corp', maxPlayers: 10 },
      { value: 'dks', label: 'DKS', roleName: 'DKS', maxPlayers: 3 },
      { value: 'graardor', label: 'Graardor', roleName: 'Graardor', maxPlayers: 5 },
      { value: 'kril', label: 'Kril', roleName: 'Kril', maxPlayers: 5 },
      { value: 'kree', label: 'Kree', roleName: 'Kree', maxPlayers: 5 },
      { value: 'nex', label: 'Nex', roleName: 'Nex', maxPlayers: 5, sizeOptions: sizeRangeWithMass(5) },
      { value: 'scurrius', label: 'Scurrius', roleName: 'Scurrius', maxPlayers: 5 },
      { value: 'venenatis', label: 'Venenatis', roleName: 'Venenatis', maxPlayers: 5 },
      { value: 'vetion', label: 'Vet\'ion', roleName: 'Vet\'ion', maxPlayers: 5 },
    ],
  },
  raids: {
    key: 'raids',
    buttonLabel: 'Raids',
    buttonEmoji: '💰',
    buttonStyle: ButtonStyle.Primary,
    prompt: 'Pick the raids you want to be pingable for. Selected ones turn red and stay red until you click them again.',
    roles: [
      { value: 'cox', label: 'CoX', emoji: { id: 'PUT_EMOJI_ID_HERE' }, roleName: 'CoX', maxPlayers: 7, sizeOptions: sizeRangeWithMass(7) },
      { value: 'toa', label: 'ToA', emoji: { id: 'PUT_EMOJI_ID_HERE' }, roleName: 'ToA', maxPlayers: 8 },
      { value: 'tob', label: 'ToB', emoji: { id: 'PUT_EMOJI_ID_HERE' }, roleName: 'ToB', maxPlayers: 5 },
    ],
  },
  minigames: {
    key: 'minigames',
    buttonLabel: 'Minigame',
    buttonEmoji: '⚒️',
    buttonStyle: ButtonStyle.Primary,
    prompt: 'Pick the minigames you want to be pingable for. Selected ones turn red and stay red until you click them again.',
    roles: [
      { value: 'tempoross', label: 'Tempoross', roleName: 'Tempoross', maxPlayers: 10 },
      { value: 'zalcano', label: 'Zalcano', roleName: 'Zalcano', maxPlayers: 10 },
      { value: 'wintertodt', label: 'Wintertodt', roleName: 'Wintertodt', maxPlayers: 10 },
      { value: 'gotr', label: 'GOTR', roleName: 'GOTR', maxPlayers: 10 },
      { value: 'soul_wars', label: 'Soul Wars', roleName: 'Soul Wars', maxPlayers: 10, sizeOptions: sizeRangeWithMass(10) },
      { value: 'castle_wars', label: 'Castle Wars', roleName: 'Castle Wars', maxPlayers: 10, sizeOptions: sizeRangeWithMass(10) },
      { value: 'barb_assault', label: 'Barb Assault', roleName: 'Barb Assault', maxPlayers: 5 },
    ],
  },
};

// customId scheme used for all buttons here:
//   "roles:category:<categoryKey>"          — top-level Bossing/Raids button
//   "roles:toggle:<categoryKey>:<roleValue>" — a specific boss/raid toggle
//   "roles:clearall"                         — removes every LFG- role the member has
// eventHandler.js routes any button whose customId starts with "roles:" here.

function buildMenuEmbed() {
  return new EmbedBuilder()
    .setTitle('LFG Roles')
    .setDescription(
      'Click **Bossing** or **💰 Raids** to pick specific bosses/raids. ' +
      'Selected ones turn red.\n\n' +
      'Once you have a role, anyone can `@mention` it to notify everyone ' +
      'signed up when that event is happening.\n\n' +
      'Click **Clear All LFG Roles** to remove every LFG role you have in one go.\n\n' +
      '_This message will delete itself in 60 seconds — your roles stay either way._'
    )
    .setColor(0xc2a24c)
    .setFooter({ text: 'Old School RuneScape Event Notifications' });
}

function buildCategoryButtonsRow() {
  const buttons = Object.values(CATEGORIES).map((cat) =>
    new ButtonBuilder()
      .setCustomId(`roles:category:${cat.key}`)
      .setLabel(cat.buttonLabel)
      .setEmoji(cat.buttonEmoji)
      .setStyle(cat.buttonStyle)
  );
  return new ActionRowBuilder().addComponents(buttons);
}

function buildClearAllRow() {
  const clearAll = new ButtonBuilder()
    .setCustomId('roles:clearall')
    .setLabel('Clear All LFG Roles')
    .setStyle(ButtonStyle.Danger);
  return new ActionRowBuilder().addComponents(clearAll);
}

function buildCategoryButtonRows(categoryKey, member) {
  const category = CATEGORIES[categoryKey];

  const buttons = category.roles.map((r) => {
    const has = memberHasRoleName(member, r.roleName);
    const btn = new ButtonBuilder()
      .setCustomId(`roles:toggle:${categoryKey}:${r.value}`)
      .setLabel(r.label)
      .setStyle(has ? ButtonStyle.Danger : ButtonStyle.Secondary);
    if (isValidEmoji(r.emoji)) btn.setEmoji(r.emoji);
    return btn;
  });

  return chunkIntoRows(buttons, 5).map((chunk) => new ActionRowBuilder().addComponents(chunk));
}

async function sendCategoryMenu(interaction, categoryKey, isUpdate) {
  const category = CATEGORIES[categoryKey];
  const rows = buildCategoryButtonRows(categoryKey, interaction.member);
  const payload = { content: category.prompt, components: rows, flags: MessageFlags.Ephemeral };

  if (isUpdate) {
    await interaction.update(payload);
  } else {
    await interaction.reply(payload);
  }

  // Auto-delete this submenu after 60 seconds. Roles already picked stay assigned.
  setTimeout(() => {
    interaction.deleteReply().catch((err) => {
      console.error('Could not delete role submenu message:', err.message);
    });
  }, MENU_MESSAGE_LIFETIME_MS);
}

async function handleRoleToggle(interaction, categoryKey, value) {
  const category = CATEGORIES[categoryKey];
  if (!category) return;

  const roleConfig = category.roles.find((r) => r.value === value);
  if (!roleConfig) return;

  const guild = interaction.guild;
  const member = interaction.member;
  const role = await ensureRoleExists(guild, roleConfig.roleName);

  if (!role) {
    await notifyAdminLog(
      interaction.client,
      '⚠️ LFG Role Creation Failed',
      `Couldn't find or create **${lfgRoleName(roleConfig.roleName)}** for <@${interaction.user.id}> via /lfg-roles. Check the bot's **Manage Roles** permission.`
    );
    return interaction.reply({
      content: `⚠️ I couldn't find or create the role **${lfgRoleName(roleConfig.roleName)}**. Make sure I have the **Manage Roles** permission.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  try {
    if (member.roles.cache.has(role.id)) {
      await member.roles.remove(role);
    } else {
      await member.roles.add(role);
    }
  } catch (err) {
    console.error('Role toggle error:', err);
    await notifyAdminLog(
      interaction.client,
      '⚠️ LFG Role Assignment Failed',
      `Couldn't add/remove **${lfgRoleName(roleConfig.roleName)}** for <@${interaction.user.id}> via /lfg-roles: ${err.message}. Make sure the bot's role sits above it.`
    );
    return interaction.reply({
      content: '⚠️ I couldn\'t update your roles. Make sure my role sits above these roles.',
      flags: MessageFlags.Ephemeral,
    });
  }

  // Re-render the same ephemeral menu with the button now toggled red/grey
  return sendCategoryMenu(interaction, categoryKey, true);
}

async function handleClearAllRoles(interaction) {
  const member = interaction.member;
  const lfgRoles = member.roles.cache.filter((r) => r.name.startsWith(ROLE_PREFIX));

  if (lfgRoles.size === 0) {
    return interaction.reply({ content: 'You don\'t have any LFG roles to clear.', flags: MessageFlags.Ephemeral });
  }

  try {
    await member.roles.remove(lfgRoles);
  } catch (err) {
    console.error('Clear all LFG roles error:', err);
    await notifyAdminLog(
      interaction.client,
      '⚠️ LFG Role Clear Failed',
      `Couldn't clear LFG roles for <@${interaction.user.id}>: ${err.message}. Make sure the bot's role sits above them.`
    );
    return interaction.reply({
      content: '⚠️ I couldn\'t clear your roles. Make sure my role sits above these roles.',
      flags: MessageFlags.Ephemeral,
    });
  }

  return interaction.reply({
    content: `✅ Cleared ${lfgRoles.size} LFG role(s).`,
    flags: MessageFlags.Ephemeral,
  });
}

// Entry point called from eventHandler.js for any button customId starting with "roles:"
async function handleRoleMenuButtonInteraction(interaction) {
  const parts = interaction.customId.split(':'); // ["roles", "category"|"toggle"|"clearall", ...]
  const kind = parts[1];

  if (kind === 'category') {
    const categoryKey = parts[2];
    if (!CATEGORIES[categoryKey]) return;
    return sendCategoryMenu(interaction, categoryKey, false);
  }

  if (kind === 'toggle') {
    const [, , categoryKey, value] = parts;
    return handleRoleToggle(interaction, categoryKey, value);
  }

  if (kind === 'clearall') {
    return handleClearAllRoles(interaction);
  }
}

// Looks up the prefixed role for a base name (e.g. "Yama" -> "LFG-Yama").
function findRole(guild, name) {
  return guild.roles.cache.find((r) => r.name === lfgRoleName(name));
}

// Finds the role, creating it first if it's missing.
async function ensureRoleExists(guild, name) {
  const existing = findRole(guild, name);
  if (existing) return existing;

  try {
    const role = await guild.roles.create({
      name: lfgRoleName(name),
      mentionable: true,
      reason: 'Auto-created for the LFG system (roleMenu.js CATEGORIES)',
    });
    console.log(`Created missing LFG role: "${role.name}"`);
    return role;
  } catch (err) {
    console.error(`Could not auto-create LFG role "${lfgRoleName(name)}":`, err.message);
    return null;
  }
}

function memberHasRoleName(member, roleName) {
  const role = findRole(member.guild, roleName);
  return role ? member.roles.cache.has(role.id) : false;
}

// A real Discord snowflake ID is a string of digits (typically 17-20 long).
// This catches leftover placeholders like "PUT_EMOJI_ID_HERE" so we don't send an invalid emoji and silently fail the interaction.
function isValidEmoji(emoji) {
  return !!emoji && typeof emoji.id === 'string' && /^\d{15,25}$/.test(emoji.id);
}

// Renders a custom emoji object as inline markup usable in message/embed text (e.g. a title).
// Discord resolves the emoji by ID here, so the name segment doesn't need to be accurate.
// Returns null if there's no valid custom emoji, so callers can fall back to a default.
function emojiMarkup(emoji) {
  return isValidEmoji(emoji) ? `<:_:${emoji.id}>` : null;
}

function chunkIntoRows(items, size) {
  const rows = [];
  for (let i = 0; i < items.length; i += size) {
    rows.push(items.slice(i, i + size));
  }
  return rows;
}

module.exports = {
  CATEGORIES,
  MENU_MESSAGE_LIFETIME_MS,
  buildMenuEmbed,
  buildCategoryButtonsRow,
  buildClearAllRow,
  handleRoleMenuButtonInteraction,
  ensureRoleExists,
  lfgRoleName,
  notifyAdminLog,
  emojiMarkup,
};
