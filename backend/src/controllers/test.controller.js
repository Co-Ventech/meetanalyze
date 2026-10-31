const testController = (req, res) => {
  res.status(200).send({
    status: 200,
    message: "server is active",
  });
};

module.exports = {
  testController,
};
