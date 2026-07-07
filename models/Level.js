const { Schema, model } = require('mongoose');

const LevelSchema = new Schema({
  guildId: { type: String, required: true, index: true },
  userId: { type: String, required: true, index: true },
  xp: { type: Number, default: 0 },
  level: { type: Number, default: 0 },
  lastMessageAt: { type: Date, default: Date.now }
}, {
  collection: 'plugin_adb-plugin-levels_level',
  timestamps: true
});

// Compound index for efficient queries
LevelSchema.index({ guildId: 1, userId: 1 }, { unique: true });

module.exports = LevelSchema;
