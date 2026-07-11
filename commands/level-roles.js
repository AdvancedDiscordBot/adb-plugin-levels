const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

// Factory: the LevelRole model is injected by index.js (namespaced via ctx.defineModel).
module.exports = function createLevelRolesCommand(LevelRole) {
  const data = new SlashCommandBuilder()
    .setName('level-roles')
    .setDescription('Manage role rewards for levels')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(subcommand =>
      subcommand
        .setName('add')
        .setDescription('Add a role reward for a level')
        .addIntegerOption(option =>
          option.setName('level')
            .setDescription('The level required')
            .setMinValue(1)
            .setRequired(true))
        .addRoleOption(option =>
          option.setName('role')
            .setDescription('The role to reward')
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('remove')
        .setDescription('Remove a role reward for a level')
        .addIntegerOption(option =>
          option.setName('level')
            .setDescription('The level to remove')
            .setMinValue(1)
            .setRequired(true)))
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List all role rewards for this server'));

  async function execute(interaction) {
    try {
      const guildId = interaction.guild.id;
      const subcommand = interaction.options.getSubcommand();

      if (subcommand === 'add') {
        const level = interaction.options.getInteger('level');
        const role = interaction.options.getRole('role');

        await LevelRole.findOneAndUpdate(
          { guildId, level },
          { $set: { roleId: role.id } },
          { upsert: true, new: true }
        );

        await interaction.reply({
          content: `Successfully set ${role} as reward for reaching level ${level}!`,
          ephemeral: true
        });
      }
      else if (subcommand === 'remove') {
        const level = interaction.options.getInteger('level');

        await LevelRole.deleteOne({ guildId, level });

        await interaction.reply({
          content: `Successfully removed role reward for level ${level}!`,
          ephemeral: true
        });
      }
      else if (subcommand === 'list') {
        const roles = await LevelRole.find({ guildId }).sort({ level: 1 });

        if (roles.length === 0) {
          await interaction.reply({
            content: 'No role rewards configured for this server.',
            ephemeral: true
          });
          return;
        }

        const embed = new EmbedBuilder()
          .setTitle('Level Role Rewards')
          .setColor(0x9b59b6);

        const description = roles.map(r => {
          const role = interaction.guild.roles.cache.get(r.roleId);
          return `**Level ${r.level}** → ${role ? role : '@deleted-role'}`;
        }).join('\n');

        embed.setDescription(description);
        await interaction.reply({ embeds: [embed] });
      }
    } catch (error) {
      console.error(error);
      await interaction.reply({
        content: 'There was an error while managing level roles!',
        ephemeral: true
      });
    }
  }

  return { data, execute };
};
