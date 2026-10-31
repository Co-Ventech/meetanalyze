const { DataTypes } = require('sequelize')
const {sequelize} = require('../../config/pg-config');
const user = require('./user');

const order= sequelize.define('order',{
    order_id:{
        type: DataTypes.UUID,
        primaryKey:true
    },
    customer_id:{
        type: DataTypes.UUID,
        references:{
            model: user,
            key:'user_id'
        }
    },
    total_amount:{
        type: DataTypes.FLOAT,
        allowNull: false
    },
    order_status:{
        type: DataTypes.ENUM('delivered','shipped','processing'),
        defaultValue: 'processing'
    },
    products:{ //here, product ids will be there
        type: DataTypes.JSONB,
        allowNull: false
    }
})

module.exports=order;