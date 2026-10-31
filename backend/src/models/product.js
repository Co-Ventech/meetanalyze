const { DataTypes } = require('sequelize')
const {sequelize} = require('../../config/pg-config');

const product= sequelize.define('product',{
    product_id:{
        primaryKey:true,
        type: DataTypes.UUID
    },
    product_name:{
        type: DataTypes.STRING,
        allowNull: false
    },
    price:{
        type: DataTypes.FLOAT,
        allowNull: false
    },
    currency:{
        type: DataTypes.ENUM('USD','PKR','INR'),
        defaultValue:'PKR',
        allowNull: false
    },
    description:{
        type: DataTypes.STRING,
        allowNull: false,
    },
    category:{
        type: DataTypes.ENUM('chair','sofa','cushion set','bar stool','dresser','cabinet'),
        defaultValue:'chair',
        allowNull: false
    },
    quantity:{
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue:0
    },
    created_at:{
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        allowNull: false
    },
    updated_at:{
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
        allowNull: false
    },
    discount:{
        type: DataTypes.FLOAT,
        defaultValue:0,
    },
    purchase_count:{
        type: DataTypes.INTEGER,
        defaultValue:0
    }
});



module.exports= product;