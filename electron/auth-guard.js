/**
 * auth-guard.js — server-side role-hierarchy enforcement for privileged IPCs.
 *
 * Every sensitive mutation in main.js runs its args through a `requires`
 * predicate defined here. Denials return { ok:false, error } AND append a
 * `permission_denied` row to activity_log so owners see rogue attempts in
 * the Actividad feed.
 *
 * Client-side guards (Admin.jsx etc.) are UX only — this file is the real
 * security boundary. Never trust the renderer.
 */

const ROLE_LEVEL = Object.freeze({
  owner: 100, cfo: 70, accountant: 60, manager: 50, cashier: 10, none: 0,
})

/** Strict-greater: a user can only act on subordinates below their own level. */
function canActOn(actorRole, targetRole) {
  return (ROLE_LEVEL[actorRole] ?? 0) > (ROLE_LEVEL[targetRole] ?? 0)
}

/** Actor must have role-level at least X to perform the op. */
function actorAtLeast(actor, threshold) {
  return (ROLE_LEVEL[actor?.role] ?? 0) >= threshold
}

/** Resolve a target user row by local id from the SQLite users table. */
function fetchUser(db, id) {
  try {
    const row = db.rawPrepare('SELECT id, name, username, role FROM users WHERE id=?').get(id)
    return row || null
  } catch { return null }
}

function fetchEmpleado(db, id) {
  try {
    const row = db.rawPrepare('SELECT id, nombre, role FROM empleados WHERE id=?').get(id)
    return row || null
  } catch { return null }
}

function fetchService(db, id) {
  try {
    const row = db.rawPrepare('SELECT id, name FROM services WHERE id=?').get(id)
    return row || null
  } catch { return null }
}

/** Log a denial to activity_log. Always wrap in try so it never masks the real error. */
function logDenied(db, { actor, attempted_op, target_type, target_id, target_name, reason }) {
  try {
    db.activityLogRecord({
      event_type: 'permission_denied',
      severity: 'warn',
      actor_user_id: actor?.id || null,
      actor_name:    actor?.name || null,
      actor_role:    actor?.role || null,
      target_type:   target_type || null,
      target_id:     target_id != null ? String(target_id) : null,
      target_name:   target_name || null,
      reason:        reason || 'permission denied',
      metadata:      { attempted_op },
    })
  } catch {}
}

// ── Guard predicates — each returns either null (allow) or a string reason (deny) ──
// Every predicate also takes the db module so it can look up the target row.

/** users:update — self-edit of pin/name/username ok; role/active self-change blocked. */
function guardUserUpdate(db, actor, patch) {
  if (!actor) return 'No hay usuario activo'
  const targetId = patch?.id
  const target = targetId != null ? fetchUser(db, targetId) : null
  if (!target) return 'Usuario no encontrado'
  const self = actor.id === target.id
  const changingRole   = 'role'   in patch && patch.role   !== target.role
  const changingActive = 'active' in patch && Number(patch.active) !== 1 // deactivating self
  if (self) {
    if (changingRole)   return 'No puedes cambiar tu propio rol'
    if (changingActive) return 'No puedes desactivar tu propia cuenta'
    return null
  }
  if (!canActOn(actor.role, target.role)) return 'No tienes permiso para editar este usuario'
  // Promoting to a role >= actor's own level requires owner
  if (patch.role && (ROLE_LEVEL[patch.role] ?? 0) >= (ROLE_LEVEL[actor.role] ?? 0) && actor.role !== 'owner') {
    return 'Solo el propietario puede asignar este rol'
  }
  return null
}

function guardUserDelete(db, actor, { id } = {}) {
  if (!actor) return 'No hay usuario activo'
  if (actor.id === id) return 'No puedes eliminar tu propia cuenta'
  const target = fetchUser(db, id)
  if (!target) return 'Usuario no encontrado'
  if (!canActOn(actor.role, target.role)) return 'No tienes permiso para eliminar este usuario'
  return null
}

function guardUserCreate(db, actor, data) {
  // v2.3.12 — allow during FirstTimeSetup bootstrap. When `actor` is null
  // nobody has logged in yet, which only happens during the reconnect wizard
  // (every post-login call site has an actor). The wizard pulls staff rows
  // from Supabase and upserts them locally. Once an actor exists, enforce
  // owner/manager role as before.
  if (!actor) return null
  if (!['owner', 'manager'].includes(actor.role)) return 'Solo owner/manager pueden crear usuarios'
  const newRole = data?.role
  if (newRole && (ROLE_LEVEL[newRole] ?? 0) >= (ROLE_LEVEL[actor.role] ?? 0) && actor.role !== 'owner') {
    return 'Solo el propietario puede asignar este rol'
  }
  return null
}

function guardOwnerOnly(_db, actor, _args, op) {
  if (!actor) return 'No hay usuario activo'
  if (actor.role !== 'owner') return `Solo el propietario puede ejecutar ${op}`
  return null
}

function guardOwnerOrManager(_db, actor, _args, op) {
  if (!actor) return 'No hay usuario activo'
  if (!['owner', 'manager'].includes(actor.role)) return `Solo owner/manager pueden ejecutar ${op}`
  return null
}

// Build target context (name + id) for logging — best-effort.
function userTargetCtx(db, id) {
  const t = fetchUser(db, id); if (!t) return { target_type: 'user', target_id: id, target_name: null }
  return { target_type: 'user', target_id: id, target_name: `${t.name} (@${t.username})` }
}
function empleadoTargetCtx(db, id) {
  const t = fetchEmpleado(db, id); if (!t) return { target_type: 'empleado', target_id: id, target_name: null }
  return { target_type: 'empleado', target_id: id, target_name: t.nombre }
}
function serviceTargetCtx(db, id) {
  const t = fetchService(db, id); if (!t) return { target_type: 'service', target_id: id, target_name: null }
  return { target_type: 'service', target_id: id, target_name: t.name }
}

const macStore = require('./mac-store')

/**
 * guardMac(action) — returns a `requires:` predicate that enforces a valid
 * Manager Authorization Card jti on the incoming call. The renderer obtains
 * the jti via `mac:issue` AFTER scanning a valid card; it's one-time use and
 * bound to (action, target_id). Fails closed — missing / expired / wrong
 * action = 403.
 *
 * Exception: if actor.role === 'owner', MAC is waived (the owner can always
 * authorize themselves). Keeps the owner from needing their own card to
 * void a test ticket.
 */
function guardMac(action, extractTargetId = () => null) {
  return ({ actor, args }) => {
    if (actor?.role === 'owner') return null
    const payload = args[0] || {}
    const jti = payload.mac_jti || payload.macJti || null
    if (!jti) return 'Esta acción requiere la Tarjeta de Autorización del gerente'
    const target_id = extractTargetId(args)
    const ok = macStore.consume(jti, action, target_id)
    if (!ok) {
      const peek = macStore.peek(jti)
      if (!peek) return 'Autorización inválida o expirada — vuelve a escanear'
      return 'Autorización no corresponde a esta acción'
    }
    return null
  }
}

module.exports = {
  ROLE_LEVEL, canActOn, actorAtLeast,
  fetchUser, fetchEmpleado, fetchService,
  logDenied,
  guardUserUpdate, guardUserDelete, guardUserCreate,
  guardOwnerOnly, guardOwnerOrManager,
  userTargetCtx, empleadoTargetCtx, serviceTargetCtx,
  guardMac, macStore,
}
