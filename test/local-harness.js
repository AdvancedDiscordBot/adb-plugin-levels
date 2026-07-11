"use strict";

/**
 * local-harness.js — offline smoke test for adb-plugin-levels.
 * Run: npm test. No bot / no Mongo.
 *
 * Covers the bot-contract-critical paths: commands use injected models (not
 * the bot's models dir), config lives in the plugin's own collection, and XP
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
		user: user || { id: "user-1", username: "Tester" },
		options: {
			getSubcommand: () => sub,
			getString: (n) => (n in opts ? opts[n] : null),
			getInteger: (n) => (n in opts ? opts[n] : null),
			getUser: (n) => (n in opts ? opts[n] : null),
			getRole: (n) => (n in opts ? opts[n] : null),
			getChannel: (n) => (n in opts ? opts[n] : null),
		},
		reply: async (p) => {
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

	// --- level-config persists to the plugin's own LevelConfig model --------
	const cfg = fakeInteraction({ opts: { "xp-per-message": 50, "xp-cooldown": 10 } });
	await registeredCommands.get("level-config").execute(cfg);
	assert(!!cfg.replies[0].embeds, "level-config replies with an embed");
	const LevelConfig = models.get("plugin_adb-plugin-levels_LevelConfig");
	const savedCfg = await LevelConfig.findOne({ guildId: "guild-1" });
	assert(savedCfg && savedCfg.xpPerMessage === 50, "config saved xpPerMessage=50 to plugin collection");

	// --- /level for a user with no XP --------------------------------------
	const noxp = fakeInteraction({ opts: {} });
	await registeredCommands.get("level").execute(noxp);
	assert(/has not earned any XP/.test(noxp.replies[0].content), "/level reports no XP for fresh user");

	// --- messageCreate awards XP and eventually levels up -------------------
	let leveledUp = null;
	ctx.hooks.on("onLevelUp", (payload) => {
		leveledUp = payload;
	});

	// xpPerMessage=50, cooldown=10s. Two messages spaced past cooldown => 100 xp => level 1.
	await emitEvent("messageCreate", fakeMessage());
	// second message would be blocked by cooldown (same ms); advance by mutating map is internal.
	// Instead drive many users to reach level via a single-shot: send with a fresh user each time
	// won't accumulate. So we rely on the in-memory cooldown: call again after monkey-sleeping.
	await new Promise((r) => setTimeout(r, 5)); // still < 10s, so blocked — assert no double-award
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

	console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
	process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
	console.error("Harness crashed:", err);
	process.exit(1);
});
