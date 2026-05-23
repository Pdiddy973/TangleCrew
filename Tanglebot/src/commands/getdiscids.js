const { SlashCommandBuilder, AttachmentBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');

const OWNER_ROLE_ID = process.env.OWNER_ROLE_ID;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('getdiscids')
    .setDescription('Export all server members to a CSV (DiscordID, Username, Nickname)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    if (!interaction.member.roles.cache.has(OWNER_ROLE_ID)) {
      return interaction.reply({ content: 'You need the Owner role to use this command.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    await interaction.guild.members.fetch();
    const members = interaction.guild.members.cache.filter(m => !m.user.bot);

    const lines = ['DiscordID,Username,Nickname,Rank'];
    for (const member of members.values()) {
      const id = member.id;
      const username = csvEscape(member.user.username);
      const nickname = csvEscape(member.nickname ?? '');
      lines.push(`${id},${username},${nickname},`);
    }

    const csv = lines.join('\r\n');
    const buffer = Buffer.from(csv, 'utf8');
    const file = new AttachmentBuilder(buffer, { name: 'discord-members.csv' });

    await interaction.editReply({
      content: `Exported **${members.size}** members. Paste the IDs into your rank spreadsheet and fill in the Rank column, then run \`/syncranks\`.`,
      files: [file],
    });
  },
};

function csvEscape(value) {
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
