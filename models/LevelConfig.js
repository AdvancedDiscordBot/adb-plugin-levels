const { Schema, model } = require('mongoose');

const LevelConfigSchema = new Schema({
  guildId: { type: String, required: true, unique: true },
  xpPerMessage: { type: Number, default: 5 },
  xpCooldown: { type: Number, default: 60 },
  xpPerMinuteLimit: { type: Number, default: 100 },
  levelUpChannelId: { type: String, default: null }
}, {
  collection: 'plugin_adb-plugin-levels_levelconfig',
  timestamps: true
});

module.exports = LevelConfigSchema;
