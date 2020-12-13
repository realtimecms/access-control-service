const app = require('./app.js')
const validators = require("../validation")

const definition = app.createServiceDefinition({
  name: 'accessControl',
  eventSourcing: true,
  validators
})

module.exports = definition