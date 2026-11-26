const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/pg-config');

const Transcript = sequelize.define(
  'Transcript',
  {
    transcript_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      unique: true,
    },
    meetingId: {
      type: DataTypes.UUID,
      allowNull: false,
    },
    speaker: {
      type: DataTypes.STRING
    },
    text: {
      type: DataTypes.TEXT
    }
  },
  
  {
    tableName: 'transcripts',
    timestamps: true, // createdAt / updatedAt (camelCase, as in the migration)
    underscored: true, // maps createdAt/updatedAt to created_at/updated_at
  }
);

module.exports = Transcript;
