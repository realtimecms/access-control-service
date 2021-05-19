const app = require("@live-change/framework").app()
const { combineRoles } = require('../config/roles.js')


function access(definition) {

  const Membership = definition.foreignModel('members', 'Membership')
  const Access = definition.foreignModel('accessControl', 'Access')
  const SessionAccess = definition.foreignModel('accessControl', 'SessionAccess')
  const PublicSessionInfo = definition.foreignModel('accessControl', 'PublicSessionInfo')

  async function getAccess(type, id, client) {
    if(!client) throw new Error("client parameter required")
    const access = await Access.indexObjectGet('byTo', [type, id])
    const membership = client.user
        && await Membership.indexObjectGet( 'membership', [client.user, type, id])
    const sessionAccess = access && await SessionAccess.indexObjectGet(
        'bySessionAccess', [client.sessionId, access.id])
    return { membership, access, sessionAccess, user: client.user }
  }

  function getRole({ membership, access, sessionAccess, user }) {
    let role = combineRoles(access.publicGuestAccessRole, sessionAccess && sessionAccess.role)
    if(user) {
      role = combineRoles(role, access.publicUserAccessRole)
      role = combineRoles(role, membership && membership.role)
      if(user.roles) for(const userRole of user.roles) role = combineRoles(role, userRole)
    }
    return role
  }

  function hasRole(accessData, roles) {
    const role = getRole(accessData)
    return roles.indexOf(role) != -1
  }

  async function checkIfRole(toType, toId, roles, { client, visibilityTest }) {
    if(visibilityTest) return true
    console.log("CHECK IF ROLE", toType, toId, roles, { client, visibilityTest })
    const access = await getAccess(toType, toId, client)
    const allowed = hasRole(access, roles)
    return allowed
  }

  async function getPublicInfo(session) {
    if(!app) throw new Error("app parameter required")
    if(!session) throw new Error("session parameter required")
    let publicInfo = await PublicSessionInfo.indexObjectGet('bySession', session)
    if(!publicInfo) {
      publicInfo = await app.triggerService('accessControl', {
        type: "getOrCreateSessionPublicInfo",
        session: session
      })
    }
    return publicInfo
  }

  /*function hasRole({ membership, access, sessionAccess, user }, roles) {
    if(user) {
      if(roles.indexOf(access.publicUserAccessRole) != -1) return true
      if(membership && roles.indexOf(membership.role) != -1) return true
    }
    if(roles.indexOf(access.publicGuestAccessRole) != -1) return true
    if(sessionAccess && roles.indexOf(sessionAccess.role) != -1) return true
    return false
  }*/

  return { getAccess, hasRole, checkIfRole, getPublicInfo, Access, SessionAccess, PublicSessionInfo, Membership }
}

module.exports = access
