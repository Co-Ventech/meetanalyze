const { DataTypes, DATE } = require('sequelize');
const { sequelize } = require('../config/pg-config');

const Meeting = sequelize.define(
  'Meeting',
  {
    meeting_id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      unique: true,
    },
    title: {
      type: DataTypes.STRING
    },
    userId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    participants:{
      type: DataTypes.JSONB
    },
    startedAt: {
      type: DataTypes.DATE
    }
  },
  {
    tableName: 'meetings',
    timestamps: true // createdAt / updatedAt (camelCase, as in the migration)
  }
);

module.exports = Meeting;
