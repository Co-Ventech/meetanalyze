const { DataTypes } = require('sequelize')
const {sequelize} = require('../../config/pg-config');
const order = require('./order');

const payment= sequelize.define('payment',{
    payment_id:{
        type: DataTypes.UUID,
        primaryKey: true,
    },
    payment_status:{
        type: DataTypes.ENUM('paid','pending')
    },
    payment_received:{
        type: DataTypes.FLOAT,
        allowNull: false,
        defaultValue:0
    },
    payment_mode:{
        type: DataTypes.ENUM('cash-on-delivery','online-transfer'),
        defaultValue:'cash-on-delievery'
    },
    order:{
        type: DataTypes.UUID,
        references:{
            model: order,
            key:'order_id'
        }
    }
})

payment.hasOne(order,{foreignKey:'order_id'});
order.belongsTo(payment,{foreignKey:'order_id'})

module.exports=payment;