const app = require('./app.js')
const definition = require('./definition.js')

const { getAccess, hasRole, checkIfRole, getPublicInfo } =
    require("../access-control-service/access.js")(app, definition)

const { Access, PublicSessionInfo, SessionAccess, Session, User, Membership } = require('./model.js')

const SessionAccessOnline = definition.model({
  name: "SessionAccessOnline",
  properties: {
    access: {
      type: Access,
      validation: ['nonEmpty']
    },
    publicInfo: {
      type: PublicSessionInfo,
      validation: ['nonEmpty']
    },
    online: {
      type: Boolean
    },
    onlineTime: {
      type: Date
    }
  },
  indexes: {
    byAccess: {
      property: 'access'
    },
    byPublicInfo: {
      property: 'publicInfo'
    },
    byPublicInfoAccess: {
      property: ['publicInfo', 'access']
    },
    online: {
      property: "online",
      function: async function(input, output) {
        const mapper =
            (obj) => obj.online &&
                ({ id: obj.id, to: obj.id, publicInfo: obj.publicInfo })
        await input.table('accessControl_SessionAccessOnline').onChange(
            (obj, oldObj) => output.change(obj && mapper(obj), oldObj && mapper(oldObj))
        )
      }
    }
  }
})

const UserAccessOnline = definition.model({
  name: "UserAccessOnline",
  properties: {
    access: {
      type: Access,
      validation: ['nonEmpty']
    },
    user: {
      type: User,
      validation: ['nonEmpty']
    },
    online: {
      type: Boolean
    },
    onlineTime: {
      type: Date
    }
  },
  indexes: {
    byAccess: {
      property: 'access'
    },
    byUser: {
      property: 'user'
    },
    byUserAccess: {
      property: ['user', 'access']
    },
    online: {
      property: "online",
      function: async function(input, output) {
        const mapper =
            (obj) => obj.online &&
                ({ id: obj.id, to: obj.id, user: obj.user })
        await input.table('accessControl_UserAccessOnline').onChange(
            (obj, oldObj) => output.change(obj && mapper(obj), oldObj && mapper(oldObj))
        )
      }
    }
  }
})


definition.event({
  name: "publicSessionInfoOnline",
  async execute({ publicSessionInfo, lastOnline }) {
    await PublicSessionInfo.update(publicSessionInfo, { online: true, lastOnline })
  }
})
definition.event({
  name: "publicSessionInfoOffline",
  async execute({ publicSessionInfo, lastOnline }) {
    await PublicSessionInfo.update(publicSessionInfo, { online: false, lastOnline })
  }
})
definition.event({
  name: "sessionAccessOnline",
  async execute({ access, publicInfo, lastOnline }) {
    const id = access + '_' + publicInfo
    await SessionAccessOnline.update(id, [
      { op: 'merge', value: { id, access, publicInfo, online: true, lastOnline } }
    ])
  }
})
definition.event({
  name: "sessionAccessOffline",
  async execute({ access, publicInfo, lastOnline }) {
    const id = access + '_' + publicInfo
    await SessionAccessOnline.update(id, [
      { op: 'merge', value: { id, access, publicInfo, online: false, lastOnline } }
    ])
  }
})
definition.event({
  name: "userAccessOnline",
  async execute({ access, user, lastOnline }) {
    const id = access + '_' + user
    await UserAccessOnline.update(id, [
      { op: 'merge', value: { id, access, user, online: true, lastOnline } }
    ])
  }
})
definition.event({
  name: "userAccessOffline",
  async execute({ access, user, lastOnline }) {
    const id = access + '_' + user
    await UserAccessOnline.update(id, [
      { op: 'merge', value: { id, access, user, online: false, lastOnline } }
    ])
  }
})
definition.event({
  name: "allOffline",
  async execute({ lastOnline }) {
    await app.dao.request(['database', 'query', app.databaseName, `(${
        async (input, output, { table, index, lastOnline }) => {
          await (await input.index(index)).range({
          }).onChange(async (ind, oldInd) => {
            output.table(table).update(ind.to, [{ op: 'set', property: 'online', value: false, lastOnline }])
          })
        }
    })`, { table: PublicSessionInfo.tableName, index: PublicSessionInfo.tableName+"_online", lastOnline }])
    await app.dao.request(['database', 'query', app.databaseName, `(${
        async (input, output, { table, index, lastOnline }) => {
          await (await input.index(index)).range({
          }).onChange(async (ind, oldInd) => {
            output.table(table).update(ind.to, [{ op: 'set', property: 'online', value: false, lastOnline }])
          })
        }
    })`, { table: SessionAccessOnline.tableName, index: SessionAccessOnline.tableName+"_online", lastOnline }])
    await app.dao.request(['database', 'query', app.databaseName, `(${
        async (input, output, { table, index, lastOnline }) => {
          await (await input.index(index)).range({
          }).onChange(async (ind, oldInd) => {
            output.table(table).update(ind.to, [{ op: 'set', property: 'online', value: false, lastOnline }])
          })
        }
    })`, { table: UserAccessOnline.tableName, index: UserAccessOnline.tableName+"_online", lastOnline }])
  }
})

definition.trigger({
  name: "sessionOnline",
  properties: {
  },
  async execute({ session }, context, emit) {
    const publicInfo = await getPublicInfo(session)
    console.log("SESSION TRIGGER ONLINE", publicInfo)
    if(publicInfo) {
      if(!publicInfo.online) {
        const timestamp = Date.now()
        const time = (new Date()).toISOString()
        ;(await app.connectToAnalytics()).saveEvents([
          {
            type: 'sessionOnline',
            client: { sessionId: session },
            timestamp, time,
            offlineDuration: publicInfo.lastOnline ? Date.now() - (new Date(publicInfo.lastOnline)).getTime() : undefined
          }
        ])
      }
      emit({
        type: "publicSessionInfoOnline",
        publicSessionInfo: publicInfo.id,
        lastOnline: new Date()
      })
    }
  }
})

definition.trigger({
  name: "sessionOffline",
  properties: {
  },
  async execute({ session }, context, emit) {
    const publicInfo = await getPublicInfo(session)
    console.log("SESSION TRIGGER OFFLINE", publicInfo)
    if(publicInfo) {
      if(publicInfo.online && publicInfo.lastOnline) {
        const timestamp = Date.now()
        const time = (new Date()).toISOString()
        ;(await app.connectToAnalytics()).saveEvents([
          {
            type: 'sessionOffline',
            client: { sessionId: session },
            timestamp, time,
            onlineDuration: Date.now() - (new Date(publicInfo.lastOnline)).getTime()
          }
        ])
      }
      emit({
        type: "publicSessionInfoOffline",
        publicSessionInfo: publicInfo.id,
        lastOnline: new Date()
      })
    }
  }
})

definition.trigger({
  name: "sessionAccessOnline",
  properties: {
  },
  async execute({ session, parameters: [toType, toId]}, context, emit) {
    const publicInfo = await getPublicInfo(session)
    const access = toType + '_' + toId
    console.log("ACCESS ONLINE", access, publicInfo.id)
    if(publicInfo) {
      const sessionAccessOnline = await SessionAccessOnline.get(access + '_' + publicInfo.id)
      if(!sessionAccessOnline || !sessionAccessOnline.online) {
        const timestamp = Date.now()
        const time = (new Date()).toISOString()
        ;(await app.connectToAnalytics()).saveEvents([
          {
            type: 'sessionAccessOnline',
            client: { sessionId: session },
            toType, toId,
            timestamp, time,
            offlineDuration: (sessionAccessOnline && sessionAccessOnline.lastOnline)
                ? Date.now() - (new Date(sessionAccessOnline.lastOnline)).getTime()
                : undefined
          }
        ])
      }
      emit({
        type: 'sessionAccessOnline',
        access,
        publicInfo: publicInfo.id,
        lastOnline: new Date()
      })
    }
  }
})
definition.trigger({
  name: "sessionAccessOffline",
  properties: {
  },
  async execute({ session, parameters: [toType, toId]}, context, emit) {
    const publicInfo = await getPublicInfo(session)
    const access = toType + '_' + toId
    if(publicInfo) {
      const sessionAccessOnline = await SessionAccessOnline.get(access + '_' + publicInfo.id)
      console.log("SESSION ACCESS O", sessionAccessOnline)
      if(sessionAccessOnline && sessionAccessOnline.online && sessionAccessOnline.lastOnline) {
        const timestamp = Date.now()
        const time = (new Date()).toISOString()
        console.log("SAVE ANALYTICS!", Date.now() - (new Date(sessionAccessOnline.lastOnline)).getTime())
        ;(await app.connectToAnalytics()).saveEvents([
          {
            type: 'sessionAccessOffline',
            client: { sessionId: session },
            toType, toId,
            timestamp, time,
            onlineDuration: Date.now() - (new Date(sessionAccessOnline.lastOnline)).getTime()
          }
        ])
      }
      emit({
        type: 'sessionAccessOffline',
        access,
        publicInfo: publicInfo.id,
        lastOnline: new Date()
      })
    }
  }
})

definition.trigger({
  name: "userAccessOnline",
  properties: {
  },
  async execute({ user, parameters: [toType, toId]}, context, emit) {
    const access = toType + '_' + toId
    const userAccessOnline = await UserAccessOnline.get(access + '_' + user)
    if(!userAccessOnline || !userAccessOnline.online) {
      const timestamp = Date.now()
      const time = (new Date()).toISOString()
      ;(await app.connectToAnalytics()).saveEvents([
        {
          type: 'userAccessOnline',
          client: { user },
          toType, toId,
          timestamp, time,
          offlineDuration: (userAccessOnline && userAccessOnline.lastOnline)
              ? Date.now() - (new Date(userAccessOnline.lastOnline)).getTime()
              : undefined
        }
      ])
    }
    emit({
      type: 'userAccessOnline',
      access,
      user,
      lastOnline: new Date()
    })
  }
})
definition.trigger({
  name: "userAccessOffline",
  properties: {
  },
  async execute({ user, parameters: [toType, toId]}, context, emit) {
    const access = toType + '_' + toId
    const userAccessOnline = await UserAccessOnline.get(access + '_' + user)
    if(userAccessOnline && userAccessOnline.online && userAccessOnline.lastOnline) {
      const timestamp = Date.now()
      const time = (new Date()).toISOString()
      ;(await app.connectToAnalytics()).saveEvents([
        {
          type: 'userAccessOffline',
          client: { user },
          toType, toId,
          timestamp, time,
          onlineDuration: Date.now() - (new Date(userAccessOnline.lastOnline)).getTime()
        }
      ])
    }
    emit({
      type: 'userAccessOffline',
      access,
      user,
      lastOnline: new Date()
    })
  }
})

definition.view({
  name: "onlineSessionAccesses",
  properties: {
    toType: {
      type: String,
      validation: ['nonEmpty']
    },
    toId: {
      type: String,
      validation: ['nonEmpty']
    }
  },
  returns: {
    type: Array,
    of: {
      type: PublicSessionInfo
    }
  },
  access: ({ toType, toId }, context) =>
      checkIfRole(toType, toId, ['reader', 'speaker', 'vip', 'moderator', 'owner'], context),
  async daoPath({ toType, toId }, { client, service }) {
    return ['database', 'query', app.databaseName, `(${
        async function(input, output, { onlineAccessIndex, prefix }) {
          const index = await input.index(onlineAccessIndex)
          function mapper(obj) {
            return obj && { id: obj.publicInfo }
          }
          await index.range({
            gte: prefix,
            lte: prefix+"\xFF\xFF\xFF\xFF"
          }).onChange(async (obj, oldObj) => {
            output.change(mapper(obj), mapper(oldObj))
          })
        }
    })`, {
      onlineAccessIndex: SessionAccessOnline.tableName + '_online',
      prefix: `${toType}_${toId}_`
    }]
  }
})

definition.view({
  name: "onlineUserAccesses",
  properties: {
    toType: {
      type: String,
      validation: ['nonEmpty']
    },
    toId: {
      type: String,
      validation: ['nonEmpty']
    }
  },
  returns: {
    type: Array,
    of: {
      type: PublicSessionInfo
    }
  },
  access: ({ toType, toId }, context) =>
      checkIfRole(toType, toId, ['reader', 'speaker', 'vip', 'moderator', 'owner'], context),
  async daoPath({ toType, toId }, { client, service }) {
    return ['database', 'query', app.databaseName, `(${
        async function(input, output, { onlineAccessIndex, prefix }) {
          const index = await input.index(onlineAccessIndex)
          function mapper(obj) {
            return obj && { id: obj.user }
          }
          await index.range({
            gte: prefix,
            lte: prefix+"\xFF\xFF\xFF\xFF"
          }).onChange(async (obj, oldObj) => {
            output.change(mapper(obj), mapper(oldObj))
          })
        }
    })`, {
      onlineAccessIndex: UserAccessOnline.tableName + "_online",
      prefix: `${toType}_${toId}_`
    }]
  }
})

definition.view({
  name: "sessionAccessOnline",
  properties: {
    access: {
      validation: ['nonEmpty'],
      type: Access
    },
    publicSessionInfo: {
      type: PublicSessionInfo,
      validation: ['nonEmpty']
    }
  },
  returns: {
    type: Object
  },
  async daoPath({ access, publicSessionInfo }, { client, service }) {
    return ['database', 'queryObject', app.databaseName, `(${
        async function(input, output, { id, table }) {
          function mapper(obj) {
            return obj && { ...obj, session: undefined }
          }
          await input.table(table).object(id).onChange((obj, oldObj) => {
            output.change(mapper(obj), mapper(oldObj))
          })
        }
    })`, { table: SessionAccessOnline.tableName, id: access + '_' + publicSessionInfo }]
  }
})

definition.view({
  name: "userAccessOnline",
  properties: {
    access: {
      validation: ['nonEmpty'],
      type: Access
    },
    publicSessionInfo: {
      type: PublicSessionInfo,
      validation: ['nonEmpty']
    }
  },
  returns: {
    type: Object
  },
  async daoPath({ access, user }, { client, service }) {
    return ['database', 'queryObject', app.databaseName, `(${
        async function(input, output, { id, table }) {
          function mapper(obj) {
            return obj && { ...obj, session: undefined }
          }
          await input.table(table).object(id).onChange((obj, oldObj) => {
            output.change(mapper(obj), mapper(oldObj))
          })
        }
    })`, { table: UserAccessOnline.tableName, id: access + '_' + user }]
  }
})

definition.trigger({
  name: "allOffline",
  properties: {
  },
  async execute({ }, context, emit) {
    emit({
      type: "allOffline"
    })
  }
})