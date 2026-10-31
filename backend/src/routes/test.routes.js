const testController = require("../controllers/test.controller");

const testRoute=[
    {
        url:'/',
        method:'GET',
        handler: testController.testController
    }
]

module.exports=testRoute