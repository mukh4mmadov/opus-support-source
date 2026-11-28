import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { authEmail, type UserStore } from './admin-users.ts'

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })

export function supabaseStore(
  admin: SupabaseClient,
  caller: SupabaseClient,
  actorId: string,
): UserStore {
  return {
    async loginExists(login) {
      const { data } = await admin.from('profiles').select('id').eq('login', login).maybeSingle()
      return data !== null
    },
    async findPeople(role, birthYear) {
      const query = admin.from('profiles').select('id, login, first_name, last_name, is_active').eq('role', role)
      const { data, error } = await (birthYear === null ? query.is('birth_year', null) : query.eq('birth_year', birthYear))
      if (error) throw new Error(error.message)
      return data ?? []
    },
    async createUser(email, password, profile) {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      })
      if (error) throw new Error(error.message)
      const id = data.user.id
      const { error: insertError } = await admin.from('profiles').insert({
        id,
        role: profile.role,
        login: profile.login,
        first_name: profile.first_name,
        last_name: profile.last_name,
        birth_year: profile.birth_year,
        bio: profile.bio,
      })
      if (insertError) {
        await admin.auth.admin.deleteUser(id)
        throw new Error(insertError.message)
      }
      return id
    },
    async setPassword(userId, password) {
      const { error } = await admin.auth.admin.updateUserById(userId, { password })
      if (error) throw new Error(error.message)
    },
    async loginOf(userId) {
      const { data } = await admin.from('profiles').select('login').eq('id', userId).maybeSingle()
      return data?.login ?? null
    },
    async roleOf(userId) {
      const { data } = await admin.from('profiles').select('role').eq('id', userId).maybeSingle()
      return data?.role ?? null
    },
    async isActive(userId) {
      const { data } = await admin.from('profiles').select('is_active').eq('id', userId).maybeSingle()
      return data?.is_active === true
    },
    async changeLogin(userId, login) {
      const { error } = await admin.auth.admin.updateUserById(userId, {
        email: authEmail(login),
        email_confirm: true,
      })
      if (error) throw new Error(error.message)
      const { error: profileError } = await admin.from('profiles').update({ login }).eq('id', userId)
      if (profileError) throw new Error(profileError.message)
    },
    async sessionToken(userId) {
      const { data: found, error } = await admin.auth.admin.getUserById(userId)
      if (error) throw new Error(error.message)
      const { data, error: linkError } = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email: found.user.email!,
      })
      if (linkError) throw new Error(linkError.message)
      return data.properties.hashed_token
    },
    async releaseUser(userId) {
      const { error } = await caller.rpc('admin_release_user', { p_user: userId })
      if (error) throw new Error(error.message)
    },
    async deleteUser(userId) {
      const { error } = await admin.auth.admin.deleteUser(userId)
      if (error) throw new Error(error.message)
    },
    async savePasswordCopy(userId, ciphertext) {
      const { error } = await admin.from('account_passwords').upsert({
        user_id: userId,
        ciphertext,
        updated_at: new Date().toISOString(),
      })
      if (error) throw new Error(error.message)
    },
    async readPasswordCopy(userId) {
      const { data } = await admin
        .from('account_passwords')
        .select('ciphertext')
        .eq('user_id', userId)
        .maybeSingle()
      return data?.ciphertext ?? null
    },
    async requirePasswordChange(userId) {
      const { error } = await admin.from('profiles').update({ must_change_password: true }).eq('id', userId)
      if (error) throw new Error(error.message)
    },
    async mustChangePassword(userId) {
      const { data } = await admin.from('profiles').select('must_change_password').eq('id', userId).maybeSingle()
      return data?.must_change_password === true
    },
    async markPasswordChanged(userId) {
      const { error } = await admin.rpc('record_password_change', { p_user: userId })
      if (error) throw new Error(error.message)
    },
    async audit(action, entityId, details) {
      await admin.from('audit_log').insert({
        actor_id: actorId,
        action,
        entity: 'user',
        entity_id: entityId,
        details,
      })
    },
  }
}
