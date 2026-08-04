const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const { CATEGORIES, emojiMarkup } = require('./roleMenu');

// Top-level accordion categories for the /lfg-post dropdown, derived from roleMenu.js's CATEGORIES.
// dropdownLabel overrides buttonLabel for shorter dropdown text; omit it to reuse buttonLabel.
const CATEGORY_OPTIONS = Object.values(CATEGORIES).map((c) => ({
  key: c.key,
  label: c.dropdownLabel ?? c.buttonLabel,
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

// Every activity's sizeOptions is set in roleMenu.js (see sizeRange/sizeRangeWithMass there) —
// this just reads it back, keeping that range formula in one place.
function buildSizeOptions(activityOption) {
  return activityOption.sizeOptions;
}

function findSizeOption(activityOption, value) {
  return buildSizeOptions(activityOption).find((o) => o.value === value);
}

// Short descriptor shown next to an activity in the picker, e.g. "2-5" or "2-5, Mass".
function describeSizeOptions(activityOption) {
  const numeric = activityOption.sizeOptions.filter((o) => /^\d+$/.test(o.value)).map((o) => o.value);
  const special = activityOption.sizeOptions.filter((o) => !/^\d+$/.test(o.value)).map((o) => o.label);
  const rangeText = numeric.length ? (numeric.length > 1 ? `${numeric[0]}-${numeric[numeric.length - 1]}` : numeric[0]) : '';
  return [rangeText, ...special].filter(Boolean).join(', ');
}

// A non-numeric size value (currently just "mass") means uncapped.
function parseSizeCap(value) {
  return /^\d+$/.test(value) ? parseInt(value, 10) : Infinity;
}

// An offset from now (in minutes), not an absolute clock time — sidesteps timezone ambiguity
// entirely, since "1 Hour from now" means the same thing to everyone. The epoch is resolved
// fresh at post-creation time (resolveTimeEpoch), and Discord's <t:...> format auto-localizes
// the posted embed to each viewer's own timezone and clock format.
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

// Resolved at creation time (not when the dropdown was rendered), so a slow-to-decide creator
// still gets an accurate "X from now".
function resolveTimeEpoch(offsetMinutesValue) {
  return Math.floor(Date.now() / 1000) + parseInt(offsetMinutesValue, 10) * 60;
}

// How long a full group's post stays up before auto-deleting.
const GROUP_FORMED_CLEANUP_DELAY_MS = 5 * 60 * 1000;

// Minimum lifetime before the "start time passed" auto-delete can fire — otherwise picking
// "Now" (or 15 Min) would delete the post almost immediately, before anyone can join.
const MIN_POST_LIFETIME_MS = 15 * 60 * 1000;

function computeStartTimeCleanupDelay(timeEpoch) {
  return Math.max(timeEpoch * 1000 - Date.now(), MIN_POST_LIFETIME_MS);
}

// Fallback embed color when an activity doesn't set its own `color` (see roleMenu.js CATEGORIES).
const DEFAULT_GROUP_COLOR = 0x006400;

// Closed shows green regardless of activity color — a status signal, not branding.
// lfgPost.js's notification embed uses the same color so they always match.
function resolveGroupColor(group) {
  return group.status === 'closed' ? 0x2ecc71 : (group.color ?? DEFAULT_GROUP_COLOR);
}

// ---- Group post building blocks, used by lfgPost.js ----
// status: 'open' | 'closed' (auto-closed once full) | 'disbanded'
// Anyone can Join/Leave. Disband is limited to group members or Coordinator/Owner staff
// (see canDisbandGroup in lfgPost.js).
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
