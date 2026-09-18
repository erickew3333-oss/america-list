const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const publicDir = __dirname;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zsbfwstbbfuvihcxvnvk.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const adminClient = SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

app.use(express.json({ limit: '2mb' }));

function requireAdmin(req, res, next) {
  if (!adminClient) return res.status(503).json({ error: 'Servidor seguro não configurado. Defina SUPABASE_SERVICE_ROLE_KEY no ambiente do servidor.' });
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Sessão não encontrada.' });
  req.accessToken = token;
  next();
}

async function getAdminProfile(token) {
  const { data: userData, error: userError } = await adminClient.auth.getUser(token);
  if (userError || !userData?.user) return { error: { status: 401, message: 'Sessão inválida ou expirada.' } };
  const { data: profile, error: profileError } = await adminClient
    .from('profiles').select('id,username,full_name,role,active').eq('id', userData.user.id).single();
  if (profileError || !profile || profile.role !== 'Administrador' || !profile.active) {
    return { error: { status: 403, message: 'Acesso restrito ao Administrador.' } };
  }
  return { user: userData.user, profile };
}

function internalEmail(username) {
  const normalized = String(username || '').trim().toLowerCase();
  return `${normalized}@america-list.local`;
}

app.post('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const check = await getAdminProfile(req.accessToken);
    if (check.error) return res.status(check.error.status).json({ error: check.error.message });

    const username = String(req.body.username || '').trim();
    const full_name = String(req.body.full_name || '').trim();
    const password = String(req.body.password || '');
    const role = String(req.body.role || '');

    if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) return res.status(400).json({ error: 'Usuário inválido. Use 3 a 40 caracteres: letras, números, ponto, hífen ou sublinhado.' });
    if (!full_name) return res.status(400).json({ error: 'Informe o nome completo.' });
    if (password.length < 6) return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
    if (!['Motorista', 'Assistência', 'Administrador'].includes(role)) return res.status(400).json({ error: 'Nível de acesso inválido.' });

    const { data: existing } = await adminClient.from('profiles').select('id').ilike('username', username).maybeSingle();
    if (existing) return res.status(409).json({ error: 'Este usuário já está cadastrado.' });

    const email = internalEmail(username);
    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { username, full_name, role }
    });
    if (createError) return res.status(400).json({ error: createError.message });

    const userId = created.user.id;
    const { error: profileError } = await adminClient.from('profiles').insert({
      id: userId, username, full_name, role, active: true
    });
    if (profileError) {
      await adminClient.auth.admin.deleteUser(userId);
      return res.status(400).json({ error: profileError.message });
    }

    if (role === 'Motorista') {
      const { error: driverError } = await adminClient.from('drivers').insert({ name: full_name, user_id: userId, active: true });
      if (driverError) {
        await adminClient.from('profiles').delete().eq('id', userId);
        await adminClient.auth.admin.deleteUser(userId);
        return res.status(400).json({ error: driverError.message });
      }
    }

    return res.status(201).json({ id: userId, username, full_name, role, active: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'Erro interno ao criar usuário.' });
  }
});

app.patch('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const check = await getAdminProfile(req.accessToken);
    if (check.error) return res.status(check.error.status).json({ error: check.error.message });
    const id = req.params.id;
    const username = String(req.body.username || '').trim();
    const full_name = String(req.body.full_name || '').trim();
    const role = String(req.body.role || '');
    const password = req.body.password == null ? '' : String(req.body.password);
    if (!full_name || !/^[A-Za-z0-9._-]{3,40}$/.test(username)) return res.status(400).json({ error: 'Nome ou usuário inválido.' });
    if (!['Motorista', 'Assistência', 'Administrador'].includes(role)) return res.status(400).json({ error: 'Nível de acesso inválido.' });
    if (password && password.length < 6) return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
    if (id === check.user.id && role !== 'Administrador') return res.status(400).json({ error: 'O administrador atual não pode remover o próprio nível de Administrador.' });

    const { data: conflict } = await adminClient.from('profiles').select('id').ilike('username', username).neq('id', id).maybeSingle();
    if (conflict) return res.status(409).json({ error: 'Este usuário já está cadastrado.' });

    const { error: profileError } = await adminClient.from('profiles').update({ username, full_name, role, active: true }).eq('id', id);
    if (profileError) return res.status(400).json({ error: profileError.message });
    if (password) {
      const { error: passError } = await adminClient.auth.admin.updateUserById(id, { password });
      if (passError) return res.status(400).json({ error: passError.message });
    }

    const { data: driver } = await adminClient.from('drivers').select('id').eq('user_id', id).maybeSingle();
    if (role === 'Motorista') {
      if (!driver) await adminClient.from('drivers').insert({ name: full_name, user_id: id, active: true });
      else await adminClient.from('drivers').update({ name: full_name, active: true }).eq('id', driver.id);
    } else if (driver) {
      await adminClient.from('drivers').update({ active: false }).eq('id', driver.id);
    }

    const { data: updatedProfile, error: updatedProfileError } = await adminClient
      .from('profiles')
      .select('id,username,full_name,role,active')
      .eq('id', id)
      .single();
    if (updatedProfileError) return res.status(400).json({ error: updatedProfileError.message });
    return res.json({ ok: true, user: updatedProfile });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'Erro interno ao atualizar usuário.' });
  }
});

app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const check = await getAdminProfile(req.accessToken);
    if (check.error) return res.status(check.error.status).json({ error: check.error.message });
    const id = req.params.id;
    if (id === check.user.id) return res.status(400).json({ error: 'Você não pode excluir a própria conta.' });
    const { data: driver } = await adminClient.from('drivers').select('id').eq('user_id', id).maybeSingle();
    if (driver) {
      const { count } = await adminClient.from('service_orders').select('id', { count: 'exact', head: true }).eq('driver_id', driver.id);
      if ((count || 0) > 0) await adminClient.from('drivers').update({ active: false, user_id: null }).eq('id', driver.id);
      else await adminClient.from('drivers').delete().eq('id', driver.id);
    }
    const { error } = await adminClient.auth.admin.deleteUser(id);
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || 'Erro interno ao excluir usuário.' });
  }
});



// ===== API segura para operações administrativas e O.S. =====
async function getContext(token) {
  if (!adminClient) return { error: { status: 503, message: 'Servidor seguro não configurado. Verifique o .env.' } };
  const { data: ud, error: ue } = await adminClient.auth.getUser(token);
  if (ue || !ud?.user) return { error: { status: 401, message: 'Sessão inválida ou expirada.' } };
  const { data: profile, error: pe } = await adminClient.from('profiles').select('id,username,full_name,role,active').eq('id', ud.user.id).single();
  if (pe || !profile || !profile.active) return { error: { status: 403, message: 'Perfil não encontrado ou inativo.' } };
  return { user: ud.user, profile };
}
function bearer(req){ const h=req.headers.authorization||''; return h.startsWith('Bearer ')?h.slice(7):''; }
async function requireContext(req,res,next){
  const token=bearer(req); if(!token) return res.status(401).json({error:'Sessão não encontrada.'});
  const c=await getContext(token); if(c.error) return res.status(c.error.status).json({error:c.error.message});
  req.ctx=c; next();
}
function adminOnly(req,res){ if(req.ctx.profile.role!=='Administrador'){res.status(403).json({error:'Acesso restrito ao Administrador.'});return false;} return true; }

app.post('/api/drivers', requireContext, async (req,res)=>{
  if(!adminOnly(req,res)) return;
  try {
    const name=String(req.body.name||'').trim(); const username=String(req.body.username||'').trim();
    if(!name) return res.status(400).json({error:'Informe o nome do motorista.'});
    let user_id=null;
    if(username){ const {data:p,error}=await adminClient.from('profiles').select('id,role,active').ilike('username',username).maybeSingle();
      if(error) return res.status(400).json({error:error.message});
      if(!p) return res.status(400).json({error:'Usuário vinculado não encontrado.'});
      if(p.role!=='Motorista') return res.status(400).json({error:'O usuário vinculado precisa ter nível Motorista.'});
      if(!p.active) return res.status(400).json({error:'O usuário vinculado está inativo.'});
      user_id=p.id;
      const {data:existing}=await adminClient.from('drivers').select('id').eq('user_id',user_id).maybeSingle();
      if(existing) return res.status(409).json({error:'Este usuário já possui um cadastro de motorista.'});
    }
    const {data,error}=await adminClient.from('drivers').insert({name,user_id,active:true}).select('id,user_id,name,active').single();
    if(error) return res.status(400).json({error:error.message});
    res.status(201).json(data);
  } catch(e){res.status(500).json({error:e.message||'Erro ao cadastrar motorista.'});}
});
app.patch('/api/drivers/:id', requireContext, async (req,res)=>{
  if(!adminOnly(req,res)) return;
  try {
    const id=req.params.id; const name=String(req.body.name||'').trim(); const username=String(req.body.username||'').trim();
    if(!name) return res.status(400).json({error:'Informe o nome do motorista.'});
    let user_id=null;
    if(username){const {data:p,error}=await adminClient.from('profiles').select('id,role,active').ilike('username',username).maybeSingle(); if(error) return res.status(400).json({error:error.message}); if(!p)return res.status(400).json({error:'Usuário vinculado não encontrado.'}); if(p.role!=='Motorista')return res.status(400).json({error:'O usuário vinculado precisa ter nível Motorista.'}); user_id=p.id;}
    const {data,error}=await adminClient.from('drivers').update({name,user_id}).eq('id',id).select('id,user_id,name,active').single();
    if(error) return res.status(400).json({error:error.message}); res.json(data);
  } catch(e){res.status(500).json({error:e.message||'Erro ao atualizar motorista.'});}
});
app.delete('/api/drivers/:id', requireContext, async (req,res)=>{
  if(!adminOnly(req,res)) return;
  try {
    const id=req.params.id; const {count,error:ce}=await adminClient.from('service_orders').select('id',{count:'exact',head:true}).eq('driver_id',id);
    if(ce) return res.status(400).json({error:ce.message});
    if((count||0)>0) return res.status(409).json({error:'Este motorista possui O.S. vinculadas e não pode ser excluído. Para preservar o histórico, inative o cadastro.'});
    const {error}=await adminClient.from('drivers').delete().eq('id',id); if(error)return res.status(400).json({error:error.message}); res.json({ok:true});
  } catch(e){res.status(500).json({error:e.message||'Erro ao excluir motorista.'});}
});

app.get('/api/orders', requireContext, async (req,res)=>{
  try {
    const c=req.ctx;
    let query=adminClient
      .from('service_orders')
      .select('*,driver:drivers(id,name,user_id)')
      .order('created_at',{ascending:false});
    if(c.profile.role==='Motorista'){
      const {data:d,error:de}=await adminClient.from('drivers').select('id').eq('user_id',c.user.id).eq('active',true).maybeSingle();
      if(de) return res.status(400).json({error:de.message});
      if(!d) return res.json([]);
      query=query.eq('driver_id',d.id);
    }
    const {data,error}=await query;
    if(error) return res.status(400).json({error:error.message});
    res.set('Cache-Control','no-store');
    res.json(data||[]);
  } catch(e) {
    res.status(500).json({error:e.message||'Erro ao consultar O.S.'});
  }
});

app.post('/api/orders', requireContext, async (req,res)=>{
  try {
    const c=req.ctx, b=req.body||{};
    const required=['driver_id','associated_name','plate','vehicle_type','vehicle_model','vehicle_color','protocol'];
    const missing=required.filter(k=>b[k]===undefined||b[k]===null||String(b[k]).trim()===''); if(missing.length)return res.status(400).json({error:'Campos obrigatórios ausentes: '+missing.join(', ')});
    if(!['Leve','Motocicleta','Utilitário'].includes(b.vehicle_type))return res.status(400).json({error:'Tipo de veículo inválido.'});
    if(c.profile.role==='Motorista'){const {data:d}=await adminClient.from('drivers').select('id').eq('id',b.driver_id).eq('user_id',c.user.id).eq('active',true).maybeSingle(); if(!d)return res.status(403).json({error:'O motorista não pode abrir O.S. para outro motorista.'});}
    const {data:dup}=await adminClient.from('service_orders').select('id').ilike('protocol',String(b.protocol).trim()).maybeSingle(); if(dup)return res.status(409).json({error:'Protocolo duplicado.'});
    const payload={driver_id:b.driver_id,associated_name:String(b.associated_name).trim(),plate:String(b.plate).trim().toUpperCase(),vehicle_type:b.vehicle_type,vehicle_model:String(b.vehicle_model).trim(),vehicle_color:b.vehicle_color,protocol:String(b.protocol).trim(),origin:b.origin||null,destination:b.destination||null,mileage:b.mileage===null||b.mileage===''?null:Number(b.mileage),preexisting_damages:Array.isArray(b.preexisting_damages)?b.preexisting_damages:[],tires:b.tires||null,keys_with:b.keys_with||null,checklist:b.checklist||{items:{},observations:''},status:'Em atendimento',created_by:c.user.id};
    const {data,error}=await adminClient.from('service_orders').insert(payload).select('*,driver:drivers(id,name,user_id)').single(); if(error)return res.status(400).json({error:error.message}); res.status(201).json(data);
  } catch(e){res.status(500).json({error:e.message||'Erro ao criar O.S.'});}
});
app.patch('/api/orders/:id', requireContext, async (req,res)=>{
  try {
    const c=req.ctx,id=req.params.id; const {data:o,error:oe}=await adminClient.from('service_orders').select('*,driver:drivers(id,name,user_id)').eq('id',id).single(); if(oe||!o)return res.status(404).json({error:'O.S. não encontrada.'});
    if(c.profile.role==='Motorista' && o.driver_id!== (await adminClient.from('drivers').select('id').eq('user_id',c.user.id).maybeSingle()).data?.id)return res.status(403).json({error:'Você não pode alterar esta O.S.'});
    if(c.profile.role==='Motorista' && req.body.driver_id && req.body.driver_id!==o.driver_id)return res.status(403).json({error:'Motorista não pode transferir a O.S.'});
    if(c.profile.role==='Motorista' && req.body.protocol && String(req.body.protocol).trim()!==String(o.protocol).trim())return res.status(403).json({error:'Motorista não pode alterar o protocolo.'});
    const allowed=['driver_id','associated_name','plate','vehicle_type','vehicle_model','vehicle_color','protocol','origin','destination','mileage','preexisting_damages','tires','keys_with','checklist','status','finalized_at']; const patch={}; for(const k of allowed)if(Object.prototype.hasOwnProperty.call(req.body,k))patch[k]=req.body[k];
    if(patch.status==='Finalizada')patch.finalized_at=new Date().toISOString();
    const {data,error}=await adminClient.from('service_orders').update(patch).eq('id',id).select('*,driver:drivers(id,name,user_id)').single(); if(error)return res.status(400).json({error:error.message}); res.json(data);
  }catch(e){res.status(500).json({error:e.message||'Erro ao atualizar O.S.'});}
});
app.delete('/api/orders/:id', requireContext, async(req,res)=>{ if(!adminOnly(req,res))return; try{const {error}=await adminClient.from('service_orders').delete().eq('id',req.params.id);if(error)return res.status(400).json({error:error.message});res.json({ok:true});}catch(e){res.status(500).json({error:e.message||'Erro ao excluir O.S.'});}});

app.use(express.static(publicDir));
app.get('*', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.listen(PORT, '0.0.0.0', () => console.log(`América List em http://0.0.0.0:${PORT}`));
