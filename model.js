const definition = require('./definition.js')

const Session = definition.foreignModel('session', 'Session')
const User = definition.foreignModel('users', 'User')
const Membership = definition.foreignModel('members', 'Membership')

const Access = definition.model({
  name: "Access",
  properties: {
    toType: {
      type: String,
      validation: ['nonEmpty']
    },
    toId: {
      type: String,
      validation: ['nonEmpty']
    },
    publicUserAccessRole: {
      type: String
    },
    publicGuestAccessRole: {
      type: String
    }
  },
  indexes: {
    byTo: {
      property: ['toType', 'toId']
    }
  }
})

const PublicSessionInfo = definition.model({
  name: "PublicSessionInfo",
  properties: {
    session: {
      type: Session,
      validation: ['nonEmpty']
    },
    name: {
      type: String
    },
    online: {
      type: Boolean
    },
    lastOnline: {
      type: Date
    },
    user: {
      type: User
    }
  },
  indexes: {
    bySession: {
      property: 'session'
    },
    online: {
      property: "online",
      function: async function(input, output) {
        const mapper =
            (obj) => obj.online && ({ id: obj.id, to: obj.id })
        await input.table('accessControl_PublicSessionInfo').onChange(
            (obj, oldObj) => output.change(obj && mapper(obj), oldObj && mapper(oldObj))
        )
      }
    },
    neverOnline: {
      property: ["online", "lastOnline"],
      function: async function(input, output) {
        const mapper =
            (obj) => (!obj.online) && (!obj.lastOnline) &&
                ({ id: obj.id, to: obj.id })
        await input.table('accessControl_PublicSessionInfo').onChange(
            (obj, oldObj) => output.change(obj && mapper(obj), oldObj && mapper(oldObj))
        )
      }
    },
    wasOnline: {
      property: ["online", "lastOnline"],
      function: async function(input, output) {
        const mapper =
            (obj) => (obj.online || obj.lastOnline) &&
                ({ id: obj.id, to: obj.id })
        await input.table('accessControl_PublicSessionInfo').onChange(
            (obj, oldObj) => output.change(obj && mapper(obj), oldObj && mapper(oldObj))
        )
      }
    }
  }
})

const SessionAccess = definition.model({
  name: "SessionAccess",
  properties: {
    access: {
      type: Access,
      validation: ['nonEmpty']
    },
    session: {
      type: Session,
      validation: ['nonEmpty']
    },
    role: {
      type: String,
      validation: ['nonEmpty']
    },
    publicInfo: {
      type: PublicSessionInfo,
      validation: ['nonEmpty']
    }
  },
  indexes: {
    byAccess: {
      property: 'access'
    },
    bySession: {
      property: 'session'
    },
    bySessionAccess: {
      property: ['session', 'access']
    }
  }
})

definition.event({
  name: "accessCreated",
  async execute({ toType, toId, users, sessions, publicUserAccessRole, publicGuestAccessRole }) {
    await Access.create({ id: toType+'_'+toId, toType, toId, users, sessions,
      publicUserAccessRole, publicGuestAccessRole })
  }
})

definition.event({
  name: "accessDeleted",
  async execute({ toType, toId }) {
    const id = toType + '_' + toId
    await SessionAccess.indexRangeDelete('byAccess', id )
    await Access.delete(id)
  }
})

definition.event({
  name: "sessionAccessRemoved",
  async execute({ toType, toId, session }) {
    await SessionAccess.delete(toType + '_' + toId + '_' + session)
  }
})

definition.event({
  name: "sessionAccessAdded",
  async execute({ toType, toId, session, role, publicInfo }) {
    await SessionAccess.create({
      id: toType + '_' + toId + '_' + session,
      access: toType + '_' + toId,
      session, role, publicInfo
    })
  }
})

definition.event({
  name: "sessionAccessRoleChanged",
  async execute({ membership, role }) {
    await SessionAccess.update(membership, { role })
  }
})

definition.event({
  name: "publicSessionInfoCreated",
  async execute({ publicSessionInfo, session }) {
    console.log("PUB SESS INFO CREATED", session, "=>", publicSessionInfo)
    await PublicSessionInfo.update(publicSessionInfo, [
      { op: 'reverseMerge', value: { id: publicSessionInfo, session } }
    ])
  }
})

definition.event({
  name: "publicSessionInfoUpdated",
  async execute({ publicSessionInfo, data }) {
    console.log("PUB SESS INFO Updated", publicSessionInfo, ":", data)
    await PublicSessionInfo.update(publicSessionInfo, data || {})
  }
})

definition.event({
  name: "PublicSessionInfoUpdated",
  async execute({ publicSessionInfo, data }) {
    console.log("PUB SESS INFO Updated", publicSessionInfo, ":", data)
    await PublicSessionInfo.update(publicSessionInfo, data || {})
  }
})



module.exports = {
  Access, PublicSessionInfo, SessionAccess, Session, User, Membership
}
