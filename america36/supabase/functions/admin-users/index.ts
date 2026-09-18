import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const adminClient = createClient(supabaseUrl, serviceRole, { auth: { autoRefreshToken: false, persistSession: false } });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

function internalEmail(username: string) {
  return `${username.trim().toLowerCase()}@america-list.local`;
}

async function requireAdmin(req: Request) {
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return { error: 'Sessão não encontrada.' };
  const token = auth.slice(7);
  const { data: userData, error: userError } = await adminClient.auth.getUser(token);
  if (userError || !userData.user) return { error: 'Sessão inválida ou expirada.' };
  const { data: profile, error: profileError } = await adminClient
    .from('profiles').select('id,username,full_name,role,active').eq('id', userData.user.id).single();
  if (profileError || !profile || !profile.active || profile.role !== 'Administrador') {
    return { error: 'Acesso restrito ao Administrador.' };
  }
  return { user: userData.user, profile };
}

async function createUser(body: any) {
  const username = String(body.username || '').trim();
  const full_name = String(body.full_name || '').trim();
  const password = String(body.password || '');
  const role = String(body.role || '');
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) throw new Error('Usuário inválido. Use 3 a 40 caracteres: letras, números, ponto, hífen ou sublinhado.');
  if (!full_name) throw new Error('Informe o nome completo.');
  if (password.length < 6) throw new Error('A senha deve ter pelo menos 6 caracteres.');
  if (!['Motorista', 'Assistência', 'Administrador'].includes(role)) throw new Error('Nível de acesso inválido.');

  const { data: existing } = await adminClient.from('profiles').select('id').ilike('username', username).maybeSingle();
  if (existing) throw new Error('Este usuário já está cadastrado.');

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email: internalEmail(username), password, email_confirm: true,
    user_metadata: { username, full_name, role }
  });
  if (createError) throw new Error(createError.message);
  const userId = created.user.id;

  const { error: profileError } = await adminClient.from('profiles').insert({ id: userId, username, full_name, role, active: true });
  if (profileError) {
    await adminClient.auth.admin.deleteUser(userId);
    throw new Error(profileError.message);
  }

  if (role === 'Motorista') {
    const { error: driverError } = await adminClient.from('drivers').insert({ name: full_name, user_id: userId, active: true });
    if (driverError) {
      await adminClient.from('profiles').delete().eq('id', userId);
      await adminClient.auth.admin.deleteUser(userId);
      throw new Error(driverError.message);
    }
  }
  return { id: userId, username, full_name, role, active: true };
}

async function updateUser(body: any, actorId: string) {
  const id = String(body.id || '');
  const username = String(body.username || '').trim();
  const full_name = String(body.full_name || '').trim();
  const role = String(body.role || '');
  const password = body.password == null ? '' : String(body.password);
  if (!id || !full_name || !/^[A-Za-z0-9._-]{3,40}$/.test(username)) throw new Error('Nome ou usuário inválido.');
  if (!['Motorista', 'Assistência', 'Administrador'].includes(role)) throw new Error('Nível de acesso inválido.');
  if (password && password.length < 6) throw new Error('A senha deve ter pelo menos 6 caracteres.');
  if (id === actorId && role !== 'Administrador') throw new Error('O administrador atual não pode remover o próprio nível de Administrador.');

  const { data: oldProfile, error: oldError } = await adminClient.from('profiles').select('id,username,full_name,role,active').eq('id', id).single();
  if (oldError || !oldProfile) throw new Error('Usuário não encontrado.');
  const { data: conflict } = await adminClient.from('profiles').select('id').ilike('username', username).neq('id', id).maybeSingle();
  if (conflict) throw new Error('Este usuário já está cadastrado.');

  const { error: profileError } = await adminClient.from('profiles').update({ username, full_name, role, active: true }).eq('id', id);
  if (profileError) throw new Error(profileError.message);

  const authPatch: any = { email: internalEmail(username), user_metadata: { username, full_name, role } };
  if (password) authPatch.password = password;
  const { error: authError } = await adminClient.auth.admin.updateUserById(id, authPatch);
  if (authError) throw new Error(authError.message);

  const { data: driver } = await adminClient.from('drivers').select('id').eq('user_id', id).maybeSingle();
  if (role === 'Motorista') {
    if (!driver) await adminClient.from('drivers').insert({ name: full_name, user_id: id, active: true });
    else await adminClient.from('drivers').update({ name: full_name, active: true }).eq('id', driver.id);
  } else if (driver) {
    await adminClient.from('drivers').update({ active: false }).eq('id', driver.id);
  }
  const { data: updated, error: updatedError } = await adminClient.from('profiles').select('id,username,full_name,role,active').eq('id', id).single();
  if (updatedError) throw new Error(updatedError.message);
  return { ok: true, user: updated };
}

async function deleteUser(body: any, actorId: string) {
  const id = String(body.id || '');
  if (!id) throw new Error('Usuário inválido.');
  if (id === actorId) throw new Error('Você não pode excluir a própria conta.');
  const { data: driver } = await adminClient.from('drivers').select('id').eq('user_id', id).maybeSingle();
  if (driver) {
    const { count, error } = await adminClient.from('service_orders').select('id', { count: 'exact', head: true }).eq('driver_id', driver.id);
    if (error) throw new Error(error.message);
    if ((count || 0) > 0) await adminClient.from('drivers').update({ active: false, user_id: null }).eq('id', driver.id);
    else await adminClient.from('drivers').delete().eq('id', driver.id);
  }
  const { error } = await adminClient.auth.admin.deleteUser(id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

async function createDriver(body: any) {
  const name = String(body.name || '').trim();
  const username = String(body.username || '').trim();
  if (!name) throw new Error('Informe o nome do motorista.');
  let user_id: string | null = null;
  if (username) {
    const { data: p, error } = await adminClient.from('profiles').select('id,role,active').ilike('username', username).maybeSingle();
    if (error) throw new Error(error.message);
    if (!p) throw new Error('Usuário vinculado não encontrado.');
    if (p.role !== 'Motorista') throw new Error('O usuário vinculado precisa ter nível Motorista.');
    if (!p.active) throw new Error('O usuário vinculado está inativo.');
    user_id = p.id;
    const { data: existing } = await adminClient.from('drivers').select('id').eq('user_id', user_id).maybeSingle();
    if (existing) throw new Error('Este usuário já possui um cadastro de motorista.');
  }
  const { data, error } = await adminClient.from('drivers').insert({ name, user_id, active: true }).select('id,user_id,name,active').single();
  if (error) throw new Error(error.message);
  return data;
}

async function updateDriver(body: any) {
  const id = String(body.id || '');
  const name = String(body.name || '').trim();
  const username = String(body.username || '').trim();
  if (!id || !name) throw new Error('Informe o nome do motorista.');
  let user_id: string | null = null;
  if (username) {
    const { data: p, error } = await adminClient.from('profiles').select('id,role,active').ilike('username', username).maybeSingle();
    if (error) throw new Error(error.message);
    if (!p) throw new Error('Usuário vinculado não encontrado.');
    if (p.role !== 'Motorista') throw new Error('O usuário vinculado precisa ter nível Motorista.');
    user_id = p.id;
  }
  const { data, error } = await adminClient.from('drivers').update({ name, user_id }).eq('id', id).select('id,user_id,name,active').single();
  if (error) throw new Error(error.message);
  return data;
}

async function deleteDriver(body: any) {
  const id = String(body.id || '');
  const { count, error: ce } = await adminClient.from('service_orders').select('id', { count: 'exact', head: true }).eq('driver_id', id);
  if (ce) throw new Error(ce.message);
  if ((count || 0) > 0) throw new Error('Este motorista possui O.S. vinculadas e não pode ser excluído. Para preservar o histórico, inative o cadastro.');
  const { error } = await adminClient.from('drivers').delete().eq('id', id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  try {
    const auth = await requireAdmin(req);
    if ('error' in auth) return json({ error: auth.error }, 403);
    const body = await req.json();
    const action = String(body.action || '');
    if (action === 'create_user') return json(await createUser(body), 201);
    if (action === 'update_user') return json(await updateUser(body, auth.user.id));
    if (action === 'delete_user') return json(await deleteUser(body, auth.user.id));
    if (action === 'create_driver') return json(await createDriver(body), 201);
    if (action === 'update_driver') return json(await updateDriver(body));
    if (action === 'delete_driver') return json(await deleteDriver(body));
    return json({ error: 'Ação administrativa desconhecida.' }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});
