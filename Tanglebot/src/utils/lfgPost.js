const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  ChannelType,
  EmbedBuilder,
} = require('discord.js');
const {
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
} = require('./lfgGroup');
const { ensureRoleExists, lfgRoleName, notifyAdminLog } = require('./roleMenu');

// The Discord Forum Channel where /lfg-post posts get created as threads.
// Create a Forum Channel in your server, copy its ID, and set this in .env.
const FORUM_CHANNEL_ID = process.env.LFG_FORUM_CHANNEL_ID;

// If everyone leaves and the post sits empty this long, auto-delete it instead of waiting for the start time.
const EMPTY_GROUP_CLEANUP_DELAY_MS = 30 * 60 * 1000;

// In-memory state, lost on restart/redeploy — fine for same-day LFG posts, but worth knowing if the bot redeploys mid-event.
const setupSessions = new Map(); // userId -> { category, activity, size, time }
const activeGroups = new Map(); // groupId -> group state

// ---- Setup UI (accordion: Category -> Activity -> Size -> Start Time) ----
// No separate "Create" button.
// Once Start Time (the last dropdown) is filled, this opens the description modal directly.
function getSession(userId) {
  if (!setupSessions.has(userId)) {
    setupSessions.set(userId, { category: null, activity: null, size: null, time: null });
  }
  return setupSessions.get(userId);
}

function buildSetupComponents(session) {
  const rows = [];

  const categorySelect = new StringSelectMenuBuilder()
    .setCustomId('lfgpost:select:category')
    .setPlaceholder('1. Choose a category')
    .addOptions(
      CATEGORY_OPTIONS.map((o) => ({
        value: o.key,
        label: o.label,
        default: session.category === o.key,
      }))
    );
  rows.push(new ActionRowBuilder().addComponents(categorySelect));

  if (session.category) {
    const activitySelect = new StringSelectMenuBuilder()
      .setCustomId('lfgpost:select:activity')
      .setPlaceholder('2. Choose an activity')
      .addOptions(
        getActivityOptions(session.category).map((r) => ({
          value: r.value,
          label: `${r.label} (${describeSizeOptions(r)})`,
          default: session.activity === r.value,
        }))
      );
    rows.push(new ActionRowBuilder().addComponents(activitySelect));
  }

  if (session.category && session.activity) {
    const activityOption = findActivityOption(session.category, session.activity);
    const sizeSelect = new StringSelectMenuBuilder()
      .setCustomId('lfgpost:select:size')
      .setPlaceholder('3. Choose group size')
      .addOptions(
        buildSizeOptions(activityOption).map((o) => ({
          value: o.value,
          label: o.label,
          default: session.size === o.value,
        }))
      );
    rows.push(new ActionRowBuilder().addComponents(sizeSelect));
  }

  if (session.category && session.activity && session.size) {
    const timeSelect = new StringSelectMenuBuilder()
      .setCustomId('lfgpost:select:time')
      .setPlaceholder('4. Choose a start time')
      .addOptions(
        TIME_OFFSET_OPTIONS.map((o) => ({
          value: o.value,
          label: o.label,
          default: session.time === o.value,
        }))
      );
    rows.push(new ActionRowBuilder().addComponents(timeSelect));
  }

  return rows;
}

function buildSetupContent(session) {
  const parts = [];
  if (session.category) parts.push(`**Category:** ${findCategoryOption(session.category)?.label ?? '?'}`);
  if (session.category && session.activity) {
    const opt = findActivityOption(session.category, session.activity);
    parts.push(`**Activity:** ${opt?.label ?? '?'}`);
  }
  if (session.category && session.activity && session.size) {
    const activityOption = findActivityOption(session.category, session.activity);
    parts.push(`**Size:** ${findSizeOption(activityOption, session.size)?.label ?? '?'}`);
  }
  if (session.time) parts.push(`**Start:** ${findTimeOption(session.time)?.label ?? '?'}`);

  const summary = parts.length ? parts.join('  •  ') + '\n\n' : '';
  return `${summary}Pick a category, an activity, a group size, and a start time. You'll be asked for an optional description once all four are picked.`;
}

async function sendSetupMenu(interaction) {
  if (!FORUM_CHANNEL_ID) {
    return interaction.reply({
      content: '⚠️ LFG_FORUM_CHANNEL_ID is not set. Ask an admin to set it in the bot\'s environment variables.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const session = getSession(interaction.user.id);
  await interaction.reply({
    content: buildSetupContent(session),
    components: buildSetupComponents(session),
    flags: MessageFlags.Ephemeral,
  });
}

async function handleSetupSelect(interaction, field) {
  const session = getSession(interaction.user.id);
  session[field] = interaction.values[0];

  if (field === 'category') {
    session.activity = null;
    session.size = null;
    session.time = null;
  }
  if (field === 'activity') {
    // Size options depend on the chosen activity's max player count.
    session.size = null;
    const activityOption = findActivityOption(session.category, session.activity);
    const sizeChoices = buildSizeOptions(activityOption);
    if (sizeChoices.length === 1) {
      // Only one possible size (e.g. Yama, max 2) — no real choice to make, so skip straight past this step instead of making them click it.
      session.size = sizeChoices[0].value;
    }
  }

  const allFilled = session.category && session.activity && session.size && session.time;
  if (allFilled) {
    return openDescriptionModal(interaction);
  }

  await interaction.update({
    content: buildSetupContent(session),
    components: buildSetupComponents(session),
  });
}

// ---- Once all 4 dropdowns are filled: open the description modal directly ----
async function openDescriptionModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId('lfgpost:desc')
    .setTitle('Add a description');

  const descInput = new TextInputBuilder()
    .setCustomId('description')
    .setLabel('Description (optional)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(1000)
    .setPlaceholder('Add any extra details about this group...');

  modal.addComponents(new ActionRowBuilder().addComponents(descInput));
  await interaction.showModal(modal);
}

// ---- Modal submit actually creates the LFG post ----
async function handleDescriptionModalSubmit(interaction) {
  const session = getSession(interaction.user.id);
  if (!session.category || !session.activity || !session.size || !session.time) {
    return interaction.update({
      content: '⚠️ Something went wrong finding your selections — please run /lfg-post again.',
      components: [],
    });
  }

  const categoryOption = findCategoryOption(session.category);
  const activityOption = findActivityOption(session.category, session.activity);
  const sizeOption = findSizeOption(activityOption, session.size);
  const timeOption = findTimeOption(session.time);
  const description = interaction.fields.getTextInputValue('description')?.trim() || null;

  const guildRole = await ensureRoleExists(interaction.guild, activityOption.label);
  if (!guildRole) {
    await notifyAdminLog(
      interaction.client,
      '⚠️ LFG Role Creation Failed',
      `Couldn't find or create **${lfgRoleName(activityOption.label)}** for <@${interaction.user.id}> via /lfg-post. Check the bot's **Manage Roles** permission.`
    );
    return interaction.update({
      content: `⚠️ I couldn't find or create the role **${lfgRoleName(activityOption.label)}**. Make sure I have the **Manage Roles** permission.`,
      components: [],
    });
  }

  const forumChannel = await interaction.guild.channels.fetch(FORUM_CHANNEL_ID).catch(() => null);
  if (!forumChannel || forumChannel.type !== ChannelType.GuildForum) {
    await notifyAdminLog(
      interaction.client,
      '⚠️ LFG Forum Channel Misconfigured',
      `<@${interaction.user.id}> tried /lfg-post but LFG_FORUM_CHANNEL_ID doesn't point to a valid Forum Channel.`
    );
    return interaction.update({
      content: '⚠️ LFG_FORUM_CHANNEL_ID doesn\'t point to a valid Forum Channel. Ask an admin to check the setup.',
      components: [],
    });
  }

  const groupId = makeGroupId();
  const timeEpoch = resolveTimeEpoch(timeOption.value);
  const sizeCap = parseSizeCap(sizeOption.value);
  const roleLabel = `${categoryOption.label}: ${activityOption.label}`;

  const group = {
    id: groupId,
    creatorId: interaction.user.id,
    creatorTag: interaction.user.username,
    roleLabel,
    color: activityOption.color,
    emoji: activityOption.emoji,
    startLabel: timeOption.label,
    timeEpoch,
    sizeLabel: sizeOption.label,
    sizeCap,
    description,
    members: new Set([interaction.user.id]),
    status: 'open',
    threadId: null,
    activityMessageId: null,
    cleanupTimeoutId: null,
  };
  activeGroups.set(groupId, group);

  const embed = buildGroupEmbed(group);
  const row = buildGroupRow(groupId, 'open');

  // Auto-apply a matching forum tag if one exists with the same name as the activity (e.g. "Yama" — the base name, not the "LFG-" prefixed role).
  // Entirely optional — skipped if none matches.
  const matchingTag = forumChannel.availableTags?.find(
    (t) => t.name.toLowerCase() === activityOption.label.toLowerCase()
  );

  // The description only shows in the embed (see buildGroupEmbed) — the message content is just the role ping.
  const startContent = `<@&${guildRole.id}>`;

  let thread;
  try {
    thread = await forumChannel.threads.create({
      name: buildThreadName(group, 'Open'),
      appliedTags: matchingTag ? [matchingTag.id] : [],
      message: {
        content: startContent,
        embeds: [embed],
        components: [row],
      },
    });
  } catch (err) {
    activeGroups.delete(groupId);
    console.error(`Could not create LFG post for group ${groupId}:`, err.message);
    await notifyAdminLog(
      interaction.client,
      '⚠️ LFG Post Creation Failed',
      `Failed to create a post for <@${interaction.user.id}> (${roleLabel}): ${err.message}`
    );
    return interaction.update({
      content: '⚠️ Something went wrong creating the post. Please try again.',
      components: [],
    });
  }

  group.threadId = thread.id;

  // Auto-delete once the chosen start time has passed, unless the group closes/fills/disbands sooner.
  schedulePostGroupCleanup(interaction.client, group, computeStartTimeCleanupDelay(group.timeEpoch));
  setupSessions.delete(interaction.user.id);

  const threadLink = `https://discord.com/channels/${interaction.guildId}/${thread.id}`;
  await interaction.update({
    content: `✅ Your LFG post has been created: [Click here to view it](${threadLink})`,
    components: [],
  });
  setTimeout(() => interaction.deleteReply().catch(() => {}), 30000);
}

// Only the status word changes here — member count lives in the embed instead (updates via message edit, not the channel rename rate limit).
// The creator isn't included here (it's in the embed footer instead) to keep the title short — Discord thread/channel names are capped at 100 characters.
function buildThreadName(group, statusWord) {
  const name = `[${statusWord}] - ${group.roleLabel} - Start: ${group.startLabel}`;
  return name.length > 100 ? `${name.slice(0, 99)}…` : name;
}

function statusWordFor(group) {
  return group.status === 'closed' ? 'Full' : 'Open';
}

async function renameThread(interaction, group) {
  try {
    await interaction.channel.setName(buildThreadName(group, statusWordFor(group)));
  } catch (err) {
    console.error(`Could not rename LFG post thread ${group.id}:`, err.message);
  }
}

function mentionAll(group) {
  return [...group.members].map((id) => `<@${id}>`).join(' ');
}

// Join/leave/formed/reopened notices all share one message per group, edited in place instead of piling up as a new message every time something happens.
async function sendOrEditActivity(channel, group, text) {
  const embed = new EmbedBuilder().setDescription(text).setColor(resolveGroupColor(group)).setTimestamp();

  if (group.activityMessageId) {
    try {
      const existing = await channel.messages.fetch(group.activityMessageId);
      await existing.edit({ embeds: [embed] });
      return;
    } catch (err) {
      // Message is gone (e.g. manually deleted) — fall through and send a fresh one.
    }
  }

  const sent = await channel.send({ embeds: [embed] });
  group.activityMessageId = sent.id;
}

// Looks up the group for a button interaction, replying "no longer exists" and returning null if it's gone.
async function requireGroup(interaction, groupId) {
  const group = activeGroups.get(groupId);
  if (!group) {
    await interaction.reply({ content: '⚠️ This group no longer exists.', flags: MessageFlags.Ephemeral });
    return null;
  }
  return group;
}

// True for Discord's "Unknown Message" error — thrown when the post's message/thread was already deleted (auto-cleanup fired, manually removed, etc.) before a pending button click got processed.
function isUnknownMessageError(err) {
  return err?.code === 10008;
}

// The underlying post is gone — drop the now-stale in-memory group instead of leaking it forever (every future click on the dead button would otherwise keep hitting the same error).
function cleanupStaleGroup(group) {
  if (group.cleanupTimeoutId) clearTimeout(group.cleanupTimeoutId);
  activeGroups.delete(group.id);
}

// Updates the group's post with a fresh embed/row, cleaning up and replying if the post is already gone.
// Returns false (the caller should stop) if the update failed because the post no longer exists.
async function updateGroupMessage(interaction, group, embed, row) {
  try {
    await interaction.update({ embeds: [embed], components: [row] });
    return true;
  } catch (err) {
    if (!isUnknownMessageError(err)) throw err;
    cleanupStaleGroup(group);
    await interaction.reply({ content: '⚠️ This group\'s post no longer exists.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return false;
  }
}

// Disbanding is limited to current members of the group, or Coordinator/Owner staff.
function canDisbandGroup(interaction, group) {
  if (group.members.has(interaction.user.id)) return true;
  const staffRoleIds = [process.env.COORDINATOR_ROLE_ID, process.env.OWNER_ROLE_ID].filter(Boolean);
  return staffRoleIds.some((roleId) => interaction.member.roles.cache.has(roleId));
}

async function handleJoinButton(interaction, groupId) {
  const group = await requireGroup(interaction, groupId);
  if (!group) return;
  if (group.status === 'closed') {
    return interaction.reply({ content: '⚠️ This group is already full.', flags: MessageFlags.Ephemeral });
  }
  if (group.members.has(interaction.user.id)) {
    return interaction.reply({ content: 'You\'re already in this group.', flags: MessageFlags.Ephemeral });
  }

  group.members.add(interaction.user.id);
  const justFilled = group.sizeCap !== Infinity && group.members.size >= group.sizeCap;
  if (justFilled) {
    group.status = 'closed';
  }

  const embed = buildGroupEmbed(group);
  const row = buildGroupRow(groupId, group.status);

  if (!(await updateGroupMessage(interaction, group, embed, row))) return;
  await interaction.followUp({ content: '✅ You joined the group!', flags: MessageFlags.Ephemeral });

  if (justFilled) {
    await renameThread(interaction, group);
    await sendOrEditActivity(interaction.channel, group, `${mentionAll(group)}\n🎉 **Group formed, Good luck!**`);
    schedulePostGroupCleanup(interaction.client, group, GROUP_FORMED_CLEANUP_DELAY_MS);
  } else {
    if (group.members.size === 1) {
      // Group was empty and just got someone back — cancel the empty-group cleanup, back to the normal start-time schedule.
      schedulePostGroupCleanup(interaction.client, group, computeStartTimeCleanupDelay(group.timeEpoch));
    }
    await sendOrEditActivity(interaction.channel, group, `${mentionAll(group)}\n🔔 <@${interaction.user.id}> joined the group!`);
  }
}

async function handleLeaveButton(interaction, groupId) {
  const group = await requireGroup(interaction, groupId);
  if (!group) return;
  if (!group.members.has(interaction.user.id)) {
    return interaction.reply({ content: 'You\'re not in this group.', flags: MessageFlags.Ephemeral });
  }

  group.members.delete(interaction.user.id);

  // A full group always has room again the moment someone leaves it — reopen automatically instead of waiting for a manual Reopen click.
  const reopened = group.status === 'closed';
  if (reopened) {
    group.status = 'open';
  }

  const embed = buildGroupEmbed(group);
  const row = buildGroupRow(groupId, group.status);
  if (!(await updateGroupMessage(interaction, group, embed, row))) return;
  await interaction.followUp({ content: 'You left the group.', flags: MessageFlags.Ephemeral });

  if (reopened) {
    await renameThread(interaction, group);
  }

  if (group.members.size > 0) {
    const lines = [mentionAll(group), `⚠️ <@${interaction.user.id}> left the group.`];
    if (reopened) lines.push('🔓 **This group has space again and is accepting new members!**');
    await sendOrEditActivity(interaction.channel, group, lines.join('\n'));
    if (reopened) {
      schedulePostGroupCleanup(interaction.client, group, computeStartTimeCleanupDelay(group.timeEpoch));
    }
  } else {
    // Nobody left in the group — no point keeping the post up for the full start-time window.
    schedulePostGroupCleanup(interaction.client, group, EMPTY_GROUP_CLEANUP_DELAY_MS);
  }
}

async function handleDisbandButton(interaction, groupId) {
  const group = await requireGroup(interaction, groupId);
  if (!group) return;
  if (!canDisbandGroup(interaction, group)) {
    return interaction.reply({
      content: '⚠️ Only members of this group, or a Coordinator or higher, can disband it.',
      flags: MessageFlags.Ephemeral,
    });
  }
  if (group.status === 'disbanded') {
    return interaction.reply({ content: '⚠️ This group is already disbanded.', flags: MessageFlags.Ephemeral });
  }

  group.status = 'disbanded';
  if (group.cleanupTimeoutId) {
    clearTimeout(group.cleanupTimeoutId);
  }

  try {
    await interaction.deferUpdate();
  } catch (err) {
    if (!isUnknownMessageError(err)) throw err;
    cleanupStaleGroup(group);
    return;
  }

  try {
    const thread = await interaction.client.channels.fetch(group.threadId);
    await thread.delete();
  } catch (err) {
    console.error(`Could not delete disbanded LFG post ${group.id}:`, err.message);
  }

  activeGroups.delete(groupId);
}

function schedulePostGroupCleanup(client, group, delayMs) {
  if (group.cleanupTimeoutId) {
    clearTimeout(group.cleanupTimeoutId);
  }

  group.cleanupTimeoutId = setTimeout(async () => {
    try {
      const thread = await client.channels.fetch(group.threadId);
      await thread.delete(); // deletes the entire post, no need to remove messages individually
    } catch (err) {
      console.error(`Could not delete expired LFG post ${group.id}:`, err.message);
    }
    activeGroups.delete(group.id);
  }, delayMs);
}

// ---- Entry points called from eventHandler.js ----
async function handleLfgPostSelectInteraction(interaction) {
  const field = interaction.customId.split(':')[2]; // "lfgpost:select:<field>"
  if (!['category', 'activity', 'size', 'time'].includes(field)) return;
  return handleSetupSelect(interaction, field);
}

async function handleLfgPostModalSubmit(interaction) {
  if (interaction.customId === 'lfgpost:desc') {
    return handleDescriptionModalSubmit(interaction);
  }
}

async function handleLfgPostGroupButtonInteraction(interaction) {
  const [, action, groupId] = interaction.customId.split(':'); // "lfgpostgroup:<action>:<groupId>"
  if (action === 'join') return handleJoinButton(interaction, groupId);
  if (action === 'leave') return handleLeaveButton(interaction, groupId);
  if (action === 'disband') return handleDisbandButton(interaction, groupId);
}

module.exports = {
  sendSetupMenu,
  handleLfgPostSelectInteraction,
  handleLfgPostModalSubmit,
  handleLfgPostGroupButtonInteraction,
};
