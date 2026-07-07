const { Schema, model } = require('mongoose');

const LevelRoleSchema = new Schema({
  guildId: { type: String, required: true, index: true },
  level: { type: Number, required: true, min: 1 },
  roleId: { type: String, required: true }
}, {
  collection: 'plugin_adb-plugin-levels_leaderole',
  timestamps: true
});

// Compound index for efficient queries
LevelRoleSchema.index({ guildId: 1, level: 1 }, { unique: true });

module.exports = LevelRoleSchema;
