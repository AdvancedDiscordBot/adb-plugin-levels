const createLevelCommand = require("./commands/level");
const createLeaderboardCommand = require("./commands/leaderboard");
const createLevelConfigCommand = require("./commands/level-config");
const createLevelRolesCommand = require("./commands/level-roles");

const LevelSchema = require("./models/Level");
const LevelConfigSchema = require("./models/LevelConfig");
const LevelRoleSchema = require("./models/LevelRole");

// Simple level curve: level = floor(sqrt(xp / 100))
function levelForXp(xp) {
	return Math.floor(Math.sqrt((xp || 0) / 100));
}

async function load(ctx) {
	const LevelModel = ctx.defineModel("Level", LevelSchema);
	const LevelConfigModel = ctx.defineModel("LevelConfig", LevelConfigSchema);
	const LevelRoleModel = ctx.defineModel("LevelRole", LevelRoleSchema);

	async function getConfig(guildId) {
		const [legacy, shared] = await Promise.all([
			LevelConfigModel.findOne({ guildId }),
			ctx.db.getPluginConfig(guildId, "adb-plugin-levels"),
		]);
		const config = { ...shared?.data };
		for (const [key, fallback, min, max] of [
			["xpPerMessage", 5, 1, 50],
			["xpCooldown", 60, 10, 300],
			["xpPerMinuteLimit", 100, 10, 1000],
		]) {
			const value = config[key] ?? legacy?.[key] ?? fallback;
			config[key] = Number.isFinite(value) && value >= min && value <= max ? value : fallback;
		}
		if (config.levelUpChannelId === undefined) config.levelUpChannelId = legacy?.levelUpChannelId ?? null;
		return config;
	}

	ctx.registerCommand(createLevelCommand(LevelModel));
	ctx.registerCommand(createLeaderboardCommand(LevelModel));
	ctx.registerCommand(createLevelConfigCommand(ctx.db, getConfig));
	ctx.registerCommand(createLevelRolesCommand(LevelRoleModel));

	const xpState = new Map();
	const awarding = new Set();
	let nextCleanup = 0;
	ctx.registerEvent("messageCreate", async (message) => {
		if (message.author?.bot || !message.guild) return;
		const key = `${message.guild.id}:${message.author.id}`;
		if (awarding.has(key)) return;
		awarding.add(key);
		try {
			const config = await getConfig(message.guild.id);
			const now = Date.now();
			// Lazy expiry bounds retained users to the longest supported cooldown.
			if (now >= nextCleanup) {
				for (const [id, state] of xpState) if (now - state.last >= 300000) xpState.delete(id);
				nextCleanup = now + 60000;
			}
			const state = xpState.get(key);
			if (state && now - state.last < config.xpCooldown * 1000) return;
			const awards = (state?.awards || []).filter((entry) => now - entry.at < 60000);
			const xp = Math.min(config.xpPerMessage, config.xpPerMinuteLimit - awards.reduce((sum, entry) => sum + entry.xp, 0));
			if (xp <= 0) return;

			const query = { guildId: message.guild.id, userId: message.author.id };
			const updated = await LevelModel.findOneAndUpdate(
				query,
				{ $set: { lastMessageAt: new Date(now) }, $inc: { xp } },
				{ upsert: true, new: true }
			);
			xpState.set(key, { last: now, awards: [...awards, { at: now, xp }] });
			// A prior XP write may have succeeded while saving its level failed.
			const oldLevel = updated.level ?? 0;
			const newLevel = levelForXp(updated.xp);
			if (updated.level < newLevel) await LevelModel.updateOne(query, { $max: { level: newLevel } });
			if (newLevel <= oldLevel) return;

			await ctx.hooks.emitHook("onLevelUp", { user: message.author, newLevel, guild: message.guild });
			if (config.levelUpChannelId) {
				const channel = message.guild.channels.cache.get(config.levelUpChannelId);
				if (channel) {
					try {
						await channel.send(`${message.author} has reached level ${newLevel}! :tada:`);
					} catch (error) {
						ctx.logger.error("Failed to announce level-up", error);
					}
				}
			}

			const rewards = await LevelRoleModel.find({ guildId: message.guild.id, level: { $lte: newLevel } });
			const grantedRoleIds = new Set();
			for (const reward of rewards) {
				const role = message.guild.roles.cache.get(reward.roleId);
				if (!role || !message.member || message.member.roles.cache.has(role.id) || grantedRoleIds.has(role.id)) continue;
				try {
					await message.member.roles.add(role);
					grantedRoleIds.add(role.id);
				} catch (error) {
					ctx.logger.error(`Failed to grant level role ${role.id}`, error);
					continue;
				}
				try {
					await message.author.send(`You earned the ${role.name} role for reaching level ${reward.level}!`);
				} catch {
					// Closed DMs do not undo a role reward.
				}
			}
		} catch (error) {
			ctx.logger.error("Error in levels plugin:", error);
		} finally {
			awarding.delete(key);
		}
	});
	ctx.logger.info("Levels plugin loaded!");
}

module.exports = { load, levelForXp };
