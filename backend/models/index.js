const { sequelize } = require('../config/pg-config');
const User = require('./user');
const Meeting = require('./meeting');
const Transcript = require('./transcript');
const MeetingResults = require('./meeting-results');

// User 1 ── * Meeting
User.hasMany(Meeting, {
  foreignKey: 'userId',
  sourceKey: 'user_id',
  as: 'meetings',
  onDelete: 'CASCADE'
});
Meeting.belongsTo(User, {
  foreignKey: 'userId',
  targetKey: 'user_id',
  as: 'user'
});

// Meeting 1 ── * Transcript
Meeting.hasMany(Transcript, {
  foreignKey: 'meetingId',
  sourceKey: 'meeting_id',
  as: 'transcripts',
  onDelete: 'CASCADE'
});
Transcript.belongsTo(Meeting, {
  foreignKey: 'meetingId',
  targetKey: 'meeting_id',
  as: 'meeting'
});

// Meeting 1 ── 1 MeetingResults
Meeting.hasOne(MeetingResults, {
  foreignKey: 'meeting_id',
  sourceKey: 'meeting_id',
  as: 'result',
  onDelete: 'CASCADE'
});
MeetingResults.belongsTo(Meeting, {
  foreignKey: 'meeting_id',
  targetKey: 'meeting_id',
  as: 'meeting'
});

module.exports = { sequelize, User, Meeting, Transcript, MeetingResults };
