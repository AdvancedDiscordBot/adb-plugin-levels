const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');

const data = new SlashCommandBuilder()
  .setName('level-config')
  .setDescription('Configure the levels/XP system')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addIntegerOption(option =>
    option.setName('xp-per-message')
      .setDescription('XP awarded per message (1-50)')
      .setMinValue(1)
      .setMaxValue(50))
  .addIntegerOption(option =>
    option.setName('xp-cooldown')
      .setDescription('Seconds between XP awards (10-300)')
      .setMinValue(10)
      .setMaxValue(300))
  .addIntegerOption(option =>
    option.setName('xp-per-minute-limit')
      .setDescription('Max XP per minute (10-1000)')
      .setMinValue(10)
      .setMaxValue(1000))
  .addChannelOption(option =>
    option.setName('level-up-channel')
      .setDescription('Channel for level-up announcements')
      .addChannelTypes(0)); // GUILD_TEXT

async function execute(interaction) {
  try {
    const guildId = interaction.guild.id;
    const updates = {};
    
    if (interaction.options.getInteger('xp-per-message') !== null) {
      updates.xpPerMessage = interaction.options.getInteger('xp-per-message');
    }
    if (interaction.options.getInteger('xp-cooldown') !== null) {
      updates.xpCooldown = interaction.options.getInteger('xp-cooldown');
    }
    if (interaction.options.getInteger('xp-per-minute-limit') !== null) {
      updates.xpPerMinuteLimit = interaction.options.getInteger('xp-per-minute-limit');
    }
    if (interaction.options.getChannel('level-up-channel') !== null) {
      updates.levelUpChannelId = interaction.options.getChannel('level-up-channel').id;
    }
    
    // Update guild config
    const config = await ctx.db.getServerConfig(guildId) || {};
    if (!config.xpPerModule) config.xpPerModule = {};
    config.xpPerModule.levels = { ...config.xpPerModule.levels || {}, ...updates };
    await ctx.db.updateServerConfig(guildId, config);
    
    const embed = new EmbedBuilder()
      .setTitle('Levels Configuration Updated')
      .setColor(0x00ff00)
      .setDescription('The levels/XP system settings have been updated.');
    
    if (updates.xpPerMessage !== undefined) {
      embed.addFields({ name: 'XP per Message', value: `${updates.xpPerMessage}` });
    }
    if (updates.xpCooldown !== undefined) {
      addFields({ name: 'XP Cooldown', value: `${updates.xpCooldown}s` });
    }
    if (updates.xpPerMinuteLimit !== undefined) {
      embed.addFields({ name: 'XP per Minute Limit', value: `${updates.xpPerMinuteLimit}` });
    }
    if (updates.levelUpChannelId !== undefined) {
      const channel = interaction.guild.channels.cache.get(updates.levelUpChannelId);
      embed.addFields({ name: 'Level-Up Channel', value: `${channel}` });
    }
    
    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error(error);
    await interaction.reply({ 
      content: 'There was an error while updating the configuration!', 
      ephemeral: true 
    });
  }
}

module.exports = { data, execute };
