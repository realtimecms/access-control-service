const app = require("@live-change/framework").app()
const validators = require("../validation")

const definition = app.createServiceDefinition({
  name: 'accessControl',
  eventSourcing: true,
  validators
})

module.exports = definition