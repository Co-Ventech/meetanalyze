const { DataTypes } = require("sequelize");
const { sequelize } = require("../../config/pg-config");
const { encryptPassword } = require("../utils/encrypt-password");
const { comparePassword } = require("../utils/compare-password");

const User = sequelize.define("user", {
  user_id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true,
    unique: true,
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  user_role: {
    type: DataTypes.ENUM("customer", "admin"),
    allowNull: false,
    defaultValue: "customer",
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      isEmail: true
    }
  },
  password: {
    type: DataTypes.STRING,

  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    allowNull: false,
  },
  updated_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    allowNull: false,
  },
}, {
  defaultScope: {
    attributes: { exclude: ['password'] }
  }
});


// create a hashed password before inserting it into DB
User.addHook('beforeCreate', (user, options) => {
  if (user.password) {
    user.password = encryptPassword(user.password);
  }
});


//this is for password validation (during login or any sort of authentication)
User.prototype.validatePassword = async (password) => {
  return await comparePassword(password, this.password)
}

//for updation hook
User.addHook('beforeUpdate', async (user) => {
  if (user.changed('password')) {
    user.password = encryptPassword(user.password);
  }
});

module.exports = User;
