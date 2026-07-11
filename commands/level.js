const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

// Factory: the Level model is injected by index.js (namespaced via ctx.defineModel).
module.exports = function createLevelCommand(Level) {
  const data = new SlashCommandBuilder()
    .setName('level')
    .setDescription('Check your or another user\'s level and XP')
    .addUserOption(option =>
      option.setName('user')
        .setDescription('The user to check')
        .setRequired(false));

  async function execute(interaction) {
    try {
      const targetUser = interaction.options.getUser('user') || interaction.user;
      const guildId = interaction.guild.id;
      const userId = targetUser.id;

      const levelData = await Level.findOne({ guildId, userId });

      if (!levelData) {
        await interaction.reply({
          content: `${targetUser} has not earned any XP yet.`,
          ephemeral: true
        });
        return;
      }

      // Simple level formula: level = floor(sqrt(xp / 100))
      const xp = levelData.xp || 0;
      const level = Math.floor(Math.sqrt(xp / 100));
      const xpForCurrentLevel = level * level * 100;
      const xpForNextLevel = (level + 1) * (level + 1) * 100;
      const progressPercent = ((xp - xpForCurrentLevel) / (xpForNextLevel - xpForCurrentLevel)) * 100;

      const embed = new EmbedBuilder()
        .setTitle(`${targetUser.username}'s Level`)
        .setThumbnail(targetUser.displayAvatarURL())
        .addFields(
          { name: 'Level', value: `${level}`, inline: true },
          { name: 'XP', value: `${xp.toLocaleString()} / ${xpForNextLevel.toLocaleString()}`, inline: true },
          { name: 'Progress', value: `${progressPercent.toFixed(1)}%`, inline: true }
        )
        .setColor(0x0099ff)
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    } catch (error) {
      console.error(error);
      await interaction.reply({
        content: 'There was an error while fetching the level!',
        ephemeral: true
      });
    }
  }

  return { data, execute };
};
