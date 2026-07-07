const { SlashCommandBuilder } = require('discord.js');

async function load(ctx) {
  ctx.logger.info('Levels plugin loading...');
  
  // Register commands
  const levelCmd = require('./commands/level');
  const leaderboardCmd = require('./commands/leaderboard');
  const levelConfigCmd = require('./commands/level-config');
  const levelRolesCmd = require('./commands/level-roles');
  
  ctx.registerCommand(levelCmd);
  ctx.registerCommand(leaderboardCmd);
  ctx.registerCommand(levelConfigCmd);
  ctx.registerCommand(levelRolesCmd);
  
  // Define models
  const LevelSchema = require('./models/Level');
  const LevelConfigSchema = require('./models/LevelConfig');
  const LevelRoleSchema = require('./models/LevelRole');
  
  const LevelModel = ctx.defineModel('Level', LevelSchema);
  const LevelConfigModel = ctx.defineModel('LevelConfig', LevelConfigSchema);
  const LevelRoleModel = ctx.defineModel('LevelRole', LevelRoleSchema);
  
  // Listen for message events to award XP
  ctx.client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    
    try {
      // Get guild config
      const config = await ctx.db.getServerConfig(message.guild.id) || {};
      const xpPerMessage = config.xpPerModule?.levels?.xpPerMessage ?? 5;
      const xpCooldown = config.xpPerModule?.levels?.xpCooldown ?? 60;
      const xpPerMinuteLimit = config.xpPerModule?.levels?.xpPerMinuteLimit ?? 100;
      
      // Simple rate limiting (in production use Redis or similar)
      const now = Date.now();
      const key = `xp_${message.guild.id}_${message.author.id}`;
      
      // For simplicity, we'll just award XP with basic cooldown per user
      // A real implementation would use a proper rate limiter
      const lastXp = await ctx.db.get(`xp:${key}`) || 0;
      if (now - lastXp < xpCooldown * 1000) return;
      
      // Award XP
      const levelData = await LevelModel.findOneAndUpdate(
        { guildId: message.guild.id, userId: message.author.id },
        { $inc: { xp: xpPerMessage }, $set: { lastMessageAt: new Date() } },
        { upsert: true, new: true }
      );
      
      // Check for level up
      const oldLevel = Math.floor(Math.sqrt(levelData.xp / 100)); // Simple level formula
      const newLevel = Math.floor(Math.sqrt((levelData.xp + xpPerMessage) / 100));
      
      if (newLevel > oldLevel) {
        // Level up!
        await LevelModel.updateOne(
          { guildId: message.guild.id, userId: message.author.id },
          { $set: { level: newLevel } }
        );
        
        // Emit level up event for other plugins
        ctx.hooks.emitHook('onLevelUp', { 
          user: message.author, 
          newLevel: newLevel, 
          guild: message.guild 
        });
        
        // Send level up message if channel configured
        const levelUpChannelId = config.xpPerModule?.levels?.levelUpChannelId;
        if (levelUpChannelId) {
          const channel = message.guild.channels.cache.get(levelUpChannelId);
          if (channel) {
            channel.send(`${message.author} has reached level ${newLevel}! :tada:`);
          }
        }
        
        // Check for role rewards
        const roleRewards = await LevelRoleModel.find({ guildId: message.guild.id, level: newLevel });
        for (const reward of roleRewards) {
          const role = message.guild.roles.cache.get(reward.roleId);
          if (role && !message.member.roles.cache.has(role.id)) {
            await message.member.roles.add(role);
            try {
              await message.author.send(`You earned the ${role.name} role for reaching level ${newLevel}!`);
            } catch (e) {
              // DMs closed
            }
          }
        }
      }
      
      // Update XP timestamp
      await ctx.db.set(`xp:${key}`, now);
      
    } catch (error) {
      ctx.logger.error('Error in levels plugin:', error);
    }
  });
  
  ctx.logger.info('Levels plugin loaded!');
}

module.exports = { load };
