const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { CATEGORIES, emojiMarkup } = require('./roleMenu');

// Top-level accordion categories shown in the first /lfg-post dropdown.
// Derived from roleMenu.js's CATEGORIES so a new category added there is never missed here — no second place to update.
// A couple of entries use shorter dropdown text than their /lfg-roles button label (CATEGORY_LABEL_OVERRIDES); everything else falls back to buttonLabel.
const CATEGORY_LABEL_OVERRIDES = {
  raids: 'Raid',
  bossing: 'Boss',
};
const CATEGORY_OPTIONS = Object.values(CATEGORIES).map((c) => ({
  key: c.key,
  label: CATEGORY_LABEL_OVERRIDES[c.key] ?? c.buttonLabel,
}));

function findCategoryOption(key) {
  return CATEGORY_OPTIONS.find((o) => o.key === key);
}

function getActivityOptions(categoryKey) {
  return CATEGORIES[categoryKey]?.roles ?? [];
}

function findActivityOption(categoryKey, value) {
  return getActivityOptions(categoryKey).find((r) => r.value === value);
}

// Group size options. Most activities get an auto-generated 2..max range.
// An activity can override this entirely with its own `sizeOptions` array (see `sizeRangeWithMass` in roleMenu.js for the common "N players + Mass" case).
function buildSizeOptions(activityOption) {
  if (activityOption.sizeOptions) return activityOption.sizeOptions;
  const options = [];
  for (let n = 2; n <= activityOption.maxPlayers; n++) {
    options.push({ value: String(n), label: n === activityOption.maxPlayers ? `${n} Players (Max)` : `${n} Players` });
  }
  return options;
}

function findSizeOption(activityOption, value) {
  return buildSizeOptions(activityOption).find((o) => o.value === value);
}

// Short descriptor shown next to an activity in the picker, e.g. "max 5" or "2-5, Mass" for activities with a custom sizeOptions override.
function describeSizeOptions(activityOption) {
  if (!activityOption.sizeOptions) return `max ${activityOption.maxPlayers}`;
  const numeric = activityOption.sizeOptions.filter((o) => /^\d+$/.test(o.value)).map((o) => o.value);
  const special = activityOption.sizeOptions.filter((o) => !/^\d+$/.test(o.value)).map((o) => o.label);
  const rangeText = numeric.length ? (numeric.length > 1 ? `${numeric[0]}-${numeric[numeric.length - 1]}` : numeric[0]) : '';
  return [rangeText, ...special].filter(Boolean).join(', ');
}

// A non-numeric size value (currently just "mass") means uncapped.
function parseSizeCap(value) {
  return /^\d+$/.test(value) ? parseInt(value, 10) : Infinity;
}

// Time is chosen as an offset from right now (in minutes) rather than an absolute clock time.
// This sidesteps timezone ambiguity entirely — "1 Hour from now" means the same thing to everyone regardless of where they are.
// The actual epoch is resolved fresh at post-creation time (see resolveTimeEpoch), and the posted embed uses Discord's <t:...> timestamp format, which auto-localizes to each viewer's own timezone and clock format.
const TIME_OFFSET_OPTIONS = [
  { value: '0', label: 'Now' },
  { value: '15', label: '15 Min' },
  { value: '30', label: '30 Min' },
  { value: '60', label: '1 Hour' },
  { value: '90', label: '1.5 Hours' },
  { value: '120', label: '2 Hours' },
  { value: '180', label: '3 Hours' },
  { value: '240', label: '4 Hours' },
  { value: '300', label: '5 Hours' },
  { value: '360', label: '6 Hours' },
];

function findTimeOption(value) {
  return TIME_OFFSET_OPTIONS.find((o) => o.value === value);
}

// Resolved fresh at the moment the group is actually created, not whenever the dropdown was originally rendered — so a slow-to-decide creator still gets an accurate "X minutes/hours from now".
function resolveTimeEpoch(offsetMinutesValue) {
  return Math.floor(Date.now() / 1000) + parseInt(offsetMinutesValue, 10) * 60;
}

// How long a full group's post stays up before auto-deleting.
const GROUP_FORMED_CLEANUP_DELAY_MS = 5 * 60 * 1000;

// Every post gets at least this long before the "start time has passed" auto-delete can fire — otherwise picking "Now" (or 15 Min) would delete the post almost immediately, before anyone has a chance to see or join it.
const MIN_POST_LIFETIME_MS = 15 * 60 * 1000;

function computeStartTimeCleanupDelay(timeEpoch) {
  return Math.max(timeEpoch * 1000 - Date.now(), MIN_POST_LIFETIME_MS);
}

// Embed color for an open group when its activity doesn't set its own `color` (see roleMenu.js CATEGORIES).
const DEFAULT_GROUP_COLOR = 0x006400;

// Closed (full) always shows as green regardless of the activity's color — a status signal, not branding.
// Used by both the group embed and the activity notification embed (see lfgPost.js) so they always match.
function resolveGroupColor(group) {
  return group.status === 'closed' ? 0x2ecc71 : (group.color ?? DEFAULT_GROUP_COLOR);
}

// ---- Group post building blocks, used by lfgPost.js ----
// status: 'open' | 'closed' (auto-closed once full) | 'disbanded'
// Anyone can Join/Leave. Disband is limited to current group members or Coordinator/Owner staff (see canDisbandGroup in lfgPost.js).
// Closed groups reopen automatically the moment someone leaves and frees up a spot.
function buildGroupRow(groupId, status, prefix) {
  if (status === 'open') {
    const join = new ButtonBuilder()
      .setCustomId(`${prefix}:join:${groupId}`)
      .setLabel('Join Group')
      .setStyle(ButtonStyle.Success);
    const leave = new ButtonBuilder()
      .setCustomId(`${prefix}:leave:${groupId}`)
      .setLabel('Leave Group')
      .setStyle(ButtonStyle.Secondary);
    const disband = new ButtonBuilder()
      .setCustomId(`${prefix}:disband:${groupId}`)
      .setLabel('Disband Group')
      .setStyle(ButtonStyle.Danger);
    return new ActionRowBuilder().addComponents(join, leave, disband);
  }

  // closed (full) — only leaving is offered; leaving auto-reopens the group
  const leave = new ButtonBuilder()
    .setCustomId(`${prefix}:leave:${groupId}`)
    .setLabel('Leave Group')
    .setStyle(ButtonStyle.Secondary);
  return new ActionRowBuilder().addComponents(leave);
}

function buildGroupEmbed(group) {
  const capDisplay = group.sizeCap === Infinity ? 'Mass' : String(group.sizeCap);
  const memberLines = [...group.members].map((id) => `<@${id}>`).join('\n');

  let title = `${emojiMarkup(group.emoji) ?? '🔍'} Looking For Group`;
  const color = resolveGroupColor(group);
  if (group.status === 'closed') {
    title = '🔒 Looking For Group — Full';
  }

  const descLines = [
    `**Activity:** ${group.roleLabel}`,
    `**Start:** <t:${group.timeEpoch}:t> (<t:${group.timeEpoch}:R>)`,
    `**Group Size:** ${group.sizeLabel}`,
  ];
  if (group.description) descLines.push(`**Description:** ${group.description}`);
  descLines.push('', `**Members (${group.members.size}/${capDisplay}):**`, memberLines || '_none yet_');

  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(descLines.join('\n'))
    .setColor(color)
    .setFooter({ text: `Started by ${group.creatorTag}` });
}

function makeGroupId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

module.exports = {
  // Shared building blocks used by lfgPost.js.
  CATEGORY_OPTIONS,
  findCategoryOption,
  getActivityOptions,
  findActivityOption,
  buildSizeOptions,
  findSizeOption,
  describeSizeOptions,
  parseSizeCap,
  TIME_OFFSET_OPTIONS,
  findTimeOption,
  resolveTimeEpoch,
  buildGroupEmbed,
  buildGroupRow,
  makeGroupId,
  resolveGroupColor,
  GROUP_FORMED_CLEANUP_DELAY_MS,
  computeStartTimeCleanupDelay,
};
