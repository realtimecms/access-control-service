const app = require("@live-change/framework").app()
const definition = require('./definition.js')
const { combineRoles, rolesCombiner, roleLevels } = require('../config/roles.js')

const { getAccess, hasRole, checkIfRole, getPublicInfo } =
    require("../access-control-service/access.js")(definition)

const { Access, PublicSessionInfo, SessionAccess, Session, User, Membership } = require('./model.js')

require('./online.js')

definition.trigger({
  name: "getOrCreateSessionPublicInfo",
  properties: {
    session: {
      type: Session,
      validation: ['nonEmpty']
    }
  },
  queuedBy: ['session'],
  async execute({ session }, { client, service }, emit) {
    let publicInfo = await PublicSessionInfo.indexObjectGet('bySession', session)
    if(!publicInfo) {
      publicInfo = {
        id: app.generateUid(),
        session,
        //online: true
      }
      await PublicSessionInfo.create(publicInfo)
      emit({
        type: "publicSessionInfoCreated",
        publicSessionInfo: publicInfo.id,
        session
      })
    }
    return publicInfo
  }
})

definition.view({
  name: "sessionAccesses",
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
      async function(input, output, { sessionAccessTableName, prefix }) {
        const table = input.table(sessionAccessTableName)
        function mapper(obj) {
          return obj && obj.publicInfo && { id: obj.publicInfo }
        }
        await table.range({
          gte: prefix,
          lte: prefix+"\xFF\xFF\xFF\xFF"
        }).onChange(async (obj, oldObj) => {
          output.change(mapper(obj), mapper(oldObj))
        })
      }
    })`, {
      sessionAccessTableName: SessionAccess.tableName,
      prefix: `${toType}_${toId}_`
    }]
  }
})

definition.view({
  name: "publicSessionInfo",
  properties: {
    publicSessionInfo: {
      type: PublicSessionInfo,
      validation: ['nonEmpty']
    }
  },
  returns: {
    type: Object
  },
  async daoPath({ publicSessionInfo }, { client, service }) {
    return ['database', 'queryObject', app.databaseName, `(${
        async function(input, output, { id, table }) {
          function mapper(obj) {
            return obj && { ...obj, session: undefined }
          }
          await input.table(table).object(id).onChange((obj, oldObj) => {
            output.change(mapper(obj), mapper(oldObj))
          })
        }
    })`, { table: PublicSessionInfo.tableName, id: publicSessionInfo }]
  }
})

definition.view({
  name: "myPublicSessionInfo",
  properties: {
  },
  returns: {
    type: Object
  },
  async daoPath({ }, { client, service }) {
    const publicSessionInfo = await getPublicInfo(client.sessionId)
    return ['database', 'queryObject', app.databaseName, `(${
        async function(input, output, { id, table }) {
          function mapper(obj) {
            return obj && { ...obj, session: undefined }
          }
          await input.table(table).object(id).onChange((obj, oldObj) => {
            output.change(mapper(obj), mapper(oldObj))
          })
        }
    })`, { table: PublicSessionInfo.tableName, id: publicSessionInfo.id }]
  }
})


definition.view({
  name: "myStatus",
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
    type: Object
  },
  async daoPath({ toType, toId }, { client, service }) {
    if(client.user) {
      return ['database', 'queryObject', app.databaseName, `(${
          async function(input, output,
                         { toType, toId, session, user, userRoles,
                           accessTableName, membershipTableName, sessionAccessTableName,
                           rolesCombiner, roleLevels }) {
            const accessTable = input.table(accessTableName)
            const membershipTable = input.table(membershipTableName)
            const sessionAccessTable = input.table(sessionAccessTableName)

            const accessObject = accessTable.object(toType + '_' + toId)
            const membershipObject = membershipTable.object(user + '_' + toType + '_' + toId)
            const sessionAccessObject = sessionAccessTable.object(toType + '_' + toId + '_' + session)

            const combineRoles = eval(rolesCombiner)

            function computeStatus(access, membership, sessionAccess) {
              let role = combineRoles(access && access.publicGuestAccessRole, sessionAccess && sessionAccess.role)
              role = combineRoles(role, access.publicUserAccessRole)
              role = combineRoles(role, membership && membership.role)
              for(const userRole of userRoles) role = combineRoles(role, userRole)
              return {
                role,
                joined: !!(membership || sessionAccess),
                level: roleLevels[role],
                canJoin: !!(access.publicGuestAccessRole || access.publicUserAccessRole)
              }
            }
            
            function refresh() {
              const newStatus = computeStatus(access, membership, sessionAccess)
              if(JSON.stringify(newStatus) != JSON.stringify(status)) {
                output.change({ id: 'role', ...newStatus }, { id: 'role', ...status })
                status = newStatus
              }
            }
            
            let [access, membership, sessionAccess] = await Promise.all([
                accessObject.get(), membershipObject.get(), sessionAccessObject.get() 
            ])
            
            let status = computeStatus(access, membership, sessionAccess)
            output.change({ id: 'role', ...status }, null)

            accessObject.onChange((obj, oldObj) => {
              access = obj
              refresh()
            })
            membershipObject.onChange((obj, oldObj) => {
              membership = obj
              refresh()
            })
            sessionAccessObject.onChange((obj, oldObj) => {
              sessionAccess = obj
              refresh()
            })
          }
      })`, {
        toType, toId, session: client.sessionId, user: client.user, userRoles: client.roles || [],
        sessionTableName: Session.tableName,
        accessTableName: Access.tableName,
        membershipTableName: Membership.tableName,
        sessionAccessTableName: SessionAccess.tableName,
        rolesCombiner, roleLevels
      }]
    } else {
      const path = ['database', 'queryObject', app.databaseName, `(${
          async function(input, output,
                         { toType, toId, session, userRoles,
                           accessTableName, sessionAccessTableName,
                           rolesCombiner, roleLevels }) {
            const accessTable = input.table(accessTableName)
            const sessionAccessTable = input.table(sessionAccessTableName)

            const accessObject = accessTable.object(toType + '_' + toId)
            const sessionAccessObject = sessionAccessTable.object(toType + '_' + toId + '_' + session)

            const combineRoles = eval(rolesCombiner)

            function computeStatus(access, sessionAccess) {
              let role = combineRoles(access && access.publicGuestAccessRole, sessionAccess && sessionAccess.role)
              for(const userRole of userRoles) role = combineRoles(role, userRole)
              return {
                role,
                joined: !!sessionAccess,
                level: roleLevels[role],
                canJoin: !!access.publicGuestAccessRole
              }
            }

            function refresh() {
              const newStatus = computeStatus(access, sessionAccess)
              if(JSON.stringify(newStatus) != JSON.stringify(status)) {
                output.change({ id: 'role', ...newStatus }, { id: 'role', ...status })
                status = newStatus
              }
            }

            let [access, sessionAccess] = await Promise.all([
              accessObject.get(), sessionAccessObject.get()
            ])

            let status = computeStatus(access, sessionAccess)
            output.change({ id: 'role', ...status }, null)

            accessObject.onChange((obj, oldObj) => {
              access = obj
              refresh()
            })
            sessionAccessObject.onChange((obj, oldObj) => {
              sessionAccess = obj
              refresh()
            })
          }
      })`,{
        toType, toId, session: client.sessionId, userRoles: client.roles || [],
        sessionTableName: Session.tableName,
        accessTableName: Access.tableName,
        sessionAccessTableName: SessionAccess.tableName,
        rolesCombiner, roleLevels
      }]
      return path
    }

  }
})


definition.trigger({
  name: "createAccess",
  properties: {
    toType: {
      type: String,
      validation: ['nonEmpty']
    },
    toId: {
      type: String,
      validation: ['nonEmpty']
    },
    users: {
      type: Array,
      of: {
        type: Object,
        properties: {
          user: {
            type: User,
            validation: ['nonEmpty']
          },
          role: {
            type: String,
            validation: ['nonEmpty']
          }
        }
      }
    },
    sessions: {
      type: Array,
      of: {
        type: Object,
        properties: {
          session: {
            type: Session,
            validation: ['nonEmpty']
          },
          role: {
            type: String,
            validation: ['nonEmpty']
          }
        }
      }
    },
    publicUserAccessRole: {
      type: String
    },
    publicGuestAccessRole: {
      type: String
    }
  },
  async execute({ toType, toId, users, sessions, publicUserAccessRole, publicGuestAccessRole },
                { client, service }, emit) {
    emit({
      type: 'accessCreated',
      toType, toId, publicUserAccessRole, publicGuestAccessRole
    })
    for(let user of users) {
      emit('members', {
        type: 'membershipAdded',
        listType: toType,
        list: toId,
        role: user.role,
        user: user.user
      })
    }
    let promises = []
    for(let session of sessions) {
      promises.push((async (session) => {
        const publicInfo = await getPublicInfo(session.session)
        emit({
          type: 'sessionAccessAdded',
          toType: toType,
          toId: toId,
          role: session.role,
          session: session.session,
          publicInfo: publicInfo.id
        })
      })(session))
    }
    await Promise.all(promises)
    return 'ok'
  }
})

definition.action({
  name: "join",
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
  access: (params, { client }) => true,//!!client.user,
  async execute({ toType, toId }, { client, service }, emit) {
    const accessInfo = await getAccess(toType, toId, client)
    if(accessInfo.sessionAccess || accessInfo.membership) throw new Error("alreadyJoined")
    const access = accessInfo.access
    if(!access) throw new Error("notFound")
    const entryRole = client.user
        ? (access.publicUserAccessRole || access.publicGuestAccessRole)
        : access.publicGuestAccessRole
    if(!entryRole) throw new Error("accessDenied")
    if(client.user) {
      emit('members', {
        type: 'membershipAdded',
        listType: toType,
        list: toId,
        role: entryRole,
        user: client.user
      })
    } else {
      const session = client.sessionId
      const publicInfo = await getPublicInfo(session)
      emit({
        type: 'sessionAccessAdded',
        toType,
        toId,
        role: entryRole,
        session: client.sessionId,
        publicInfo: publicInfo.id
      })
    }
  }
})

definition.action({
  name: 'sendJoinRequest',
  properties: {
    toType: {
      type: String,
      validation: ['nonEmpty']
    },
    toId: {
      type: String,
      validation: ['nonEmpty']
    },
    lang: {
      type: String,
      validation: ['nonEmpty']
    }
  },
  async execute({ toType, toId }, { client, service }, emit) {
    const accessInfo = await getAccess(toType, toId, client)
    if(accessInfo.sessionAccess || accessInfo.membership) throw new Error("alreadyJoined")
    const access = accessInfo.access
    if(!access) throw new Error("notFound")

    if(client.user) {
      const from = client.user
      let joinRequest = await service.triggerService('members', {
        type: 'MemberJoinRequest',
        from,
        listType: toType,
        list: toId
      })
      return joinRequest
    } else {
      /// Anonymous requests?
      throw new Error("accessDenied")
    }
  }
})

definition.action({
  name: "leave",
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
  access: (params, { client }) => true,//!!client.user,
  async execute({ toType, toId }, { client, service }, emit) {
    const accessInfo = await getAccess(toType, toId, client)
    if(!(accessInfo.sessionAccess || accessInfo.membership)) throw new Error("notMember")
    const access = accessInfo.access
    if(!access) throw new Error("notFound")
    const membership = accessInfo.membership
    if(membership) {
      emit('members', {
        type: 'membershipRemoved',
        membership: membership.id
      })
    }
    const sessionAccess = accessInfo.sessionAccess
    if(sessionAccess) {
      emit({
        type: 'sessionAccessRemoved',
        listType: toType,
        list: toId,
        session: client.sessionId
      })
    }
  }
})

definition.trigger({
  name: "OnLogin",
  properties: {
    user: {
      type: User
    },
    session: {
      type: Session
    }
  },
  async execute({ user, session }, context, emit) {
    const accesses = await SessionAccess.indexRangeGet('bySession', session)
    let promises = []
    for(const sessionAccess of accesses) {
      promises.push((async (sessionAccess) => {
        const access = await Access.get(sessionAccess.access)
        emit('members', {
          type: 'membershipAdded',
          listType: access.toType,
          list: access.toId,
          role: combineRoles(access.publicUserAccessRole, sessionAccess.role),
          user
        })
        emit({
          type: 'sessionAccessRemoved',
          listType: access.toType,
          list: access.toId,
          session: session
        })
        console.log("REMOVE ACCESS", access)
      })(sessionAccess))
    }
    promises.push((async () => {
      const publicSessionInfo = await getPublicInfo(session)
      emit({
        type: "PublicSessionInfoUpdated",
        publicSessionInfo: publicSessionInfo.id,
        data: {
          user
        }
      })
    })())
    await Promise.all(promises)
    return 'ok'
  }
})

definition.trigger({
  name: "OnLogout",
  properties: {
    user: {
      type: User
    },
    session: {
      type: Session
    }
  },
  async execute({ user, session }, context, emit) {
    const publicSessionInfo = await getPublicInfo(session)
    emit({
      type: "PublicSessionInfoUpdated",
      publicSessionInfo: publicSessionInfo.id,
      data: {
        user: null
      }
    })
    return 'ok'
  }
})

definition.trigger({
  name: "OnRegisterStart",
  properties: {
    user: {
      type: User
    },
    session: {
      type: Session
    }
  },
  async execute({ user, session }, context, emit) {
    const accesses = await SessionAccess.indexRangeGet('bySession', session)
    let promises = []
    for(const sessionAccess of accesses) {
      promises.push((async (sessionAccess) => {
        const access = await Access.get(sessionAccess.access)
        emit('members', {
          type: 'membershipAdded',
          listType: access.toType,
          list: access.toId,
          role: combineRoles(access.publicUserAccessRole, sessionAccess.role),
          user
        })
      })(sessionAccess))
    }
    await Promise.all(promises)
    return 'ok'
  }
})

module.exports = definition

async function start () {
  if(!app.dao) {
    await require('@live-change/server').setupApp({})
    await require('@live-change/elasticsearch-plugin')(app)
  }

  app.processServiceDefinition(definition, [...app.defaultProcessors])
  await app.updateService(definition)//, { force: true })
  const service = await app.startService(definition, { runCommands: true, handleEvents: true })

  /*require("../config/metricsWriter.js")(definition.name, () => ({

  }))*/
}

if (require.main === module) start().catch(error => {
  console.error(error)
  process.exit(1)
})


