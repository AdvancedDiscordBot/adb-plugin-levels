const createLevelCommand = require('./commands/level');
const createLeaderboardCommand = require('./commands/leaderboard');
const createLevelConfigCommand = require('./commands/level-config');
const createLevelRolesCommand = require('./commands/level-roles');

const LevelSchema = require('./models/Level');
const LevelConfigSchema = require('./models/LevelConfig');
const LevelRoleSchema = require('./models/LevelRole');

// Simple level curve: level = floor(sqrt(xp / 100))
function levelForXp(xp) {
  return Math.floor(Math.sqrt((xp || 0) / 100));
}

async function load(ctx) {
  ctx.logger.info('Levels plugin loading...');

  // --- Models (namespaced to this plugin) ---------------------------------
  const LevelModel = ctx.defineModel('Level', LevelSchema);
  const LevelConfigModel = ctx.defineModel('LevelConfig', LevelConfigSchema);
  const LevelRoleModel = ctx.defineModel('LevelRole', LevelRoleSchema);

  // --- Commands (models injected; commands never reach outside the plugin) -
  ctx.registerCommand(createLevelCommand(LevelModel));
  ctx.registerCommand(createLeaderboardCommand(LevelModel));
  ctx.registerCommand(createLevelConfigCommand(LevelConfigModel));
  ctx.registerCommand(createLevelRolesCommand(LevelRoleModel));

  // Per-user XP cooldown, kept in-memory. The real ADB ctx.db has no generic
  // get/set KV store, so cooldown state lives in the plugin process.
  // ponytail: in-memory per-process cooldown; move to a TTL store if the bot
  // ever runs sharded and XP double-awards across shards.
  const lastXpAt = new Map(); // key `${guildId}:${userId}` -> epoch ms

  async function getConfig(guildId) {
    const cfg = await LevelConfigModel.findOne({ guildId });
    return {
      xpPerMessage: cfg?.xpPerMessage ?? 5,
      xpCooldown: cfg?.xpCooldown ?? 60,
      xpPerMinuteLimit: cfg?.xpPerMinuteLimit ?? 100,
      levelUpChannelId: cfg?.levelUpChannelId ?? null,
    };
  }

  // --- Award XP on message ------------------------------------------------
  ctx.registerEvent('messageCreate', async (message) => {
    if (message.author?.bot || !message.guild) return;

    try {
      const config = await getConfig(message.guild.id);
      const now = Date.now();
      const key = `${message.guild.id}:${message.author.id}`;

      const last = lastXpAt.get(key) || 0;
      if (now - last < config.xpCooldown * 1000) return;
      lastXpAt.set(key, now);

      const existing = await LevelModel.findOne({
        guildId: message.guild.id,
        userId: message.author.id,
      });
      const oldXp = existing?.xp || 0;
      const newXp = oldXp + config.xpPerMessage;

      await LevelModel.findOneAndUpdate(
        { guildId: message.guild.id, userId: message.author.id },
        { $set: { lastMessageAt: new Date() }, $inc: { xp: config.xpPerMessage } },
        { upsert: true, new: true }
      );

      const oldLevel = levelForXp(oldXp);
      const newLevel = levelForXp(newXp);

      if (newLevel > oldLevel) {
        await LevelModel.updateOne(
          { guildId: message.guild.id, userId: message.author.id },
          { $set: { level: newLevel } }
        );

        // Notify other plugins.
        await ctx.hooks.emitHook('onLevelUp', {
          user: message.author,
          newLevel,
          guild: message.guild,
        });

        // Announce in configured channel, if any.
        if (config.levelUpChannelId) {
          const channel = message.guild.channels.cache.get(config.levelUpChannelId);
          if (channel) {
            channel.send(`${message.author} has reached level ${newLevel}! :tada:`);
          }
        }

        // Grant role rewards for the new level.
        const roleRewards = await LevelRoleModel.find({
          guildId: message.guild.id,
          level: newLevel,
        });
        for (const reward of roleRewards) {
          const role = message.guild.roles.cache.get(reward.roleId);
          if (role && message.member && !message.member.roles.cache.has(role.id)) {
            await message.member.roles.add(role);
            try {
              await message.author.send(
                `You earned the ${role.name} role for reaching level ${newLevel}!`
              );
            } catch (e) {
              // DMs closed — ignore.
            }
          }
        }
      }
    } catch (error) {
      ctx.logger.error('Error in levels plugin:', error);
    }
  });

  ctx.logger.info('Levels plugin loaded!');
}

module.exports = { load, levelForXp };
