const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('View the server XP leaderboard');

async function execute(interaction) {
  try {
    const guildId = interaction.guild.id;
    const Level = require('../../models/Level');
    
    const leaderboard = await Level.find({ guildId })
      .sort({ xp: -1 })
      .limit(10)
      .populate('userId', 'username discriminator avatar');
    
    if (leaderboard.length === 0) {
      await interaction.reply({ 
        content: 'No one has earned XP yet!', 
        ephemeral: true 
      });
      return;
    }
    
    const embed = new EmbedBuilder()
      .setTitle(`${interaction.guild.name} Leaderboard`)
      .setColor(0xffd700);
    
    const description = leaderboard.map((entry, index) => {
      const medal = ['🥇', '🥈', '🥉'][index] || `${index + 1}.`;
      const xp = (entry.xp || 0).toLocaleString();
      const level = Math.floor(Math.sqrt((entry.xp || 0) / 100));
      const username = interaction.guild.members.cache.get(entry.userId)?.user.username || 'Unknown User';
      return `${medal} **${username}** - Level ${level} • ${xp} XP`;
    }).join('\n');
    
    embed.setDescription(description);
    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    console.error(error);
    await interaction.reply({ 
      content: 'There was an error while fetching the leaderboard!', 
      ephemeral: true 
    });
  }
}

module.exports = { data, execute };
