const { DataTypes } = require("sequelize");
const { sequelize } = require("../../config/pg-config");
const User = require("./user");

const Meeting = sequelize.define("meeting", {
  meeting_id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
  },
  user_id: {
    type: DataTypes.UUID,
    allowNull: false,
    references: { model: User, key: "user_id" },
    onDelete: "CASCADE",
  },
  meet_code: { type: DataTypes.STRING },
  title: { type: DataTypes.STRING },
  started_at: { type: DataTypes.DATE },
  ended_at: { type: DataTypes.DATE },
  duration_ms: { type: DataTypes.INTEGER },
  participants: { type: DataTypes.JSONB, defaultValue: [] },
  transcript: { type: DataTypes.JSONB, defaultValue: [] },
  speaker_stats: { type: DataTypes.JSONB, defaultValue: [] },
  insight: { type: DataTypes.JSONB },
  model: { type: DataTypes.STRING },
  status: {
    type: DataTypes.ENUM("processing", "ready", "failed"),
    allowNull: false,
    defaultValue: "processing",
  },
  error: { type: DataTypes.TEXT },
}, {
  indexes: [{ fields: ["user_id", "started_at"] }],
});

Meeting.belongsTo(User, { foreignKey: "user_id" });

module.exports = Meeting;
