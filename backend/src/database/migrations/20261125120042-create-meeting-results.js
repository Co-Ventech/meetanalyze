'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('meeting_results', {
      meeting_result_id: {
        type: Sequelize.UUID,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
        primaryKey: true,
        allowNull: false
      },
      meeting_id: {
        type: Sequelize.UUID,
        allowNull: false,
        unique: true,
        references: {
          model: 'meetings',
          key: 'meeting_id'
        },
        onUpdate: 'CASCADE',
        onDelete: 'CASCADE'
      },
      meeting_title: {
        type: Sequelize.STRING,
        allowNull: false
      },
      meeting_score: {
        type: Sequelize.INTEGER
      },
      outcome: {
        type: Sequelize.ENUM('Successful', 'Partially Successful', 'Unsuccessful')
      },
      outcome_reason: {
        type: Sequelize.TEXT
      },
      summary: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      duration: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      strong_points: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: []
      },
      weak_points: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: []
      },
      improvements: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: []
      },
      scorecard: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: []
      },
      recommendations: {
        type: Sequelize.JSONB
      },
      limitations: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: []
      },
      speaker_stats: {
        type: Sequelize.JSONB,
        allowNull: false,
        defaultValue: []
      },
      model: {
        type: Sequelize.STRING
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      }
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('meeting_results');
    // Postgres keeps the ENUM type after the table is dropped
    await queryInterface.sequelize.query('DROP TYPE IF EXISTS "enum_meeting_results_outcome";');
  }
};
