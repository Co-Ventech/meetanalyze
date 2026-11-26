const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/pg-config');

const OUTCOMES = ['Successful', 'Partially Successful', 'Unsuccessful'];

const MeetingResults = sequelize.define(
  'MeetingResults',
  {
    meeting_result_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      unique: true
    },
    meeting_id: {
      type: DataTypes.UUID,
      allowNull: false,
      unique: true // one result per meeting
    },
    meeting_title: {
      type: DataTypes.STRING,
      allowNull: false
    },
    meeting_score: {
      type: DataTypes.INTEGER,
      allowNull: true,
      validate: { min: 0, max: 100 }
    },
    outcome: {
      type: DataTypes.ENUM(...OUTCOMES),
      allowNull: true
    },
    outcome_reason: {
      type: DataTypes.TEXT
    },
    summary: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    duration: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      validate: { min: 0 }
    },
    strong_points: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: []
    },
    weak_points: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: []
    },
    improvements: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: []
    },
    // [{ category, score, comment }]
    scorecard: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: []
    },
    recommendations: {
      type: DataTypes.JSONB
    },
    limitations: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: []
    },
    speaker_stats: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: []
    },
    model: {
      type: DataTypes.STRING
    }
  },
  {
    tableName: 'meeting_results',
    timestamps: true,
    underscored: true // created_at / updated_at
  }
);

module.exports = MeetingResults;
