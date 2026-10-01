"use strict";

/**
 * local-harness.js — offline smoke test for adb-plugin-levels.
 * Run: npm test. No bot / no Mongo.
 *
 * Covers the bot-contract-critical paths: commands use injected models (not
 * the bot's models dir), config shares the dashboard store with legacy fallbacks, and XP
 * award on messageCreate fires level-ups + the onLevelUp hook.
 */

const { createMockCtx } = require("./mock-ctx");
const { load, levelForXp } = require("../index");

let passed = 0;
let failed = 0;
function assert(cond, label) {
	if (cond) {
		console.log(`  PASS  ${label}`);
		passed++;
	} else {
		console.error(`  FAIL  ${label}`);
		failed++;
	}
}

function fakeInteraction({ sub, opts = {}, user, guildId = "guild-1" } = {}) {
	const replies = [];
	const guild = {
		id: guildId,
		name: "Test Guild",
		members: { cache: new Map() },
		roles: { cache: new Map() },
		channels: { cache: new Map() },
	};
	return {
		guild,
		guildId,
		user: user || { id: "user-1", username: "Tester", displayAvatarURL: () => "https://example.invalid/avatar.png" },
		deferred: false,
		options: {
			getSubcommand: () => sub,
			getString: (n) => (n in opts ? opts[n] : null),
			getInteger: (n) => (n in opts ? opts[n] : null),
			getUser: (n) => (n in opts ? opts[n] : null),
			getRole: (n) => (n in opts ? opts[n] : null),
			getChannel: (n) => (n in opts ? opts[n] : null),
		},
		async deferReply(options = {}) { this.deferred = true; this.ephemeral = !!options.ephemeral; },
		async editReply(p) {
			if (!this.deferred) throw new Error("editReply before acknowledgement");
			if (this.deleted) throw new Error("editReply after deleting the original reply");
			replies.push({ ...p, ephemeral: this.ephemeral });
		},
		async deleteReply() { this.deleted = true; },
		async followUp(p) {
			if (!this.deferred) throw new Error("followUp before acknowledgement");
			replies.push({ ...p, ephemeral: !!p.ephemeral });
		},
		async reply(p) {
			if (this.deferred) throw new Error("reply after acknowledgement");
			replies.push(p);
			return p;
		},
		replies,
	};
}

function fakeMessage({ userId = "user-1", guildId = "guild-1", bot = false } = {}) {
	return {
		author: { id: userId, bot, username: "Tester", send: async () => {} },
		member: { roles: { cache: new Map(), add: async () => {} } },
		guild: {
			id: guildId,
			channels: { cache: new Map() },
			roles: { cache: new Map() },
		},
	};
}

async function run() {
	console.log("\n=== adb-plugin-levels — Local Harness ===\n");

	// pure helper
	assert(levelForXp(0) === 0, "levelForXp(0) === 0");
	assert(levelForXp(100) === 1, "levelForXp(100) === 1");
	assert(levelForXp(400) === 2, "levelForXp(400) === 2");

	const { ctx, registeredCommands, emitEvent, models } = createMockCtx({
		pluginName: "adb-plugin-levels",
	});
	await load(ctx);

	for (const name of ["level", "leaderboard", "level-config", "level-roles"]) {
		assert(registeredCommands.has(name), `/${name} registered`);
	}

	// --- level-config shares the dashboard's plugin-config store -----------
	const cfg = fakeInteraction({ opts: { "xp-per-message": 50, "xp-cooldown": 10 } });
	await registeredCommands.get("level-config").execute(cfg);
	assert(!!cfg.replies[0].embeds, "level-config replies with an embed");
	const LevelConfig = models.get("plugin_adb-plugin-levels_LevelConfig");
	const sharedCfg = (await ctx.db.getPluginConfig("guild-1", "adb-plugin-levels")).data;
	assert(sharedCfg.xpPerMessage === 50, "level-config writes the same settings store as the dashboard");

	// --- /level for a user with no XP --------------------------------------
	const noxp = fakeInteraction({ opts: {} });
	await registeredCommands.get("level").execute(noxp);
	assert(/has not earned any XP/.test(noxp.replies[0].content), "/level reports no XP for fresh user");
	assert(noxp.replies[0].ephemeral === true, "no-XP response remains private after acknowledgement");
	const emptyBoard = fakeInteraction({ guildId: "empty-ranking" });
	await registeredCommands.get("leaderboard").execute(emptyBoard);
	assert(emptyBoard.replies[0].ephemeral === true, "empty leaderboard response remains private after acknowledgement");

	// --- messageCreate awards XP and eventually levels up -------------------
	let leveledUp = null;
	ctx.hooks.on("onLevelUp", (payload) => {
		leveledUp = payload;
	});

	// xpPerMessage=50, cooldown=10s. Two messages spaced past cooldown => 100 xp => level 1.
	await emitEvent("messageCreate", fakeMessage());
	// Immediate repeated messages remain inside the configured cooldown.
	await emitEvent("messageCreate", fakeMessage());

	const Level = models.get("plugin_adb-plugin-levels_Level");
	const rec = await Level.findOne({ guildId: "guild-1", userId: "user-1" });
	assert(rec && rec.xp === 50, "XP awarded once; cooldown blocks the immediate second message");

	// bot messages are ignored
	await emitEvent("messageCreate", fakeMessage({ userId: "bot-1", bot: true }));
	const botRec = await Level.findOne({ guildId: "guild-1", userId: "bot-1" });
	assert(!botRec, "bot-authored messages award no XP");

	// --- level-roles add + list --------------------------------------------
	const addRole = fakeInteraction({
		sub: "add",
		opts: { level: 5, role: { id: "role-1", toString: () => "@Level5" } },
	});
	await registeredCommands.get("level-roles").execute(addRole);
	assert(/reward for reaching level 5/.test(addRole.replies[0].content), "level-roles add confirms");

	const listRole = fakeInteraction({ sub: "list" });
	await registeredCommands.get("level-roles").execute(listRole);
	assert(!!listRole.replies[0].embeds, "level-roles list returns an embed");

	const clock = Date.now;
	let now = clock();
	Date.now = () => now;
	try {
		await ctx.db.updatePluginConfig("dashboard", "adb-plugin-levels", {
			xpPerMessage: 50, xpCooldown: 10, xpPerMinuteLimit: 60, extra: "preserve",
		});
		await emitEvent("messageCreate", fakeMessage({ guildId: "dashboard" }));
		now += 10000;
		await emitEvent("messageCreate", fakeMessage({ guildId: "dashboard" }));
		now += 10000;
		await emitEvent("messageCreate", fakeMessage({ guildId: "dashboard" }));
		assert((await Level.findOne({ guildId: "dashboard" })).xp === 60, "dashboard rates apply and rolling minute XP is capped, including partial awards");
		now += 40000;
		await emitEvent("messageCreate", fakeMessage({ guildId: "dashboard" }));
		assert((await Level.findOne({ guildId: "dashboard" })).xp === 110, "minute budget is released when old awards expire");

		await LevelConfig.create({ guildId: "legacy", xpPerMessage: 25, xpCooldown: 10 });
		await emitEvent("messageCreate", fakeMessage({ guildId: "legacy" }));
		assert((await Level.findOne({ guildId: "legacy" })).xp === 25, "existing LevelConfig records remain effective until dashboard settings override them");
		const configUpdate = fakeInteraction({ guildId: "dashboard", opts: { "xp-per-message": 20 } });
		await registeredCommands.get("level-config").execute(configUpdate);
		const updatedConfig = (await ctx.db.getPluginConfig("dashboard", "adb-plugin-levels")).data;
		assert(updatedConfig.xpPerMessage === 20 && updatedConfig.xpCooldown === 10 && updatedConfig.extra === "preserve", "partial config command preserves other dashboard settings");

		await Level.create({ guildId: "stale", userId: "user-1", xp: 95 });
		await LevelConfig.create({ guildId: "stale", xpPerMessage: 50 });
		const Role = models.get("plugin_adb-plugin-levels_LevelRole");
		for (const level of [1, 2]) await Role.create({ guildId: "stale", level, roleId: `role-${level}` });
		const staleMessage = fakeMessage({ guildId: "stale" });
		const granted = [];
		for (const level of [1, 2]) staleMessage.guild.roles.cache.set(`role-${level}`, { id: `role-${level}`, name: `Level ${level}` });
		staleMessage.member.roles.add = async (role) => granted.push(role.id);
		const updateXp = Level.findOneAndUpdate;
		Level.findOneAndUpdate = async (q, update, options) => {
			if (q.guildId === "stale") await Level.updateOne(q, { $inc: { xp: 300 } });
			return updateXp(q, update, options);
		};
		try { await emitEvent("messageCreate", staleMessage); } finally { Level.findOneAndUpdate = updateXp; }
		const staleRecord = await Level.findOne({ guildId: "stale" });
		assert(staleRecord.xp === 445 && staleRecord.level === 2 && leveledUp?.newLevel === 2, "level and hook use atomic post-update XP rather than a stale read");
		assert(granted.includes("role-1") && granted.includes("role-2"), "all earned reward thresholds are granted, not only the final level");

		const errors = [];
		ctx.logger.error = (...args) => errors.push(args);
		Level.findOneAndUpdate = async () => { throw new Error("database unavailable"); };
		try { await emitEvent("messageCreate", fakeMessage({ guildId: "retry" })); } finally { Level.findOneAndUpdate = updateXp; }
		await emitEvent("messageCreate", fakeMessage({ guildId: "retry" }));
		assert((await Level.findOne({ guildId: "retry" }))?.xp === 5, "failed XP write does not consume the cooldown or minute budget");
		assert(errors.length === 1, "database failure is logged once by the registered event");

		await LevelConfig.create({ guildId: "bad-config", xpPerMessage: -100, xpCooldown: -1, xpPerMinuteLimit: -5 });
		await Promise.all([1, 2].map(() => emitEvent("messageCreate", fakeMessage({ guildId: "bad-config" }))));
		assert((await Level.findOne({ guildId: "bad-config" }))?.xp === 5, "invalid persisted rates use bounded defaults and parallel messages cannot double-award");

		await Level.create({ guildId: "discord-errors", userId: "user-1", xp: 399 });
		await ctx.db.updatePluginConfig("discord-errors", "adb-plugin-levels", { levelUpChannelId: "announcements" });
		for (const level of [1, 2]) await Role.create({ guildId: "discord-errors", level, roleId: `error-role-${level}` });
		const discordErrors = fakeMessage({ guildId: "discord-errors" });
		const added = [];
		for (const level of [1, 2]) discordErrors.guild.roles.cache.set(`error-role-${level}`, { id: `error-role-${level}`, name: `Level ${level}` });
		discordErrors.member.roles.add = async (role) => {
			if (role.id === "error-role-1") throw new Error("role hierarchy");
			added.push(role.id);
		};
		discordErrors.guild.channels.cache.set("announcements", { send: async () => { throw new Error("cannot send"); } });
		await emitEvent("messageCreate", discordErrors);
		assert(added.includes("error-role-2") && (await Level.findOne({ guildId: "discord-errors" })).level === 2, "announcement and individual role failures do not block other earned rewards");
		assert(errors.length === 3, "Discord rejections are awaited and logged rather than left unhandled");

		await Level.create({ guildId: "ranking", userId: "low", xp: 1 });
		await Level.create({ guildId: "ranking", userId: "high", xp: 120 });
		const board = fakeInteraction({ guildId: "ranking" });
		board.guild.members.cache.set("low", { user: { username: "Low" } });
		board.guild.members.cache.set("high", { user: { username: "High" } });
		await registeredCommands.get("leaderboard").execute(board);
		const boardText = board.replies[0].embeds[0].toJSON().description;
		assert(board.deferred && boardText.indexOf("High") < boardText.indexOf("Low"), "registered leaderboard uses real query ordering and deferred replies");
		const rank = fakeInteraction({ guildId: "stale" });
		await registeredCommands.get("level").execute(rank);
		assert(rank.replies[0].embeds[0].toJSON().fields[0].value === "2", "registered level command renders persisted XP correctly");
		assert(!rank.replies[0].ephemeral && !board.replies[0].ephemeral, "successful level and leaderboard results remain public");

		await Level.create({ guildId: "level-write-retry", userId: "user-1", xp: 95, level: 0 });
		await Role.create({ guildId: "level-write-retry", level: 1, roleId: "retry-role" });
		const retryMessage = fakeMessage({ guildId: "level-write-retry" });
		retryMessage.guild.roles.cache.set("retry-role", { id: "retry-role", name: "Level 1" });
		const retryRoles = [];
		retryMessage.member.roles.add = async (role) => retryRoles.push(role.id);
		const retryHooks = [];
		const unsubscribe = ctx.hooks.on("onLevelUp", (payload) => {
			if (payload.guild.id === "level-write-retry") retryHooks.push(payload.newLevel);
		});
		const updateLevel = Level.updateOne;
		Level.updateOne = async (query, ...args) => {
			if (query.guildId === "level-write-retry") throw new Error("level write unavailable");
			return updateLevel(query, ...args);
		};
		try { await emitEvent("messageCreate", retryMessage); } finally { Level.updateOne = updateLevel; }
		now += 60000;
		await emitEvent("messageCreate", retryMessage);
		now += 60000;
		await emitEvent("messageCreate", retryMessage);
		unsubscribe();
		const recoveredLevel = await Level.findOne({ guildId: "level-write-retry" });
		assert(recoveredLevel.xp === 110 && recoveredLevel.level === 1 && retryHooks.length === 1 && retryRoles.length === 1, "a failed level write retries its unannounced level-up and rewards exactly once");

		await Level.create({ guildId: "shared-reward", userId: "user-1", xp: 399, level: 1 });
		for (const level of [1, 2]) await Role.create({ guildId: "shared-reward", level, roleId: "shared-role" });
		const sharedReward = fakeMessage({ guildId: "shared-reward" });
		sharedReward.guild.roles.cache.set("shared-role", { id: "shared-role", name: "Shared reward" });
		let roleWrites = 0;
		let rewardDMs = 0;
		sharedReward.member.roles.add = async () => {
			roleWrites++;
			// Discord.js returns a clone; the gateway updates the original cache later.
			return { roles: { cache: new Map([["shared-role", {}]]) } };
		};
		sharedReward.author.send = async () => { rewardDMs++; };
		await emitEvent("messageCreate", sharedReward);
		assert(roleWrites === 1 && rewardDMs === 1, "the same role at multiple earned thresholds is granted and DMed only once");
	} finally {
		Date.now = clock;
	}
	assert(cfg.deferred && noxp.deferred && addRole.deferred && listRole.deferred, "DB-backed commands acknowledge before processing");

	await ctx.db.updatePluginConfig("concurrent-config", "adb-plugin-levels", {
		xpPerMessage: 5, xpCooldown: 60, _commands: { level: { enabled: false } },
	});
	await Promise.all([
		fakeInteraction({ guildId: "concurrent-config", user: { id: "admin-a" }, opts: { "xp-per-message": 20 } }),
		fakeInteraction({ guildId: "concurrent-config", user: { id: "admin-b" }, opts: { "xp-cooldown": 90 } }),
	].map((interaction) => registeredCommands.get("level-config").execute(interaction)));
	const concurrentConfig = (await ctx.db.getPluginConfig("concurrent-config", "adb-plugin-levels")).data;
	assert(concurrentConfig.xpPerMessage === 20 && concurrentConfig.xpCooldown === 90 && concurrentConfig._commands.level.enabled === false, "concurrent config commands preserve both patches and command restrictions");

	const consoleError = console.error;
	const readLevel = Level.findOne;
	const readBoard = Level.find;
	Level.findOne = () => Promise.reject(new Error("level read unavailable"));
	Level.find = () => { throw new Error("leaderboard read unavailable"); };
	try {
		for (const name of ["level", "leaderboard"]) {
			const failure = fakeInteraction();
			console.error = () => {};
			try { await registeredCommands.get(name).execute(failure); } finally { console.error = consoleError; }
			assert(failure.replies.length === 1 && failure.replies[0].ephemeral === true, `${name} storage error response remains private after acknowledgement`);
		}
	} finally {
		console.error = consoleError;
		Level.findOne = readLevel;
		Level.find = readBoard;
	}

	console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
	process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
	console.error("Harness crashed:", err);
	process.exit(1);
});
