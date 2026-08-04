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

// Builds the default 2..max size-options list (the same range lfgGroup.js's buildSizeOptions
// would generate on its own), for activities with no "Mass" option.
function sizeRange(max) {
  const options = [];
  for (let n = 2; n <= max; n++) {
    options.push({ value: String(n), label: n === max ? `${n} Players (Max)` : `${n} Players` });
  }
  return options;
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
// ---- Copy/paste template ----
// New role:
//   { value: 'unique_key', label: 'Display Name', roleName: 'Exact Name', emoji: 'PUT_EMOJI_ID_HERE', sizeOptions: sizeRange(N), color: '#006400' },
//
// New category:
//   new_key: {
//     label: 'Label',
//     buttonEmoji: '🔥',
//     buttonStyle: ButtonStyle.Primary, // optional, defaults to Primary
//     activityNoun: 'activities', // plural noun used in the picker prompt, e.g. "Pick the <activityNoun> you want..."
//     roles: [ /* role entries above */ ],
//   },
const CATEGORIES = {
  bossing: {
    label: 'Bossing',
    buttonEmoji: '1381713946591105187',
    activityNoun: 'bosses',
    roles: [
      { value: 'yama', label: 'Yama', roleName: 'Yama', emoji: '1381816093336801340', sizeOptions: sizeRange(2), color: '#9F0D19' },
      { value: 'nightmare', label: 'Nightmare', roleName: 'Nightmare', emoji: 'PUT_EMOJI_ID_HERE', sizeOptions: sizeRangeWithMass(5), color: '#006400' },
      { value: 'royal_titans', label: 'Titans', roleName: 'Royal Titans', emoji: 'PUT_EMOJI_ID_HERE', sizeOptions: sizeRange(2), color: '#006400' },
      { value: 'hueycoatl', label: 'Huey', roleName: 'Hueycoatl', emoji: 'PUT_EMOJI_ID_HERE', sizeOptions: sizeRange(5), color: '#006400' },
      { value: 'callisto', label: 'Callisto', roleName: 'Callisto', emoji: 'PUT_EMOJI_ID_HERE', sizeOptions: sizeRange(5), color: '#006400' },
      { value: 'zilyana', label: 'Zilyana', roleName: 'Zilyana', emoji: 'PUT_EMOJI_ID_HERE', sizeOptions: sizeRange(5), color: '#006400' },
      { value: 'corp', label: 'Corp', roleName: 'Corp', emoji: 'PUT_EMOJI_ID_HERE', sizeOptions: sizeRange(10), color: '#006400' },
      { value: 'dks', label: 'DKS', roleName: 'DKS', emoji: 'PUT_EMOJI_ID_HERE', sizeOptions: sizeRange(3), color: '#006400' },
      { value: 'graardor', label: 'Graardor', roleName: 'Graardor', emoji: 'PUT_EMOJI_ID_HERE', sizeOptions: sizeRange(5), color: '#006400' },
      { value: 'kril', label: 'Kril', roleName: 'Kril', emoji: 'PUT_EMOJI_ID_HERE', sizeOptions: sizeRange(5), color: '#006400' },
      { value: 'kree', label: 'Kree', roleName: 'Kree', emoji: 'PUT_EMOJI_ID_HERE', sizeOptions: sizeRange(5), color: '#006400' },
      { value: 'nex', label: 'Nex', roleName: 'Nex', emoji: 'PUT_EMOJI_ID_HERE', sizeOptions: sizeRangeWithMass(5), color: '#006400' },
      { value: 'scurrius', label: 'Scurrius', roleName: 'Scurrius', emoji: 'PUT_EMOJI_ID_HERE', sizeOptions: sizeRange(5), color: '#006400' },
      { value: 'venenatis', label: 'Venenatis', roleName: 'Venenatis', emoji: 'PUT_EMOJI_ID_HERE', sizeOptions: sizeRange(5), color: '#006400' },
      { value: 'vetion', label: 'Vet\'ion', roleName: 'Vet\'ion', emoji: 'PUT_EMOJI_ID_HERE', sizeOptions: sizeRange(5), color: '#006400' },
    ],
  },
  raids: {
    label: 'Raids',
    buttonEmoji: '💰',
    activityNoun: 'raids',
    roles: [
      { value: 'cox', label: 'CoX', roleName: 'CoX', emoji: 'PUT_EMOJI_ID_HERE', sizeOptions: sizeRangeWithMass(7), color: '#006400' },
      { value: 'toa', label: 'ToA', roleName: 'ToA', emoji: 'PUT_EMOJI_ID_HERE', sizeOptions: sizeRange(8), color: '#006400' },
      { value: 'tob', label: 'ToB', roleName: 'ToB', emoji: 'PUT_EMOJI_ID_HERE', sizeOptions: sizeRange(5), color: '#006400' },
    ],
  },
  minigames: {
    label: 'Minigames',
    buttonEmoji: '⚒️',
    activityNoun: 'minigames',
    roles: [
      { value: 'tempoross', label: 'Tempoross', roleName: 'Tempoross', emoji: 'PUT_EMOJI_ID_HERE', sizeOptions: sizeRange(10), color: '#006400' },
      { value: 'zalcano', label: 'Zalcano', roleName: 'Zalcano', emoji: 'PUT_EMOJI_ID_HERE', sizeOptions: sizeRange(10), color: '#006400' },
      { value: 'wintertodt', label: 'Wintertodt', roleName: 'Wintertodt', emoji: 'PUT_EMOJI_ID_HERE', sizeOptions: sizeRange(10), color: '#006400' },
      { value: 'gotr', label: 'GOTR', roleName: 'GOTR', emoji: 'PUT_EMOJI_ID_HERE', sizeOptions: sizeRange(10), color: '#006400' },
      { value: 'soul_wars', label: 'Soul Wars', roleName: 'Soul Wars', emoji: 'PUT_EMOJI_ID_HERE', sizeOptions: sizeRangeWithMass(10), color: '#006400' },
      { value: 'castle_wars', label: 'Castle Wars', roleName: 'Castle Wars', emoji: 'PUT_EMOJI_ID_HERE', sizeOptions: sizeRangeWithMass(10), color: '#006400' },
      { value: 'barb_assault', label: 'Barb Assault', roleName: 'Barb Assault', emoji: 'PUT_EMOJI_ID_HERE', sizeOptions: sizeRange(5), color: '#006400' },
    ],
  },
};

// customId scheme used for all buttons here:
//   "roles:category:<categoryKey>"          — top-level category button (Bossing, Raids, etc.)
//   "roles:toggle:<categoryKey>:<roleValue>" — a specific boss/raid toggle
//   "roles:clearall"                         — removes every LFG- role the member has
// eventHandler.js routes any button whose customId starts with "roles:" here.

// Joins display labels into "A", "A or B", or "A, B, or C" — used to list categories in prose.
function joinWithOr(items) {
  if (items.length <= 2) return items.join(' or ');
  return `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}`;
}

// Shared submenu prompt text, parameterized by each category's activityNoun (e.g. "bosses", "raids").
function categoryPrompt(activityNoun) {
  return `Pick the ${activityNoun} you want to be pingable for. Selected ones turn red and stay red until you click them again.`;
}

function buildMenuEmbed() {
  const categoryLabels = Object.values(CATEGORIES).map((cat) => {
    const emoji = emojiMarkup(cat.buttonEmoji);
    return `**${emoji ? `${emoji} ` : ''}${cat.label}**`;
  });

  return new EmbedBuilder()
    .setTitle('LFG Roles')
    .setDescription(
      `Click ${joinWithOr(categoryLabels)} to pick specific activities you want to be pingable for. ` +
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
  const buttons = Object.entries(CATEGORIES).map(([key, cat]) => {
    const btn = new ButtonBuilder()
      .setCustomId(`roles:category:${key}`)
      .setLabel(cat.label)
      .setStyle(cat.buttonStyle ?? ButtonStyle.Primary);
    if (isValidEmoji(cat.buttonEmoji)) btn.setEmoji(cat.buttonEmoji);
    return btn;
  });
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
  const payload = { content: categoryPrompt(category.activityNoun), components: rows, flags: MessageFlags.Ephemeral };

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
function isSnowflakeEmoji(emoji) {
  return typeof emoji === 'string' && /^\d{15,25}$/.test(emoji);
}

// Accepts either a custom emoji's snowflake ID or a plain unicode emoji character.
// Placeholders like "PUT_EMOJI_ID_HERE" are plain ASCII text (not digits, not a real
// emoji glyph) so they fall through and get rejected here instead of silently failing
// the interaction when sent to Discord.
function isValidEmoji(emoji) {
  if (typeof emoji !== 'string' || emoji.length === 0) return false;
  return isSnowflakeEmoji(emoji) || /[^\x00-\x7F]/.test(emoji);
}

// Renders a role's emoji as inline markup usable in message/embed text (e.g. a title).
// Custom emoji need Discord's <:_:ID> markup to resolve by ID; unicode emoji render as-is.
// Returns null if there's no valid emoji, so callers can fall back to a default.
function emojiMarkup(emoji) {
  if (!isValidEmoji(emoji)) return null;
  return isSnowflakeEmoji(emoji) ? `<:_:${emoji}>` : emoji;
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
