const { DataTypes } = require("sequelize");
const { sequelize } = require("../../config/pg-config");

const UserRoles = sequelize.define('roles', {
    role_id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        unique: true,
    },
    role_name: {
        type: DataTypes.ENUM("customer", "admin"),
        allowNull: false,
        defaultValue: "customer",
    }
});

module.exports = UserRoles;