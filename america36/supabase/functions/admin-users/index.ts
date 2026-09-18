import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const internalEmail = (username: string) => `${username.trim().toLowerCase()}@america-list.local`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405)

  try {
    const authHeader = req.headers.get('Authorization') || ''
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    if (!token) return json({ error: 'Sessão não encontrada.' }, 401)

    const url = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } })
    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

    const { data: userData, error: userError } = await userClient.auth.getUser()
    if (userError || !userData.user) return json({ error: 'Sessão inválida ou expirada.' }, 401)

    const { data: me, error: meError } = await admin.from('profiles')
      .select('id,username,full_name,role,active')
      .eq('id', userData.user.id).single()
    if (meError || !me || me.role !== 'Administrador' || !me.active)
      return json({ error: 'Acesso restrito ao Administrador.' }, 403)

    const b = await req.json()
    const action = String(b.action || '')

    if (action === 'create_user') {
      const username = String(b.username || '').trim()
      const full_name = String(b.full_name || '').trim()
      const password = String(b.password || '')
      const role = String(b.role || '')
      if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) return json({ error: 'Usuário inválido.' }, 400)
      if (!full_name) return json({ error: 'Informe o nome completo.' }, 400)
      if (password.length < 6) return json({ error: 'A senha deve ter pelo menos 6 caracteres.' }, 400)
      if (!['Motorista', 'Assistência', 'Administrador'].includes(role)) return json({ error: 'Nível de acesso inválido.' }, 400)
      const { data: existing } = await admin.from('profiles').select('id').ilike('username', username).maybeSingle()
      if (existing) return json({ error: 'Este usuário já está cadastrado.' }, 409)

      const { data: created, error: ce } = await admin.auth.admin.createUser({
        email: internalEmail(username), password, email_confirm: true,
        user_metadata: { username, full_name, role }
      })
      if (ce) return json({ error: ce.message }, 400)
      const uid = created.user.id
      const { error: pe } = await admin.from('profiles').insert({ id: uid, username, full_name, role, active: true })
      if (pe) { await admin.auth.admin.deleteUser(uid); return json({ error: pe.message }, 400) }
      if (role === 'Motorista') {
        const { error: de } = await admin.from('drivers').insert({ name: full_name, user_id: uid, active: true })
        if (de) { await admin.from('profiles').delete().eq('id', uid); await admin.auth.admin.deleteUser(uid); return json({ error: de.message }, 400) }
      }
      return json({ id: uid, username, name: full_name, role: role === 'Administrador' ? 'admin' : role === 'Assistência' ? 'assistencia' : 'motorista', active: true })
    }

    const id = String(b.id || '')
    if (!id) return json({ error: 'Usuário não informado.' }, 400)
    if (id === userData.user.id && action === 'delete_user') return json({ error: 'Você não pode excluir a própria conta.' }, 400)

    if (action === 'update_user') {
      const username = String(b.username || '').trim()
      const full_name = String(b.full_name || '').trim()
      const role = String(b.role || '')
      const password = String(b.password || '')
      if (!username || !full_name || !['Motorista','Assistência','Administrador'].includes(role)) return json({ error: 'Dados inválidos.' }, 400)
      const { data: dup } = await admin.from('profiles').select('id').ilike('username', username).neq('id', id).maybeSingle()
      if (dup) return json({ error: 'Este usuário já está cadastrado.' }, 409)
      const { error: ue } = await admin.auth.admin.updateUserById(id, { ...(password ? { password } : {}), user_metadata: { username, full_name, role } })
      if (ue) return json({ error: ue.message }, 400)
      const { error: pe } = await admin.from('profiles').update({ username, full_name, role }).eq('id', id)
      if (pe) return json({ error: pe.message }, 400)
      if (role === 'Motorista') {
        const { data: d } = await admin.from('drivers').select('id').eq('user_id', id).maybeSingle()
        if (!d) await admin.from('drivers').insert({ name: full_name, user_id: id, active: true })
        else await admin.from('drivers').update({ name: full_name, active: true }).eq('id', d.id)
      } else {
        await admin.from('drivers').update({ active: false }).eq('user_id', id)
      }
      return json({ ok: true })
    }

    if (action === 'delete_user') {
      const { data: d } = await admin.from('drivers').select('id').eq('user_id', id).maybeSingle()
      if (d) {
        const { count } = await admin.from('service_orders').select('id', { count: 'exact', head: true }).eq('driver_id', d.id)
        if ((count || 0) > 0) await admin.from('drivers').update({ active: false, user_id: null }).eq('id', d.id)
        else await admin.from('drivers').delete().eq('id', d.id)
      }
      await admin.from('profiles').delete().eq('id', id)
      const { error: de } = await admin.auth.admin.deleteUser(id)
      if (de) return json({ error: de.message }, 400)
      return json({ ok: true })
    }
    return json({ error: 'Ação inválida.' }, 400)
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Erro interno.' }, 500)
  }
})
