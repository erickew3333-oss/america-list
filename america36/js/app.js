/* América List — Supabase online adapter */
const SUPABASE_URL='https://zsbfwstbbfuvihcxvnvk.supabase.co';
const SUPABASE_PUBLISHABLE_KEY='sb_publishable_enaedzfrsgi-7XZn_BjCDQ_wvBqtU4z';
const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY);
const KEY='americaListData';
const vehicleTypes=['Leve','Motocicleta','Utilitário'];
const colors=['Azul','Amarelo','Laranja','Branco','Bege','Cinza','Prata','Preto','Verde','Vermelho','Roxo','Rosa'];
const ownVehicleTypes=['Caminhão','Carrocinha'];
const checklist=['Pneus','Estepe','Faróis','Lanternas','Freios','Macaco','Triângulo','Extintor','Cintos de segurança','Documentação do veículo'];
const DAMAGE_OPTIONS=['Amassado','Manchado','Arranhado','Roda Travada','Vidro Quebrado ou trincado','Porta Danificada','Retrovisores'];
let db={user:null,orders:[],drivers:[],fleet:[],users:[]};
let remoteOnline=false;
let remoteSaveQueue=Promise.resolve();
let currentAuthUser=null;
const roleToApp=r=>r==='Administrador'?'admin':r==='Assistência'?'assistencia':'motorista';
const roleToDb=r=>r==='admin'?'Administrador':r==='assistencia'?'Assistência':'Motorista';
const formatDate=iso=>iso?new Date(iso).toLocaleString('pt-BR'):'—';
const normalizeOrder=row=>({
 id:row.id, driver:row.driver?.name||'', driverId:row.driver_id, assoc:row.associated_name, plate:row.plate,
 vehicleType:row.vehicle_type, model:row.vehicle_model, color:row.vehicle_color, protocol:row.protocol,
 origin:row.origin||'', destination:row.destination||'', km:row.mileage??'', damages:Array.isArray(row.preexisting_damages)?row.preexisting_damages:[],
 tires:row.tires||'', keys:row.keys_with||'', obs:row.checklist?.observations||'', checks:row.checklist?.items||row.checklist||{},
 status:row.status, created:formatDate(row.created_at), createdISO:row.created_at, updated:row.updated_at&&row.updated_at!==row.created_at?formatDate(row.updated_at):null,
 finalizedAt:row.finalized_at||null, signatureData:row.signature_data||'', signedAt:row.signed_at||null, photos:[]
});
async function loadOnlineData(){
 const {data:{session}}=await sb.auth.getSession();
 currentAuthUser=session?.user||null;
 if(!currentAuthUser){remoteOnline=false;return false;}
 const {data:profile,error:pe}=await sb.from('profiles').select('*').eq('id',currentAuthUser.id).single();
 if(pe||!profile||!profile.active){await sb.auth.signOut();remoteOnline=false;return false;}
 db.user={id:profile.id,name:profile.full_name,username:profile.username,role:roleToApp(profile.role),photo:profile.avatar_url||''};
 const [dr,us,os]=await Promise.all([
   sb.from('drivers').select('id,user_id,name,active,created_at,updated_at').eq('active',true).order('name'),
   db.user.role==='admin'?sb.from('profiles').select('*').order('created_at'):Promise.resolve({data:[],error:null}),
   (async()=>{
     let q=sb.from('service_orders').select('*,driver:drivers(id,name,user_id)').order('created_at',{ascending:false});
     if(db.user.role==='motorista'){
       const {data:d,error:de}=await sb.from('drivers').select('id').eq('user_id',currentAuthUser.id).eq('active',true).maybeSingle();
       if(de) throw de;
       if(!d) return [];
       q=q.eq('driver_id',d.id);
     }
     const {data,error}=await q;
     if(error) throw error;
     return data||[];
   })()
 ]);
 if(dr.error) throw dr.error;
 if(us.error) throw us.error;
 db.drivers=(dr.data||[]).map(x=>({id:x.id,name:x.name,userId:x.user_id,user:(x.user_id?'':'')}));
 db.orders=(os||[]).map(normalizeOrder);
 db.users=(us.data||[]).map(x=>({id:x.id,username:x.username,name:x.full_name,role:roleToApp(x.role),photo:x.avatar_url||'',active:x.active}));
 remoteOnline=true;
 localStorage.setItem(KEY,JSON.stringify({user:db.user,orders:db.orders,drivers:db.drivers,users:db.users}));
 return true;
}
function saveLocal(){localStorage.setItem(KEY,JSON.stringify({user:db.user,orders:db.orders,drivers:db.drivers,users:db.users}));}
async function save(){saveLocal();}
async function syncOrderUpdate(id,patch){
 const payload={};
 if('driverId' in patch) payload.driver_id=patch.driverId;
 if('assoc' in patch) payload.associated_name=patch.assoc;
 if('plate' in patch) payload.plate=patch.plate;
 if('vehicleType' in patch) payload.vehicle_type=patch.vehicleType;
 if('model' in patch) payload.vehicle_model=patch.model;
 if('color' in patch) payload.vehicle_color=patch.color;
 if('protocol' in patch) payload.protocol=patch.protocol;
 if('origin' in patch) payload.origin=patch.origin;
 if('destination' in patch) payload.destination=patch.destination;
 if('km' in patch) payload.mileage=patch.km===''?null:Number(patch.km);
 if('damages' in patch) payload.preexisting_damages=patch.damages;
 if('tires' in patch) payload.tires=patch.tires||null;
 if('keys' in patch) payload.keys_with=patch.keys||null;
 if('checks' in patch||'obs' in patch) payload.checklist={items:patch.checks??{},observations:patch.obs??''};
 if('status' in patch) {payload.status=patch.status;if(patch.status==='Finalizada')payload.finalized_at=new Date().toISOString();}
 const {error}=await sb.from('service_orders').update(payload).eq('id',id); if(error) throw error;
}
async function loadPhotos(id){
 const {data,error}=await sb.from('os_photos').select('*').eq('os_id',id).order('created_at');
 if(error) throw error;
 const photos=[];
 for(const row of data||[]){const {data:signed,error:se}=await sb.storage.from('os-photos').createSignedUrl(row.storage_path,3600);if(!se&&signed?.signedUrl)photos.push(signed.signedUrl)}
 const o=db.orders.find(x=>x.id===id);if(o)o.photos=photos;return photos;
}
async function initializeOnlineDatabase(){
 try{await loadOnlineData();return remoteOnline;}catch(e){console.error(e);remoteOnline=false;return false;}
}
function remoteBadge(){return remoteOnline?'<span class="online-badge">● Banco online</span>':''}
const app=document.getElementById('app');
const SYSTEM_VERSION='1.0.37';
function appFooter(){return `<footer class="app-footer"><div class="app-signature">Desenvolvido pelo Administrativo da Assistência 24 Horas</div><button type="button" class="system-info-btn" onclick="openSystemInfo()" aria-label="Informações do sistema">Sistema</button></footer>`}
function openSystemInfo(){if(document.getElementById('systemInfoModal'))return;document.body.insertAdjacentHTML('beforeend',`<div id="systemInfoModal" class="system-modal" role="dialog" aria-modal="true" aria-labelledby="systemInfoTitle"><div class="system-modal-backdrop" onclick="closeSystemInfo()"></div><section class="system-modal-card"><div class="system-modal-head"><div class="system-modal-brand"><img src="assets/logo.png" alt="América List"><div><span class="section-kicker">INFORMAÇÕES DO SISTEMA</span><h2 id="systemInfoTitle">Sistema</h2><p>América List · Assistência 24 Horas</p></div></div><button type="button" class="system-close" onclick="closeSystemInfo()" aria-label="Fechar">×</button></div><div class="system-info-list"><div class="system-person"><span class="system-avatar">IF</span><span class="system-label"><small>Desenvolvedor</small><strong>Igor Felix</strong></span></div><div class="system-person"><span class="system-avatar">EW</span><span class="system-label"><small>Desenvolvedor</small><strong>Erick Wendell</strong></span></div><div class="system-person"><span class="system-avatar">WR</span><span class="system-label"><small>Desenvolvedor</small><strong>Weslley Renan</strong></span></div><div class="system-version"><span><small>Versão atual</small><strong>América List</strong></span><b>v${SYSTEM_VERSION}</b></div></div></section></div>`)}
function closeSystemInfo(){document.getElementById('systemInfoModal')?.remove()}
function ensureAppFooter(){if(!app.querySelector('.app-footer') && app.querySelector('main')) app.insertAdjacentHTML('beforeend',appFooter())}
const footerObserver=new MutationObserver(()=>ensureAppFooter());footerObserver.observe(app,{childList:true});
const THEME_KEY='americaListTheme';
function applyTheme(theme){const t=theme==='dark'?'dark':'light';document.documentElement.setAttribute('data-theme',t);localStorage.setItem(THEME_KEY,t)}
function toggleTheme(){applyTheme(document.documentElement.getAttribute('data-theme')==='dark'?'light':'dark');renderThemeButton()}
function renderThemeButton(){const b=document.getElementById('themeToggle');if(b){const dark=document.documentElement.getAttribute('data-theme')==='dark';b.innerHTML=dark?'☀️ Modo claro':'🌙 Modo noturno';b.setAttribute('aria-label',dark?'Ativar modo claro':'Ativar modo noturno')}}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function header(){return `<header class="top"><img src="assets/logo.png"><div class="brand-block"><div class="brand">América <span>List</span></div><div class="small top-subtitle">Checklist • Ordem de Serviço ${remoteBadge()}</div></div><button id="themeToggle" class="theme-toggle" type="button" onclick="toggleTheme()" aria-label="Alternar modo de exibição">🌙 Modo noturno</button></header>`}
function nav(){return `<div class="nav app-nav"><button class="nav-action" onclick="dashboard()"><span class="nav-action-icon">⌂</span><span><b>Painel</b><small>Visão geral</small></span></button><button class="nav-action" onclick="orders()"><span class="nav-action-icon">▤</span><span><b>Ordens de Serviço</b><small>Consultar e acompanhar</small></span></button><button class="nav-action primary" onclick="newOrder()"><span class="nav-action-icon">＋</span><span><b>Nova O.S.</b><small>Abrir atendimento</small></span></button>${db.user?.role==='admin'?`<button class="nav-action" onclick="commands()"><span class="nav-action-icon">⚙</span><span><b>Comandos</b><small>Gestão do sistema</small></span></button>`:''}<button class="nav-action logout-action" onclick="logout()"><span class="nav-action-icon">↪</span><span><b>Sair</b><small>Encerrar sessão</small></span></button></div>`}
function login(){app.innerHTML=`${header()}<main class="wrap"><section class="card login"><img src="assets/logo.png"><h1>Acesso ao América List</h1><div class="field"><label>Usuário</label><input id="u" placeholder="Digite seu usuário"></div><div class="field"><label>Senha</label><input id="p" type="password" placeholder="Digite sua senha"></div><div class="field"><label>Perfil</label><select id="role"><option value="motorista">Motorista</option><option value="assistencia">Assistência</option><option value="admin">Administrador</option></select></div><button class="btn" onclick="doLogin()">Entrar</button><p class="small">Acesso protegido pelo banco de dados do América List.</p></section></main>`}
window.doLogin=()=>{
 const username=document.getElementById('u').value.trim();
 const password=document.getElementById('p').value;
 const selectedRole=document.getElementById('role').value;
 const account=db.users.find(u=>u.username.toLowerCase()===username.toLowerCase() && u.password===password && u.role===selectedRole);
 if(!account){ alert('Usuário, senha ou nível de acesso inválido.'); return; }
 const linkedDriver=account.role==='motorista' ? db.drivers.find(d=>String(d.user||'').toLowerCase()===String(account.username||'').toLowerCase()) : null;
 db.user={name:linkedDriver?.name||account.name||account.username,username:account.username,role:account.role,photo:account.photo||''};
 save(); dashboard();
};
function dashboard(){
 if(!db.user)return login();
 const visibleOrders=db.user.role==='motorista' ? db.orders.filter(o=>String(o.driver||'').toLowerCase()===String(db.user.name||'').toLowerCase()) : db.orders;
 const total=visibleOrders.length;
 const atend=visibleOrders.filter(o=>o.status==='Em atendimento').length;
 const fin=visibleOrders.filter(o=>o.status==='Finalizada').length;
 const prob=visibleOrders.filter(o=>o.status==='Com problema').length;
 const panelTitle=db.user.role==='admin'?'Painel Administrativo':db.user.role==='motorista'?'Painel Motorista':'Painel Assistência';
 const driverMap={};
 visibleOrders.forEach(o=>{const name=o.driver||'Não informado';driverMap[name]=(driverMap[name]||0)+1});
 const chartData=Object.entries(driverMap).sort((a,b)=>b[1]-a[1]);
 const maxCount=Math.max(1,...chartData.map(x=>x[1]));
 const chart=chartData.length?chartData.map(([name,count],i)=>`<button type="button" class="driver-bar" onclick="driverOrdersByIndex(${i})" aria-label="Ver ordens de ${esc(name)}"><span class="driver-bar-head"><span class="driver-rank">${i+1}</span><span class="driver-name"><b>${esc(name)}</b><small>${count===1?'1 Ordem de Serviço':count+' Ordens de Serviço'}</small></span><strong>${count}</strong></span><span class="bar-track"><span class="bar-fill" style="width:${Math.max(8,Math.round(count/maxCount*100))}%"></span></span><span class="driver-bar-foot"><span>Consultar protocolos e dados</span><span class="driver-open">Abrir ›</span></span></button>`).join(''):'<div class="empty-state"><div class="empty-icon">▥</div><div><b>Nenhuma O.S. registrada</b><p class="small">Quando houver ordens, o desempenho por motorista aparecerá aqui.</p></div></div>';
 window._driverChartNames=chartData.map(x=>x[0]);
 const recent=visibleOrders.slice().sort((a,b)=>new Date(b.createdISO||0)-new Date(a.createdISO||0)).slice(0,6);
 const statusPill=s=>`<span class="status-pill status-${s==='Finalizada'?'finalizada':s==='Com problema'?'problema':'atendimento'}"><i></i>${esc(s)}</span>`;
 const recentRows=recent.length?recent.map(o=>`<button class="recent-order" onclick="viewOrder('${o.id}')"><span class="recent-main"><b>Protocolo ${esc(o.protocol)}</b><small>${esc(o.driver||'—')} · ${esc(o.plate||'—')}</small></span><span>${statusPill(o.status)}</span><span class="recent-arrow">›</span></button>`).join(''):'<div class="empty-state compact"><div class="empty-icon">✓</div><div><b>Nenhuma ordem recente</b><p class="small">As novas O.S. aparecerão automaticamente nesta área.</p></div></div>';
 app.innerHTML=`${header()}<main class="wrap dashboard-wrap">${nav()}
 <section class="hero card">
   <div class="hero-content"><h2 class="hero-title">${panelTitle}</h2><p>Olá, <b>${esc(db.user.name)}</b>. Acompanhe sua operação em um só lugar.</p><div class="hero-meta"><span>● Sistema operacional</span><span>•</span><span>Dados atualizados nesta sessão</span></div></div>
   <div class="hero-side"><div class="hero-logo-mark">AL</div><div><b>América List</b><small>Gestão de Assistência 24 Horas</small></div></div>
 </section>
 <section class="dashboard-section-title"><div><span class="eyebrow dark-eyebrow">VISÃO GERAL</span><h2>Resumo operacional</h2><p class="small">Indicadores da ${db.user.role==='motorista'?'sua atividade':'operação atual'}.</p></div><button class="btn outline-btn" onclick="orders()">Ver Ordens de Serviço <span>→</span></button></section>
 <section class="stats-grid professional-stats">
   <button class="stat-card stat-total" onclick="statusOrders('all')"><span class="stat-icon">▦</span><span><small>ORDENS CADASTRADAS</small><b>${total}</b><em>Ver todas</em></span><span class="card-arrow">›</span></button>
   <button class="stat-card stat-atendimento" onclick="statusOrders('Em atendimento')"><span class="stat-icon">◷</span><span><small>EM ATENDIMENTO</small><b>${atend}</b><em>Acompanhar agora</em></span><span class="card-arrow">›</span></button>
   <button class="stat-card stat-finalizada" onclick="statusOrders('Finalizada')"><span class="stat-icon">✓</span><span><small>FINALIZADAS</small><b>${fin}</b><em>Consultar histórico</em></span><span class="card-arrow">›</span></button>
   <button class="stat-card stat-problema" onclick="statusOrders('Com problema')"><span class="stat-icon">!</span><span><small>COM PROBLEMA</small><b>${prob}</b><em>Ver ocorrências</em></span><span class="card-arrow">›</span></button>
 </section>
 <section class="dashboard-grid">
   <section class="card driver-chart professional-card"><div class="section-head"><div><span class="section-kicker">DESEMPENHO</span><h2>O.S. por motorista</h2><p class="small">Clique em um motorista para abrir somente as ordens correspondentes.</p></div><span class="chart-badge">${chartData.length} ${chartData.length===1?'motorista':'motoristas'}</span></div><div class="chart-list">${chart}</div></section>
   <section class="card professional-card recent-card"><div class="section-head"><div><span class="section-kicker">ACESSO RÁPIDO</span><h2>Ordens recentes</h2><p class="small">Últimos atendimentos registrados.</p></div><button class="icon-link" onclick="orders()" aria-label="Ver todas as ordens">Ver todas →</button></div><div class="recent-list">${recentRows}</div></section>
 </section>
 </main>`
 renderThemeButton();
}
function statusPillForDriver(s){return `<span class="status-pill status-${s==='Finalizada'?'finalizada':s==='Com problema'?'problema':'atendimento'}><i></i>${esc(s||'Sem status')}</span>`}
function orderTable(list){if(!list.length)return '<div class="notice">Nenhuma ordem de serviço encontrada.</div>';return `<div style="overflow:auto"><table class="table"><tr><th>Protocolo</th><th>Placa</th><th>Motorista</th><th>Status</th><th>Ações</th></tr>${list.map(o=>`<tr><td>${esc(o.protocol)}</td><td>${esc(o.plate)}</td><td>${esc(o.driver)}</td><td><span class="pill order-status-pill ${o.status==='Finalizada'?'status-finalizada':o.status==='Com problema'?'status-problema':'status-atendimento'}"><i></i>${esc(o.status)}</span></td><td><button class="btn" onclick="viewOrder('${o.id}')">Abrir</button>${db.user?.role==='admin'?` <button class="btn red" onclick="deleteOrder('${o.id}')">Excluir</button>`:''}</td></tr>`).join('')}</table></div>`}
function orders(){const visibleOrders=db.user?.role==='motorista'?db.orders.filter(o=>String(o.driver||'').toLowerCase()===String(db.user.name||'').toLowerCase()):db.orders;app.innerHTML=`${header()}<main class="wrap page-wrap">${nav()}<section class="page-hero orders-hero"><div><span class="page-kicker">GESTÃO DE ATENDIMENTOS</span><h1>Ordens de Serviço</h1><p>${db.user?.role==='motorista'?'Visualização exclusiva das suas O.S.':'Consulte e acompanhe todas as O.S. da operação.'}</p></div><div class="page-hero-badge">▤ <span>${visibleOrders.length} ${visibleOrders.length===1?'ordem':'ordens'}</span></div></section><section class="search-panel card"><div class="search-title"><span class="search-icon">⌕</span><div><h2>Localizar uma O.S.</h2><p class="small">Pesquise por protocolo, motorista ou placa.</p></div></div><div class="search-grid"><div class="field"><label>Protocolo</label><input id="qProtocol" placeholder="Digite o número do protocolo" oninput="filterOrders()"></div><div class="field"><label>Motorista</label><input id="qDriver" placeholder="Nome do motorista" oninput="filterOrders()" ${db.user?.role==='motorista'?'disabled':''}></div><div class="field"><label>Placa</label><input id="qPlate" placeholder="ABC1D23" oninput="filterOrders()"></div></div></section><section class="results-panel card"><div class="section-head"><div><span class="section-kicker">RESULTADOS</span><h2>Ordens cadastradas</h2></div><span class="results-count" id="resultsCount">${visibleOrders.length} ${visibleOrders.length===1?'ordem':'ordens'}</span></div><div id="orderResults">${orderTable(visibleOrders.slice().reverse())}</div></section></main>`;window._ordersBase=visibleOrders;renderThemeButton();updateOrderResultsCount()}
window.filterOrders=()=>{const p=(document.getElementById('qProtocol').value||'').toLowerCase(),d=(document.getElementById('qDriver').value||'').toLowerCase(),pl=(document.getElementById('qPlate').value||'').toLowerCase();const base=window._ordersBase||db.orders;const l=base.slice().reverse().filter(o=>String(o.protocol).toLowerCase().includes(p)&&String(o.driver).toLowerCase().includes(d)&&String(o.plate).toLowerCase().includes(pl));document.getElementById('orderResults').innerHTML=orderTable(l);updateOrderResultsCount(l.length)};window.updateOrderResultsCount=n=>{const el=document.getElementById('resultsCount');if(el){const count=n??((window._ordersBase||db.orders).length);el.textContent=`${count} ${count===1?'ordem':'ordens'}`}};window.statusOrders=status=>{if(status==='all')return orders();const base=db.user?.role==='motorista'?db.orders.filter(o=>String(o.driver||'').toLowerCase()===String(db.user.name||'').toLowerCase()):db.orders;app.innerHTML=`${header()}<main class="wrap">${nav()}<section class="card"><div class="section-head"><div><h2>${esc(status)}</h2><p class="small">${base.filter(o=>o.status===status).length} ordem(ns) encontrada(s) neste status.</p></div><button class="btn gray" onclick="dashboard()">Voltar ao Painel</button></div>${orderTable(base.slice().reverse().filter(o=>o.status===status))}</section></main>`};window.driverOrders=name=>{const base=db.user?.role==='motorista'?db.orders.filter(o=>String(o.driver||'').toLowerCase()===String(db.user.name||'').toLowerCase()):db.orders;const list=base.slice().reverse().filter(o=>String(o.driver||'').toLowerCase()===String(name).toLowerCase());const atend=list.filter(o=>o.status==='Em atendimento').length,fin=list.filter(o=>o.status==='Finalizada').length,prob=list.filter(o=>o.status==='Com problema').length;const rows=list.length?list.map(o=>`<button type="button" class="driver-order-card" onclick="viewOrder('${o.id}')"><span class="driver-order-main"><b>Protocolo ${esc(o.protocol||'—')}</b><small>Placa ${esc(o.plate||'—')} · ${esc(o.model||'—')}</small><small>${esc(o.created||'—')}</small></span><span class="driver-order-meta">${statusPillForDriver(o.status)}<span class="driver-order-arrow">›</span></span></button>`).join(''):'<div class="empty-state"><div class="empty-icon">✓</div><div><b>Nenhuma O.S. encontrada</b><p class="small">Não há protocolos registrados para este motorista.</p></div></div>';app.innerHTML=`${header()}<main class="wrap">${nav()}<section class="card driver-detail"><div class="section-head"><div><div class="eyebrow driver-eyebrow">DETALHAMENTO DO MOTORISTA</div><h2>${esc(name)}</h2><p class="small">Todos os protocolos e dados correspondentes às O.S. deste motorista.</p></div><button class="btn gray" onclick="dashboard()">Voltar ao Painel</button></div><div class="driver-summary"><div class="mini-stat"><b>${list.length}</b><span>Total de O.S.</span></div><div class="mini-stat orange"><b>${atend}</b><span>Em atendimento</span></div><div class="mini-stat green"><b>${fin}</b><span>Finalizadas</span></div><div class="mini-stat red"><b>${prob}</b><span>Com problema</span></div></div></section><section class="card driver-orders-panel"><div class="section-head"><div><span class="section-kicker">PROTOCOLOS</span><h2>Ordens deste motorista</h2><p class="small">Clique em uma ordem para visualizar todos os dados, checklist e fotos.</p></div><span class="chart-badge">${list.length} ${list.length===1?'protocolo':'protocolos'}</span></div><div class="driver-order-list">${rows}</div></section></main>`};
window.deleteOrder=id=>{if(db.user?.role!=='admin')return;const o=db.orders.find(x=>x.id===id);if(!o)return;if(confirm(`Excluir a O.S. do protocolo ${o.protocol}? Esta ação não pode ser desfeita.`)){db.orders=db.orders.filter(x=>x.id!==id);save();orders()}};
function driverOptions(){return `<option value="">Selecione o motorista</option>${db.drivers.map(d=>`<option value="${esc(d.name)}">${esc(d.name)}</option>`).join('')}`}
function newOrder(){const items=checklist.map(x=>`<div class="check"><span>${x}</span><select data-item="${x}"><option>OK</option><option>Problema</option><option>Não se aplica</option></select></div>`).join('');const now=new Date(),generatedAt=now.toLocaleString('pt-BR');app.innerHTML=`${header()}<main class="wrap">${nav()}<section class="card"><h2>Nova Ordem de Serviço</h2><div class="notice"><b>Data e hora da O.S.:</b> ${generatedAt}<br><span class="small">Registrada automaticamente no momento da criação.</span></div><div class="grid"><div class="field"><label>Motorista <span class="req">*</span></label>${db.user?.role==='motorista'?`<input id="driver" value="${esc(db.user.name)}" readonly>`:`<select id="driver"><option value="">Selecione o motorista</option>${db.drivers.map(d=>`<option value="${esc(d.name)}">${esc(d.name)}</option>`).join('')}</select>`}</div><div class="field"><label>Placa <span class="req">*</span></label><input id="plate" placeholder="ABC1D23"></div><div class="field"><label>Associado <span class="req">*</span></label><input id="assoc" placeholder="Nome do associado"></div><div class="field"><label>Tipo de Veículo <span class="req">*</span></label><select id="vehicleType"><option value="">Selecione o tipo</option>${vehicleTypes.map(v=>`<option>${v}</option>`).join('')}</select></div><div class="field"><label>Modelo do Veículo <span class="req">*</span></label><input id="model" placeholder="Ex.: Toyota Hilux"></div><div class="field"><label>Cor <span class="req">*</span></label><select id="color"><option value="">Selecione a cor</option>${colors.map(c=>`<option>${c}</option>`).join('')}</select></div><div class="field"><label>Protocolo <span class="req">*</span></label><input id="protocol" placeholder="Número do protocolo"></div><div class="field"><label>Local Origem</label><input id="origin" placeholder="Endereço de origem"></div><div class="field"><label>Local Destino</label><input id="destination" placeholder="Endereço de destino"></div><div class="field"><label>Quilometragem</label><input id="km" type="number"></div></div><h3>Danos ou Avarias Pré-Existentes</h3><div class="grid">${['Amassado','Manchado','Arranhado','Roda Travada','Vidro Quebrado ou trincado','Porta Danificada','Retrovisores'].map(x=>`<label class="option"><input type="checkbox" name="damage" value="${x}"> ${x}</label>`).join('')}</div><h3>Pneus</h3><div class="field"><select id="tires"><option value="">Selecione</option><option>Bons</option><option>Novos</option><option>Ruins</option></select></div><h3>Chaves Acompanhando</h3><div class="field"><select id="keys"><option value="">Selecione</option><option>Sim</option><option>Não</option></select></div><h3>Checklist</h3>${items}<div class="field"><label>Observações</label><textarea id="obs"></textarea></div><div class="field"><label>Fotos do atendimento</label><input id="photos" type="file" accept="image/*" multiple></div><section class="signature-card"><div class="section-head"><div><span class="section-kicker">ASSINATURA</span><h3>Assinatura do Associado</h3><p class="small">Assine diretamente na tela usando o dedo, como uma caneta.</p></div></div><div class="signature-pad-wrap"><canvas id="signaturePad" class="signature-pad" aria-label="Área para assinatura"></canvas><div class="signature-hint">Use o dedo para assinar aqui</div></div><div class="row"><button type="button" class="btn gray" onclick="clearSignature()">Limpar assinatura</button></div></section><div id="validation" class="notice hidden"></div><div class="row"><button class="btn green" onclick="saveOrder()">Salvar e iniciar atendimento</button><button class="btn gray" onclick="dashboard()">Cancelar</button></div></section></main>`;initSignaturePad();renderThemeButton()}
window.saveOrder=async()=>{const required=[['driver','Motorista'],['plate','Placa'],['assoc','Associado'],['vehicleType','Tipo de Veículo'],['model','Modelo do Veículo'],['color','Cor'],['protocol','Protocolo']];const missing=required.filter(([id])=>!document.getElementById(id).value.trim()).map(x=>x[1]);document.querySelectorAll('.invalid').forEach(x=>x.classList.remove('invalid'));if(missing.length){missing.forEach(n=>{const pair=required.find(x=>x[1]===n);document.getElementById(pair[0]).classList.add('invalid')});const v=document.getElementById('validation');v.classList.remove('hidden');v.innerHTML='<b>Preencha os campos obrigatórios:</b> '+missing.join(', ');return}const protocol=document.getElementById('protocol').value.trim();const duplicate=db.orders.some(x=>String(x.protocol||'').trim().toLowerCase()===protocol.toLowerCase());if(duplicate){const v=document.getElementById('validation');v.classList.remove('hidden');v.innerHTML='<b>Protocolo duplicado.</b> Já existe uma O.S. cadastrada com este protocolo. Informe outro número.';document.getElementById('protocol').classList.add('invalid');document.getElementById('protocol').focus();return}const checks={};document.querySelectorAll('[data-item]').forEach(s=>checks[s.dataset.item]=s.value);const damages=[...document.querySelectorAll('input[name="damage"]:checked')].map(x=>x.value);let photos=[];for(const f of document.getElementById('photos').files)photos.push(await readFile(f));const createdAt=new Date();const o={id:String(Date.now()),driver:document.getElementById('driver').value,plate:document.getElementById('plate').value.toUpperCase(),assoc:document.getElementById('assoc').value,vehicleType:document.getElementById('vehicleType').value,model:document.getElementById('model').value,color:document.getElementById('color').value,protocol:document.getElementById('protocol').value,origin:document.getElementById('origin').value,destination:document.getElementById('destination').value,km:document.getElementById('km').value,damages,tires:document.getElementById('tires').value,keys:document.getElementById('keys').value,obs:document.getElementById('obs').value,checks,photos,status:'Em atendimento',created:createdAt.toLocaleString('pt-BR'),createdISO:createdAt.toISOString(),updated:null};db.orders.push(o);save();viewOrder(o.id)};
const readFile=f=>new Promise(r=>{const x=new FileReader();x.onload=()=>r(x.result);x.readAsDataURL(f)});
function viewOrder(id){const o=db.orders.find(x=>x.id===id);if(!o)return;const canEdit=db.user?.role==='admin';app.innerHTML=`${header()}<main class="wrap">${nav()}<section class="card"><div class="row"><h2 style="margin-right:auto">Protocolo ${esc(o.protocol)}</h2><span class="pill">${esc(o.status)}</span></div><div class="notice"><b>Data e hora da O.S.:</b> ${esc(o.created)}${o.updated?`<br><span class="small">Última alteração: ${esc(o.updated)}</span>`:''}</div><div class="grid"><div><b>Motorista</b><p>${esc(o.driver)}</p></div><div><b>Placa</b><p>${esc(o.plate)}</p></div><div><b>Associado</b><p>${esc(o.assoc)}</p></div><div><b>Tipo de Veículo</b><p>${esc(o.vehicleType)}</p></div><div><b>Modelo</b><p>${esc(o.model)}</p></div><div><b>Cor</b><p>${esc(o.color)}</p></div><div><b>Protocolo</b><p>${esc(o.protocol)}</p></div><div><b>Local Origem</b><p>${esc(o.origin)||'-'}</p></div><div><b>Local Destino</b><p>${esc(o.destination)||'-'}</p></div><div><b>KM</b><p>${esc(o.km)||'-'}</p></div><div><b>Pneus</b><p>${esc(o.tires)||'-'}</p></div><div><b>Chaves Acompanhando</b><p>${esc(o.keys)||'-'}</p></div></div><h3>Danos ou Avarias Pré-Existentes</h3><p>${o.damages?.length?o.damages.map(esc).join(', '):'Nenhuma informada.'}</p><h3>Checklist</h3>${checklist.map(k=>`<div class="check"><span>${k}</span><b>${esc(o.checks[k])}</b></div>`).join('')}<h3>Observações</h3><p>${esc(o.obs)||'-'}</p><h3>Assinatura do Associado</h3>${o.signatureData?`<div class="signature-preview"><img src="${esc(o.signatureData)}" alt="Assinatura do associado"></div>`:'<span class="small">Sem assinatura registrada.</span>'}<h3>Fotos</h3>${o.photos?.map(p=>`<a href="${p}" download="foto-os-${o.protocol}.jpg" title="Baixar foto"><img class="photo" src="${p}"></a>`).join('')||'<span class="small">Sem fotos.</span>'}<div class="row" style="margin-top:18px">${canEdit?`<button class="btn" onclick="editOrder('${o.id}')">Editar O.S.</button>`:''}<button class="btn" onclick="printOrder('${o.id}')">Salvar / Imprimir PDF</button><button class="btn green" onclick="finishOrder('${o.id}')">Finalizar O.S.</button><button class="btn red" onclick="problemOrder('${o.id}')">Marcar com problema</button><button class="btn gray" onclick="orders()">Voltar</button></div></section></main>`}
window.driverOrdersByIndex=i=>{const name=window._driverChartNames?.[Number(i)];if(name)driverOrders(name)};window.viewOrder=viewOrder;window.finishOrder=id=>{const o=db.orders.find(x=>x.id===id);if(o){o.status='Finalizada';save();viewOrder(id)}};window.problemOrder=id=>{const o=db.orders.find(x=>x.id===id);if(o){o.status='Com problema';save();viewOrder(id)}};
function editOrder(id){const o=db.orders.find(x=>x.id===id);if(!o)return;app.innerHTML=`${header()}<main class="wrap">${nav()}<section class="card"><h2>Editar O.S. — Protocolo ${esc(o.protocol)}</h2><div class="grid"><div class="field"><label>Motorista <span class="req">*</span></label><select id="driver">${db.drivers.map(d=>`<option ${d.name===o.driver?'selected':''}>${esc(d.name)}</option>`).join('')}</select></div><div class="field"><label>Placa <span class="req">*</span></label><input id="plate" value="${esc(o.plate)}"></div><div class="field"><label>Associado <span class="req">*</span></label><input id="assoc" value="${esc(o.assoc)}"></div><div class="field"><label>Tipo de Veículo <span class="req">*</span></label><select id="vehicleType">${vehicleTypes.map(v=>`<option ${v===o.vehicleType?'selected':''}>${v}</option>`).join('')}</select></div><div class="field"><label>Modelo do Veículo <span class="req">*</span></label><input id="model" value="${esc(o.model)}"></div><div class="field"><label>Cor <span class="req">*</span></label><select id="color">${colors.map(v=>`<option ${v===o.color?'selected':''}>${v}</option>`).join('')}</select></div><div class="field"><label>Protocolo <span class="req">*</span></label><input id="protocol" value="${esc(o.protocol)}"></div><div class="field"><label>Local Origem</label><input id="origin" value="${esc(o.origin)}"></div><div class="field"><label>Local Destino</label><input id="destination" value="${esc(o.destination)}"></div><div class="field"><label>Quilometragem</label><input id="km" value="${esc(o.km)}"></div><div class="field"><label>Pneus</label><select id="tires"><option></option>${['Bons','Novos','Ruins'].map(v=>`<option ${v===o.tires?'selected':''}>${v}</option>`).join('')}</select></div><div class="field"><label>Chaves Acompanhando</label><select id="keys"><option></option><option ${o.keys==='Sim'?'selected':''}>Sim</option><option ${o.keys==='Não'?'selected':''}>Não</option></select></div></div><h3>Danos ou Avarias Pré-Existentes</h3><div class="grid">${['Amassado','Manchado','Arranhado','Roda Travada','Vidro Quebrado ou trincado','Porta Danificada','Retrovisores'].map(x=>`<label class="option"><input type="checkbox" name="damage" value="${x}" ${o.damages?.includes(x)?'checked':''}> ${x}</label>`).join('')}</div><div class="field"><label>Observações</label><textarea id="obs">${esc(o.obs)}</textarea></div><div class="row"><button class="btn green" onclick="updateOrder('${o.id}')">Salvar alterações</button><button class="btn gray" onclick="viewOrder('${o.id}')">Cancelar</button></div></section></main>`}
window.editOrder=editOrder;window.updateOrder=id=>{const o=db.orders.find(x=>x.id===id);if(!o)return;const req=['driver','plate','assoc','vehicleType','model','color','protocol'];if(req.some(id=>!document.getElementById(id).value.trim())){alert('Preencha todos os campos obrigatórios.');return}const protocol=document.getElementById('protocol').value.trim();const duplicate=db.orders.some(x=>x.id!==id&&String(x.protocol||'').trim().toLowerCase()===protocol.toLowerCase());if(duplicate){alert('Protocolo duplicado. Já existe outra O.S. cadastrada com este protocolo. Informe outro número.');document.getElementById('protocol').classList.add('invalid');document.getElementById('protocol').focus();return}Object.assign(o,{driver:document.getElementById('driver').value,plate:document.getElementById('plate').value.toUpperCase(),assoc:document.getElementById('assoc').value,vehicleType:document.getElementById('vehicleType').value,model:document.getElementById('model').value,color:document.getElementById('color').value,protocol,origin:document.getElementById('origin').value,destination:document.getElementById('destination').value,km:document.getElementById('km').value,tires:document.getElementById('tires').value,keys:document.getElementById('keys').value,damages:[...document.querySelectorAll('input[name="damage"]:checked')].map(x=>x.value),obs:document.getElementById('obs').value,updated:new Date().toLocaleString('pt-BR')});save();viewOrder(id)};
function printOrder(id){
 const o=db.orders.find(x=>x.id===id);if(!o)return;
 const w=window.open('','_blank');
 if(!w){alert('O navegador bloqueou a janela de impressão. Permita pop-ups para o América List e tente novamente.');return;}
 const logo=new URL('assets/logo.png', document.baseURI).href;
 const field=(label,value)=>`<div class="info-box"><span>${label}</span><strong>${esc(value)||'-'}</strong></div>`;
 const damages=o.damages?.length?o.damages.map(esc).join(' • '):'Nenhuma informada';
 const photos=o.photos?.length?o.photos.map((p,i)=>`<a href="${p}" download="foto-${o.protocol}-${i+1}.jpg" title="Clique para baixar a foto"><img src="${p}" class="photo"></a>`).join(''):'<div class="empty">Sem fotos anexadas</div>';
 w.document.open();
 w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>O.S. ${esc(o.protocol)} — América List</title><style>
 @page{size:A4;margin:14mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,Helvetica,sans-serif;color:#1b2738;background:#fff;font-size:11px}.page{max-width:780px;margin:auto}.header{display:flex;align-items:center;justify-content:space-between;border-bottom:4px solid #c9232b;padding:4px 0 12px;margin-bottom:16px}.brand{display:flex;align-items:center;gap:14px}.brand img{width:86px;height:auto;object-fit:contain}.brand-title{font-size:23px;font-weight:800;color:#123f82}.brand-title span{color:#c9232b}.subtitle{font-size:11px;color:#52657d;margin-top:4px;font-weight:600}.doc{text-align:right}.doc-label{font-size:10px;color:#6c7b8d;text-transform:uppercase;letter-spacing:.7px}.protocol{font-size:18px;font-weight:800;color:#123f82;margin-top:3px}.meta{display:flex;justify-content:space-between;gap:12px;background:#f3f6fa;border-left:5px solid #123f82;padding:10px 12px;margin-bottom:16px}.meta b{color:#123f82}.section{margin-top:15px}.section h3{font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:#123f82;border-bottom:1px solid #dbe3ec;padding-bottom:6px;margin:0 0 9px}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:7px}.info-box{border:1px solid #dce3eb;border-radius:6px;padding:8px 9px;min-height:38px;background:#fff}.info-box span{display:block;color:#6d7c8e;font-size:9px;text-transform:uppercase;margin-bottom:3px}.info-box strong{font-size:11px;color:#1d2c3d}.wide{grid-column:1/-1}.damage{padding:9px;border:1px solid #dce3eb;border-radius:6px;background:#fafbfd}.checks{display:grid;grid-template-columns:1fr 1fr;gap:5px}.check{display:flex;justify-content:space-between;gap:10px;border:1px solid #e1e6ed;border-radius:5px;padding:7px 9px}.check b{color:#123f82}.obs{border:1px solid #dce3eb;border-radius:6px;padding:10px;min-height:48px;white-space:pre-wrap}.photos{display:flex;flex-wrap:wrap;gap:8px}.photos a{display:block;text-decoration:none}.photo{width:145px;height:105px;object-fit:cover;border:1px solid #dce3eb;border-radius:5px}.empty{color:#7a8795;font-style:italic;padding:8px}.footer{border-top:1px solid #dce3eb;margin-top:20px;padding-top:10px;display:flex;justify-content:space-between;color:#718095;font-size:9px}.footer strong{color:#123f82}.signature{margin-top:14px;text-align:center;color:#718095;font-size:9px}.signature-line{width:220px;border-top:1px solid #9eabb8;margin:0 auto 5px}@media print{.page{max-width:none}.no-print{display:none}}
 </style></head><body><div class="page">
 <header class="header"><div class="brand"><img src="${logo}"><div><div class="brand-title">América <span>List</span></div><div class="subtitle">Assistência 24 Horas - América Assistência</div></div></div><div class="doc"><div class="doc-label">Ordem de Serviço</div><div class="protocol">Protocolo ${esc(o.protocol)}</div></div></header>
 <div class="meta"><div><b>Data e hora da geração:</b> ${esc(o.created)}</div><div><b>Status:</b> ${esc(o.status)}</div></div>
 <section class="section"><h3>Dados do atendimento</h3><div class="grid">${field('Motorista',o.driver)}${field('Placa',o.plate)}${field('Associado',o.assoc)}${field('Tipo de veículo',o.vehicleType)}${field('Modelo do veículo',o.model)}${field('Cor',o.color)}${field('Protocolo',o.protocol)}${field('Quilometragem',o.km)}${field('Local origem',o.origin)}${field('Local destino',o.destination)}</div></section>
 <section class="section"><h3>Condições do veículo</h3><div class="grid">${field('Pneus',o.tires)}${field('Chaves acompanhando',o.keys)}<div class="damage wide"><b>Danos ou Avarias Pré-Existentes:</b><br>${damages}</div></div></section>
 <section class="section"><h3>Checklist</h3><div class="checks">${checklist.map(k=>`<div class="check"><span>${esc(k)}</span><b>${esc(o.checks[k])}</b></div>`).join('')}</div></section>
 <section class="section"><h3>Observações</h3><div class="obs">${esc(o.obs)||'Nenhuma observação registrada.'}</div></section>
 <section class="section"><h3>Assinatura do Associado</h3>${o.signatureData?`<div><img src="${esc(o.signatureData)}" style="max-width:320px;max-height:110px;object-fit:contain;border-bottom:1px solid #9eabb8"></div>`:'<div class="empty">Sem assinatura registrada</div>'}</section><section class="section"><h3>Fotos do atendimento</h3><div class="photos">${photos}</div></section>
 <footer class="footer"><span><strong>América List</strong> • Checklist e Ordem de Serviço</span><span>Assistência 24 Horas - América Assistência</span></footer><div class="signature"><div class="signature-line"></div><div>Desenvolvido pelo Administrativo da Assistência 24 Horas</div></div>
 </div><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),500));<\/script></body></html>`);
 w.document.close();
 w.focus();
}
window.printOrder=printOrder;
function commands(){if(db.user?.role!=='admin')return dashboard();app.innerHTML=`${header()}<main class="wrap commands-wrap">${nav()}<section class="page-hero commands-hero"><div><span class="page-kicker">ADMINISTRAÇÃO</span><h1>Comandos</h1><p>Gerencie os acessos e a equipe da operação.</p></div><div class="page-hero-badge">⚙ <span>Área administrativa</span></div></section><section class="command-grid"><button class="command-card" onclick="manageUsers()"><span class="command-icon blue-icon">♙</span><span><b>Usuários</b><small>Cadastre acessos, altere senhas e níveis de permissão.</small></span><strong>›</strong></button><button class="command-card" onclick="manageDrivers()"><span class="command-icon green-icon">♟</span><span><b>Motoristas</b><small>Cadastre, edite e organize os motoristas da equipe.</small></span><strong>›</strong></button><button class="command-card" onclick="profile()"><span class="command-icon orange-icon">◉</span><span><b>Perfil</b><small>Altere seus próprios dados, nome e foto de perfil.</small></span><strong>›</strong></button></section></main>`;renderThemeButton()}
function profile(){
 if(!db.user)return login();
 const account=db.users.find(u=>u.username.toLowerCase()===String(db.user.username||'').toLowerCase());
 if(!account)return dashboard();
 const linkedDriver=account.role==='motorista'?db.drivers.find(d=>String(d.user||'').toLowerCase()===String(account.username||'').toLowerCase()):null;
 const currentName=account.name||linkedDriver?.name||db.user.name||account.username;
 const currentPhoto=account.photo||db.user.photo||'';
 app.innerHTML=`${header()}<main class="wrap profile-wrap">${nav()}<section class="page-hero profile-hero"><div><span class="page-kicker">MEU PERFIL</span><h1>Perfil</h1><p>Atualize seus próprios dados de acesso e sua identificação.</p></div><div class="profile-role-badge">${roleLabel(account.role)}</div></section><section class="card profile-card"><div class="profile-preview"><div class="profile-avatar" id="profileAvatar">${currentPhoto?`<img src="${currentPhoto}" alt="Foto de perfil">`:'<span>👤</span>'}</div><div><h2>${esc(currentName)}</h2><p class="small">@${esc(account.username)} · ${roleLabel(account.role)}</p><p class="small">Sua foto e seu nome aparecem na identificação do seu perfil.</p></div></div><div class="grid"><div class="field"><label>Nome</label><input id="profileName" value="${esc(currentName)}" placeholder="Seu nome"></div><div class="field"><label>Usuário</label><input value="${esc(account.username)}" readonly><span class="small">O usuário é gerenciado pelo administrador.</span></div><div class="field"><label>Foto de perfil</label><input id="profilePhoto" type="file" accept="image/*"><span class="small">Escolha uma imagem para usar no seu perfil.</span></div></div><div class="row"><button class="btn green" onclick="saveProfile()">Salvar perfil</button><button class="btn gray" onclick="dashboard()">Cancelar</button></div></section></main>`;renderThemeButton();const photoInput=document.getElementById('profilePhoto');photoInput.addEventListener('change',async()=>{const f=photoInput.files?.[0];if(!f)return;document.getElementById('profileAvatar').innerHTML=`<span>Carregando…</span>`;const data=await readFile(f);document.getElementById('profileAvatar').innerHTML=`<img src="${data}" alt="Foto de perfil">`;photoInput.dataset.preview=data})
}
window.saveProfile=()=>{
 const account=db.users.find(u=>u.username.toLowerCase()===String(db.user?.username||'').toLowerCase());
 if(!account)return;
 const name=document.getElementById('profileName').value.trim();
 if(!name){alert('Informe seu nome.');return}
 const photo=document.getElementById('profilePhoto')?.dataset.preview;
 account.name=name;
 if(photo)account.photo=photo;
 if(account.role==='motorista'){
  const linkedDriver=db.drivers.find(d=>String(d.user||'').toLowerCase()===String(account.username||'').toLowerCase());
  if(linkedDriver)linkedDriver.name=name;
 }
 db.user.name=name;db.user.photo=account.photo||'';save();alert('Perfil atualizado com sucesso.');dashboard();
};
function manageDrivers(){app.innerHTML=`${header()}<main class="wrap">${nav()}<section class="card"><h2>Cadastrar Motorista</h2><div class="grid"><div class="field"><label>Nome</label><input id="dname"></div><div class="field"><label>Usuário</label><input id="duser"></div></div><button class="btn green" onclick="addDriver()">Cadastrar Motorista</button></section><section class="card"><h2>Motoristas Cadastrados</h2>${db.drivers.length?`<table class="table"><tr><th>Nome</th><th>Usuário</th><th>Ações</th></tr>${db.drivers.map(d=>`<tr><td>${esc(d.name)}</td><td>${esc(d.user)}</td><td><button class="btn" onclick="editDriver('${d.id}')">Editar</button> <button class="btn red" onclick="deleteDriver('${d.id}')">Excluir</button></td></tr>`).join('')}</table>`:'<div class="notice">Nenhum motorista cadastrado.</div>'}</section></main>`}
window.addDriver=()=>{const n=document.getElementById('dname').value.trim();if(!n)return alert('Informe o nome.');db.drivers.push({id:String(Date.now()),name:n,user:document.getElementById('duser').value.trim()});save();manageDrivers()};window.editDriver=id=>{const d=db.drivers.find(x=>x.id===id);const n=prompt('Nome do motorista:',d.name);if(n!==null&&n.trim()){d.name=n.trim();save();manageDrivers()}};window.deleteDriver=id=>{if(confirm('Excluir este motorista?')){db.drivers=db.drivers.filter(x=>x.id!==id);db.fleet.forEach(v=>{if(v.driverId===id)v.driverId=''});save();manageDrivers()}};
function manageFleet(){app.innerHTML=`${header()}<main class="wrap">${nav()}<section class="card"><h2>Cadastrar Veículo Próprio</h2><div class="grid"><div class="field"><label>Placa</label><input id="fplate"></div><div class="field"><label>Modelo</label><input id="fmodel"></div><div class="field"><label>Caminhão ou Carrocinha</label><select id="ftype">${ownVehicleTypes.map(v=>`<option>${v}</option>`).join('')}</select></div><div class="field"><label>Motorista vinculado</label><select id="fdriver">${driverOptions()}</select></div></div><button class="btn green" onclick="addFleet()">Cadastrar Veículo</button></section><section class="card"><h2>Veículos Próprios Cadastrados</h2>${db.fleet.length?`<table class="table"><tr><th>Placa</th><th>Modelo</th><th>Categoria</th><th>Motorista</th><th>Ações</th></tr>${db.fleet.map(v=>{const d=db.drivers.find(x=>x.id===v.driverId);return `<tr><td>${esc(v.plate)}</td><td>${esc(v.model)}</td><td>${esc(v.type)}</td><td>${esc(d?.name||'-')}</td><td><button class="btn" onclick="editFleet('${v.id}')">Editar</button> <button class="btn red" onclick="deleteFleet('${v.id}')">Excluir</button></td></tr>`}).join('')}</table>`:'<div class="notice">Nenhum veículo próprio cadastrado.</div>'}</section></main>`}
window.addFleet=()=>{const p=document.getElementById('fplate').value.trim();if(!p)return alert('Informe a placa.');db.fleet.push({id:String(Date.now()),plate:p.toUpperCase(),model:document.getElementById('fmodel').value.trim(),type:document.getElementById('ftype').value,driverId:document.getElementById('fdriver').value});save();manageFleet()};window.editFleet=id=>{const v=db.fleet.find(x=>x.id===id);const p=prompt('Placa:',v.plate);if(p!==null&&p.trim())v.plate=p.trim().toUpperCase();const m=prompt('Modelo:',v.model);if(m!==null)v.model=m.trim();const t=prompt('Categoria (Caminhão ou Carrocinha):',v.type);if(t==='Caminhão'||t==='Carrocinha')v.type=t;save();manageFleet()};window.deleteFleet=id=>{if(confirm('Excluir este veículo?')){db.fleet=db.fleet.filter(x=>x.id!==id);save();manageFleet()}};
function roleLabel(role){return role==='admin'?'Administrador':role==='motorista'?'Motorista':'Assistência'}
function manageUsers(){
 if(db.user?.role!=='admin')return dashboard();
 app.innerHTML=`${header()}<main class="wrap">${nav()}<section class="card"><div class="section-head"><div><h2>Cadastrar Usuário</h2><p class="small">Crie acessos e defina o nível de cada usuário.</p></div><button class="btn gray" onclick="commands()">Voltar</button></div><div class="grid"><div class="field"><label>Usuário <span class="req">*</span></label><input id="uname" placeholder="Ex.: joao.silva"></div><div class="field"><label>Nível de acesso <span class="req">*</span></label><select id="urole"><option value="">Selecione o nível</option><option value="motorista">Motorista</option><option value="assistencia">Assistência</option><option value="admin">Administrador</option></select></div><div class="field"><label>Senha <span class="req">*</span></label><input id="upass" type="password" placeholder="Digite a senha"></div></div><button class="btn green" onclick="addUser()">Cadastrar Usuário</button></section><section class="card"><h2>Usuários Cadastrados</h2><p class="small">O administrador pode alterar usuário, senha e nível de acesso a qualquer momento.</p>${db.users.length?`<div style="overflow:auto"><table class="table"><tr><th>Usuário</th><th>Nível de acesso</th><th>Ações</th></tr>${db.users.map(u=>`<tr><td>${esc(u.username)}</td><td><span class="access-pill ${u.role}">${roleLabel(u.role)}</span></td><td><button class="btn" onclick="editUser('${u.id}')">Editar acesso</button> <button class="btn" onclick="changeUserPassword('${u.id}')">Alterar senha</button> <button class="btn red" onclick="deleteUser('${u.id}')" ${u.id==='admin-default'?'disabled':''}>Excluir</button></td></tr>`).join('')}</table></div>`:'<div class="notice">Nenhum usuário cadastrado.</div>'}</section></main>`
}

window.addUser=()=>{
 const username=document.getElementById('uname').value.trim();
 const role=document.getElementById('urole').value;
 const password=document.getElementById('upass').value;
 if(!username||!role||!password){alert('Preencha usuário, nível de acesso e senha.');return}
 if(db.users.some(u=>u.username.toLowerCase()===username.toLowerCase())){alert('Este usuário já está cadastrado.');return}
 db.users.push({id:String(Date.now()),username,role,password});save();manageUsers();
};
window.editUser=id=>{
 const u=db.users.find(x=>x.id===id); if(!u)return;
 app.innerHTML=`${header()}<main class="wrap">${nav()}<section class="card"><div class="section-head"><div><h2>Editar Usuário</h2><p class="small">Altere o nome de acesso e o nível de permissão.</p></div><button class="btn gray" onclick="manageUsers()">Voltar</button></div><div class="grid"><div class="field"><label>Usuário</label><input id="editUname" value="${esc(u.username)}"></div><div class="field"><label>Nível de acesso</label><select id="editUrole"><option value="motorista" ${u.role==='motorista'?'selected':''}>Motorista</option><option value="assistencia" ${u.role==='assistencia'?'selected':''}>Assistência</option><option value="admin" ${u.role==='admin'?'selected':''}>Administrador</option></select></div><div class="field"><label>Nova senha <span class="small">(opcional)</span></label><input id="editUpass" type="password" placeholder="Deixe em branco para manter a atual"></div></div><div class="notice"><b>Nível atual:</b> ${roleLabel(u.role)}. Você pode mudar para Motorista, Assistência ou Administrador.</div><div class="row"><button class="btn green" onclick="saveUserEdit('${u.id}')">Salvar alterações</button><button class="btn" onclick="changeUserPassword('${u.id}')">Alterar somente senha</button></div></section></main>`
};
window.saveUserEdit=id=>{
 const u=db.users.find(x=>x.id===id); if(!u)return;
 const oldUsername=u.username;
 const username=document.getElementById('editUname').value.trim();
 const role=document.getElementById('editUrole').value;
 const pass=document.getElementById('editUpass').value;
 if(!username||!role){alert('Informe o usuário e o nível de acesso.');return}
 if(db.users.some(x=>x.id!==id&&x.username.toLowerCase()===username.toLowerCase())){alert('Este usuário já está cadastrado.');return}
 if(pass&&pass.length<4){alert('A senha deve ter pelo menos 4 caracteres.');return}
 u.username=username;u.role=role;if(pass)u.password=pass;
 if(db.user?.username===oldUsername){db.user.username=u.username;db.user.name=u.name||u.username;db.user.role=u.role;}
 save();manageUsers();
 alert('Usuário atualizado com sucesso.');
};

window.changeUserPassword=id=>{
 if(db.user?.role!=='admin')return dashboard();
 const u=db.users.find(x=>x.id===id); if(!u)return;
 const pass=prompt(`Nova senha para ${u.username}:`,'');
 if(pass===null)return;
 if(pass.length<4){alert('A senha deve ter pelo menos 4 caracteres.');return}
 u.password=pass;save();manageUsers();alert(`Senha do usuário ${u.username} alterada com sucesso.`);
};
window.deleteUser=id=>{if(id==='admin-default')return alert('O usuário administrador padrão não pode ser excluído.');if(confirm('Excluir este usuário?')){db.users=db.users.filter(x=>x.id!==id);save();manageUsers()}};
window.commands=commands;window.logout=()=>{db.user=null;save();login()};
/* ===== ONLINE OVERRIDES ===== */
function appRoleLabel(role){return role==='admin'?'Administrador':role==='assistencia'?'Assistência':'Motorista'}

window.doLogin=async()=>{
  const username=document.getElementById('u').value.trim();
  const password=document.getElementById('p').value;
  if(!username||!password){alert('Informe usuário e senha.');return;}
  const btn=document.querySelector('.login .btn'); if(btn){btn.disabled=true;btn.textContent='Entrando…';}
  try{
    let emailData,emailError;
    ({data:emailData,error:emailError}=await sb.rpc('login_email_by_username',{p_username:username}));
    if(emailError){
      ({data:emailData,error:emailError}=await sb.rpc('get_login_email',{p_username:username}));
      if(emailError) throw emailError;
    }
    const email=emailData || `${username.toLowerCase()}@america-list.local`;
    if(!email) throw new Error('Usuário não encontrado.');
    const {error}=await sb.auth.signInWithPassword({email,password});
    if(error) throw error;
    await loadOnlineData();
    if(!db.user) throw new Error('Perfil do usuário não encontrado ou inativo.');
    dashboard();
  }catch(e){console.error(e);alert(e.message||'Não foi possível entrar.');}
  finally{if(btn){btn.disabled=false;btn.textContent='Entrar';}}
};

function login(){app.innerHTML=`${header()}<main class="wrap"><section class="card login"><img src="assets/logo.png"><h1>Acesso ao América List</h1><div class="field"><label>Usuário</label><input id="u" placeholder="Digite seu usuário" autocomplete="username"></div><div class="field"><label>Senha</label><input id="p" type="password" placeholder="Digite sua senha" autocomplete="current-password" onkeydown="if(event.key==='Enter')doLogin()"></div><button class="btn" onclick="doLogin()">Entrar</button><p class="small">Acesso protegido pelo banco de dados do América List.</p><p class="small">Seu nível de acesso é definido pela conta e não pode ser escolhido na tela de login.</p></section></main>`;renderThemeButton()}

async function refreshOnline(){
  let lastError=null;
  for(let attempt=0; attempt<3; attempt++){
    try{ await loadOnlineData(); return true; }
    catch(e){ lastError=e; if(attempt<2) await new Promise(r=>setTimeout(r,300)); }
  }
  throw lastError||new Error('Não foi possível atualizar os dados online.');
}

window.logout=async()=>{await sb.auth.signOut();db={user:null,orders:[],drivers:[],fleet:[],users:[]};localStorage.removeItem(KEY);login()};

function initSignaturePad(){
 const canvas=document.getElementById('signaturePad');
 if(!canvas)return;
 const resize=()=>{const r=canvas.getBoundingClientRect(),dpr=Math.max(1,window.devicePixelRatio||1);canvas.width=Math.round(r.width*dpr);canvas.height=Math.round(r.height*dpr);const c=canvas.getContext('2d');c.setTransform(dpr,0,0,dpr,0,0);c.lineWidth=2.2;c.lineCap='round';c.lineJoin='round';};
 resize();
 const point=e=>{const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}};
 let drawing=false,last=null;
 canvas.addEventListener('pointerdown',e=>{e.preventDefault();drawing=true;last=point(e);canvas.setPointerCapture?.(e.pointerId)});
 canvas.addEventListener('pointermove',e=>{if(!drawing)return;e.preventDefault();const p=point(e),c=canvas.getContext('2d');c.beginPath();c.moveTo(last.x,last.y);c.lineTo(p.x,p.y);c.stroke();last=p;canvas.dataset.signed='1'});
 const end=()=>{drawing=false;last=null};
 canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);canvas.addEventListener('pointerleave',end);
}
window.clearSignature=()=>{const c=document.getElementById('signaturePad');if(!c)return;const x=c.getContext('2d');x.clearRect(0,0,c.width,c.height);c.dataset.signed='0';};
window.saveOrder=async()=>{
 const required=[['driver','Motorista'],['plate','Placa'],['assoc','Associado'],['vehicleType','Tipo de Veículo'],['model','Modelo do Veículo'],['color','Cor'],['protocol','Protocolo']];
 const missing=required.filter(([id])=>!document.getElementById(id).value.trim()).map(x=>x[1]);
 document.querySelectorAll('.invalid').forEach(x=>x.classList.remove('invalid'));
 if(missing.length){missing.forEach(n=>{const pair=required.find(x=>x[1]===n);document.getElementById(pair[0]).classList.add('invalid')});const v=document.getElementById('validation');v.classList.remove('hidden');v.innerHTML='<b>Preencha os campos obrigatórios:</b> '+missing.join(', ');return;}
 const protocol=document.getElementById('protocol').value.trim();
 if(db.orders.some(x=>String(x.protocol||'').trim().toLowerCase()===protocol.toLowerCase())){const v=document.getElementById('validation');v.classList.remove('hidden');v.innerHTML='<b>Protocolo duplicado.</b> Já existe uma O.S. cadastrada com este protocolo.';document.getElementById('protocol').classList.add('invalid');return;}
 const checks={};document.querySelectorAll('[data-item]').forEach(el=>checks[el.dataset.item]=el.value);
 const damages=[...document.querySelectorAll('input[name="damage"]:checked')].map(x=>x.value);
 const driver=db.drivers.find(d=>d.name===document.getElementById('driver').value);
 if(!driver){alert('Motorista não encontrado no cadastro. Cadastre o motorista antes de abrir a O.S.');return;}
 const signatureCanvas=document.getElementById('signaturePad');
 const signatureData=signatureCanvas && signatureCanvas.dataset.signed==='1' ? signatureCanvas.toDataURL('image/png') : '';
 const signedAt=signatureData?new Date().toISOString():null;
 const payload={driver_id:driver.id,associated_name:document.getElementById('assoc').value.trim(),plate:document.getElementById('plate').value.trim().toUpperCase(),vehicle_type:document.getElementById('vehicleType').value,vehicle_model:document.getElementById('model').value.trim(),vehicle_color:document.getElementById('color').value,protocol,origin:document.getElementById('origin').value.trim()||null,destination:document.getElementById('destination').value.trim()||null,mileage:document.getElementById('km').value===''?null:Number(document.getElementById('km').value),preexisting_damages:damages,tires:document.getElementById('tires').value||null,keys_with:document.getElementById('keys').value||null,checklist:{items:checks,observations:document.getElementById('obs').value||''},status:'Em atendimento',created_by:currentAuthUser.id,signature_data:signatureData||null,signed_at:signedAt};
 const btn=document.querySelector('button[onclick="saveOrder()"]');if(btn){btn.disabled=true;btn.textContent='Salvando…';}
 try{
   const {data,error}=await sb.from('service_orders').insert(payload).select('*,driver:drivers(id,name,user_id)').single();
   if(error) throw error;
   const created=normalizeOrder(data);db.orders=[created,...db.orders.filter(x=>x.id!==created.id)];saveLocal();remoteOnline=true;
   const files=[...document.getElementById('photos').files];
   for(let i=0;i<files.length;i++){
     const f=files[i],safe=f.name.replace(/[^a-zA-Z0-9._-]/g,'_');
     const path=`${currentAuthUser.id}/${created.id}/${Date.now()}-${i}-${safe}`;
     const {error:ue}=await sb.storage.from('os-photos').upload(path,f,{upsert:false,contentType:f.type||'image/jpeg'});if(ue)throw new Error('O.S. salva, mas uma foto não pôde ser enviada: '+ue.message);
     const {error:pe}=await sb.from('os_photos').insert({os_id:created.id,storage_path:path,file_name:f.name,created_by:currentAuthUser.id});if(pe)throw new Error('O.S. salva, mas o registro da foto falhou: '+pe.message);
   }
   await loadPhotos(created.id).catch(()=>{});
   await refreshOnline();
   alert('O.S. criada e atendimento iniciado com sucesso.');
   orders();
 }catch(e){alert(e.message||'Não foi possível salvar a O.S.');}
 finally{if(btn){btn.disabled=false;btn.textContent='Salvar e iniciar atendimento';}}
};
window.finishOrder=async id=>{try{const {error}=await sb.from('service_orders').update({status:'Finalizada',finalized_at:new Date().toISOString()}).eq('id',id);if(error)throw error;await refreshOnline();viewOrder(id)}catch(e){alert(e.message||'Não foi possível finalizar a O.S.');}};
window.problemOrder=async id=>{try{const {error}=await sb.from('service_orders').update({status:'Com problema'}).eq('id',id);if(error)throw error;await refreshOnline();viewOrder(id)}catch(e){alert(e.message||'Não foi possível atualizar a O.S.');}};
window.deleteOrder=async id=>{if(db.user?.role!=='admin')return;const o=db.orders.find(x=>x.id===id);if(!o)return;if(!confirm(`Excluir a O.S. do protocolo ${o.protocol}? Esta ação não pode ser desfeita.`))return;try{const {error}=await sb.from('service_orders').delete().eq('id',id);if(error)throw error;await refreshOnline();orders()}catch(e){alert(e.message||'Não foi possível excluir a O.S.');}};

window.updateOrder=async id=>{
 const req=['driver','plate','assoc','vehicleType','model','color','protocol'];if(req.some(x=>!document.getElementById(x).value.trim())){alert('Preencha todos os campos obrigatórios.');return;}
 const protocol=document.getElementById('protocol').value.trim();if(db.orders.some(x=>x.id!==id&&String(x.protocol||'').trim().toLowerCase()===protocol.toLowerCase())){alert('Protocolo duplicado.');return;}
 const driver=db.drivers.find(d=>d.name===document.getElementById('driver').value);if(!driver){alert('Motorista inválido.');return;}
 const checks={};document.querySelectorAll('[data-item]').forEach(el=>checks[el.dataset.item]=el.value);const damages=[...document.querySelectorAll('input[name="damage"]:checked')].map(x=>x.value);
 const patch={driver_id:driver.id,associated_name:document.getElementById('assoc').value.trim(),plate:document.getElementById('plate').value.trim().toUpperCase(),vehicle_type:document.getElementById('vehicleType').value,vehicle_model:document.getElementById('model').value.trim(),vehicle_color:document.getElementById('color').value,protocol,origin:document.getElementById('origin').value.trim()||null,destination:document.getElementById('destination').value.trim()||null,mileage:document.getElementById('km').value===''?null:Number(document.getElementById('km').value),tires:document.getElementById('tires').value||null,keys_with:document.getElementById('keys').value||null,preexisting_damages:damages,checklist:{items:checks,observations:document.getElementById('obs').value||''}};
 try{const {error}=await sb.from('service_orders').update(patch).eq('id',id);if(error)throw error;await refreshOnline();viewOrder(id)}catch(e){alert(e.message||'Falha ao salvar alterações.');}
};
window.addDriver=async()=>{if(db.user?.role!=='admin')return dashboard();const n=document.getElementById('dname').value.trim(),username=document.getElementById('duser').value.trim();if(!n){alert('Informe o nome.');return;}try{await adminApi('/api/drivers',{method:'POST',body:JSON.stringify({name:n,username})});alert('Motorista cadastrado com sucesso.');await refreshOnline();manageDrivers();}catch(e){alert(e.message||'Não foi possível cadastrar o motorista.');}};
window.editDriver=async id=>{const d=db.drivers.find(x=>x.id===id);if(!d)return;const n=prompt('Nome do motorista:',d.name);if(n===null||!n.trim())return;const currentUser=db.users.find(u=>u.id===d.userId)?.username||'';const username=prompt('Usuário vinculado (deixe vazio para remover vínculo):',currentUser);if(username===null)return;try{await adminApi(`/api/drivers/${id}`,{method:'PATCH',body:JSON.stringify({name:n.trim(),username:username.trim()})});await refreshOnline();manageDrivers();}catch(e){alert(e.message||'Não foi possível atualizar o motorista.');}};
window.deleteDriver=async id=>{if(db.user?.role!=='admin')return;const d=db.drivers.find(x=>x.id===id);if(!d)return;if(!confirm(`Excluir o motorista ${d.name}?`))return;try{await adminApi(`/api/drivers/${id}`,{method:'DELETE'});alert('Motorista excluído com sucesso.');await refreshOnline();manageDrivers();}catch(e){alert(e.message||'Não foi possível excluir o motorista.');}};

function manageDrivers(){if(db.user?.role!=='admin')return dashboard();app.innerHTML=`${header()}<main class="wrap">${nav()}<section class="card"><h2>Cadastrar Motorista</h2><div class="grid"><div class="field"><label>Nome <span class="req">*</span></label><input id="dname"></div><div class="field"><label>Usuário vinculado</label><select id="duser"><option value="">Sem vínculo por enquanto</option>${db.users.filter(u=>u.role==='motorista').map(u=>`<option value="${esc(u.username)}">${esc(u.username)}</option>`).join('')}</select></div></div><button class="btn green" onclick="addDriver()">Cadastrar Motorista</button></section><section class="card"><h2>Motoristas Cadastrados</h2>${db.drivers.length?`<table class="table"><tr><th>Nome</th><th>Vínculo</th><th>Ações</th></tr>${db.drivers.map(d=>`<tr><td>${esc(d.name)}</td><td>${esc(db.users.find(u=>u.id===d.userId)?.username||'—')}</td><td><button class="btn" onclick="editDriver('${d.id}')">Editar</button> <button class="btn red" onclick="deleteDriver('${d.id}')">Excluir</button></td></tr>`).join('')}</table>`:'<div class="notice">Nenhum motorista cadastrado.</div>'}</section></main>`;renderThemeButton();}

/* Perfil online */
window.saveProfile=async()=>{
  if(!currentAuthUser)return;
  const name=document.getElementById('profileName')?.value.trim();
  if(!name){alert('Informe seu nome.');return;}
  const {error}=await sb.from('profiles').update({full_name:name}).eq('id',currentAuthUser.id);
  if(error){alert(error.message);return;}
  await refreshOnline();alert('Perfil atualizado com sucesso.');dashboard();
};
function profile(){
 if(!db.user)return login();
 const account=db.users.find(u=>u.id===currentAuthUser?.id)||{username:db.user.username,name:db.user.name,role:db.user.role,photo:db.user.photo||''};
 app.innerHTML=`${header()}<main class="wrap profile-wrap">${nav()}<section class="page-hero profile-hero"><div><span class="page-kicker">MEU PERFIL</span><h1>Perfil</h1><p>Atualize seus próprios dados de identificação.</p></div><div class="profile-role-badge">${appRoleLabel(account.role)}</div></section><section class="card profile-card"><div class="profile-preview"><div class="profile-avatar">${account.photo?`<img src="${esc(account.photo)}" alt="Foto de perfil">`:'<span>👤</span>'}</div><div><h2>${esc(account.name||db.user.name)}</h2><p class="small">@${esc(account.username||db.user.username)} · ${appRoleLabel(account.role)}</p></div></div><div class="grid"><div class="field"><label>Nome</label><input id="profileName" value="${esc(account.name||db.user.name)}"></div><div class="field"><label>Usuário</label><input value="${esc(account.username||db.user.username)}" readonly></div></div><div class="row"><button class="btn green" onclick="saveProfile()">Salvar perfil</button><button class="btn gray" onclick="dashboard()">Cancelar</button></div></section></main>`;renderThemeButton();
}

/* Usuários: administração real via servidor seguro + Supabase Auth. */
async function adminApi(path, options={}){
 const {data:{session}}=await sb.auth.getSession();
 if(!session?.access_token) throw new Error('Sessão expirada. Faça login novamente.');
 const method=(options.method||'POST').toUpperCase();
 const m=path.match(/^\/api\/(?:admin\/users|drivers)(?:\/([^/]+))?$/);
 if(!m) throw new Error('Operação administrativa não suportada.');
 const parts=path.split('/').filter(Boolean);
 let action='';
 if(parts[1]==='admin'&&parts[2]==='users') action=parts[3]?(method==='DELETE'?'delete_user':'update_user'):'create_user';
 else if(parts[1]==='drivers') action=parts[2]?(method==='DELETE'?'delete_driver':'update_driver'):'create_driver';
 const body=options.body?JSON.parse(options.body):{};
 if(parts[3]) body.id=parts[3];
 const {data,error}=await sb.functions.invoke('admin-users',{body:{action,...body},headers:{Authorization:`Bearer ${session.access_token}`}});
 if(error) throw new Error(error.message||'Falha na função administrativa.');
 if(data?.error) throw new Error(data.error);
 return data;
}
function manageUsers(){
 if(db.user?.role!=='admin')return dashboard();
 app.innerHTML=`${header()}<main class="wrap">${nav()}<section class="card">
 <div class="section-head"><div><h2>Usuários</h2><p class="small">Crie e gerencie contas reais do América List.</p></div><button class="btn gray" onclick="commands()">Voltar</button></div>
 <div class="grid">
  <div class="field"><label>Usuário <span class="req">*</span></label><input id="newUname" placeholder="Ex.: allan"></div>
  <div class="field"><label>Nome completo <span class="req">*</span></label><input id="newUnameFull" placeholder="Nome do usuário"></div>
  <div class="field"><label>Nível de acesso <span class="req">*</span></label><select id="newUrole"><option value="">Selecione</option><option value="motorista">Motorista</option><option value="assistencia">Assistência</option><option value="admin">Administrador</option></select></div>
  <div class="field"><label>Senha <span class="req">*</span></label><input id="newUpass" type="password" placeholder="Mínimo 6 caracteres"></div>
 </div>
 <button class="btn green" onclick="createUserOnline()">Cadastrar Usuário</button>
 <p class="small" style="margin-top:10px">A conta é criada no Supabase Authentication. A senha não é armazenada na tabela do aplicativo.</p>
 </section>
 <section class="card"><h2>Usuários cadastrados</h2>${db.users.length?`<div style="overflow:auto"><table class="table"><tr><th>Usuário</th><th>Nome</th><th>Nível</th><th>Status</th><th>Ações</th></tr>${db.users.map(u=>`<tr><td>${esc(u.username)}</td><td>${esc(u.name||'—')}</td><td><span class="access-pill ${u.role}">${roleLabel(u.role)}</span></td><td>${u.active?'Ativo':'Inativo'}</td><td><button class="btn" onclick="editUser('${u.id}')">Editar</button> <button class="btn red" onclick="deleteUserOnline('${u.id}')" ${u.id===currentAuthUser?.id?'disabled':''}>Excluir</button></td></tr>`).join('')}</table></div>`:'<div class="notice">Nenhum usuário cadastrado.</div>'}</section></main>`;
 renderThemeButton();
}

window.createUserOnline=async()=>{
 const username=document.getElementById('newUname').value.trim();
 const full_name=document.getElementById('newUnameFull').value.trim();
 const role=roleToDb(document.getElementById('newUrole').value);
 const password=document.getElementById('newUpass').value;
 if(!username||!full_name||!role||!password){alert('Preencha todos os campos obrigatórios.');return;}
 if(password.length<6){alert('A senha deve ter pelo menos 6 caracteres.');return;}
 try{await adminApi('/api/admin/users',{method:'POST',body:JSON.stringify({username,full_name,role,password})});alert(`Usuário ${username} cadastrado com sucesso.`);await refreshOnline();manageUsers();}
 catch(e){alert(e.message||'Não foi possível cadastrar o usuário.');}
};

window.editUser=async id=>{
 if(db.user?.role!=='admin')return;
 const u=db.users.find(x=>x.id===id);if(!u)return;
 app.innerHTML=`${header()}<main class="wrap">${nav()}<section class="card"><div class="section-head"><div><h2>Editar Usuário</h2><p class="small">Altere nome, usuário, nível e, se necessário, a senha.</p></div><button class="btn gray" onclick="manageUsers()">Voltar</button></div>
 <div class="grid"><div class="field"><label>Usuário</label><input id="editUname" value="${esc(u.username)}"></div><div class="field"><label>Nome completo</label><input id="editFullName" value="${esc(u.name||'')}"></div><div class="field"><label>Nível de acesso</label><select id="editUrole"><option value="motorista" ${u.role==='motorista'?'selected':''}>Motorista</option><option value="assistencia" ${u.role==='assistencia'?'selected':''}>Assistência</option><option value="admin" ${u.role==='admin'?'selected':''}>Administrador</option></select></div><div class="field"><label>Nova senha <span class="small">(opcional)</span></label><input id="editUpass" type="password" placeholder="Deixe em branco para manter"></div></div>
 <div class="row"><button class="btn green" onclick="saveUserEdit('${id}')">Salvar alterações</button><button class="btn gray" onclick="manageUsers()">Cancelar</button></div></section></main>`;renderThemeButton();
};

window.saveUserEdit=async id=>{
 const username=document.getElementById('editUname').value.trim();
 const full_name=document.getElementById('editFullName').value.trim();
 const role=roleToDb(document.getElementById('editUrole').value);
 const password=document.getElementById('editUpass').value;
 if(!username||!full_name||!role){alert('Preencha os campos obrigatórios.');return;}
 try{
  const result=await adminApi(`/api/admin/users/${id}`,{method:'PATCH',body:JSON.stringify({username,full_name,role,password})});
  const u=db.users.find(x=>x.id===id);
  if(u){u.username=username;u.name=full_name;u.role=roleToApp(role);u.active=true;}
  if(currentAuthUser?.id===id){
    db.user.username=username; db.user.name=full_name; db.user.role=roleToApp(role);
  }
  saveLocal();
  alert('Usuário atualizado com sucesso.');
  manageUsers();
  setTimeout(()=>refreshOnline().catch(e=>console.warn('Sincronização de usuário:',e)),300);
}catch(e){alert(e.message||'Não foi possível atualizar o usuário.');}
};

window.deleteUserOnline=async id=>{
 if(db.user?.role!=='admin'||id===currentAuthUser?.id)return;
 const u=db.users.find(x=>x.id===id);if(!u)return;
 if(!confirm(`Excluir o usuário ${u.username}? A conta de acesso será removida.`))return;
 try{await adminApi(`/api/admin/users/${id}`,{method:'DELETE'});alert('Usuário excluído com sucesso.');await refreshOnline();manageUsers();}
 catch(e){alert(e.message||'Não foi possível excluir o usuário.');}
};

/* Realtime: sincroniza O.S., usuários e motoristas sem precisar trocar de versão. */
let realtimeChannels=[];
function startRealtime(){
  realtimeChannels.forEach(ch=>sb.removeChannel(ch));
  realtimeChannels=[];
  const refreshAndRender=async(type)=>{
    if(!currentAuthUser)return;
    try{
      await loadOnlineData();
      if(type==='orders'){
        if(document.querySelector('.dashboard-wrap')) dashboard();
        else if(document.querySelector('.results-panel')) orders();
      } else if(type==='profiles' && document.querySelector('.card')) {
        if(document.querySelector('.commands-wrap')) commands();
        else if(document.querySelector('.profile-card')) profile();
        else if(document.querySelector('.card') && document.querySelector('h2')?.textContent?.includes('Usuários')) manageUsers();
      } else if(type==='drivers') {
        if(document.querySelector('.commands-wrap')) commands();
        else if(document.querySelector('.card') && document.querySelector('h2')?.textContent?.includes('Motoristas')) manageDrivers();
        else if(document.querySelector('.dashboard-wrap')) dashboard();
      }
    } catch(e){console.error('Falha na sincronização em tempo real:',e);}
  };
  for(const [table,type] of [['service_orders','orders'],['profiles','profiles'],['drivers','drivers']]){
    const ch=sb.channel(`america-list-live-${type}`)
      .on('postgres_changes',{event:'*',schema:'public',table},()=>refreshAndRender(type))
      .subscribe();
    realtimeChannels.push(ch);
  }
}

/* Atualiza a tela depois de qualquer alteração remota. */
async function syncAndShow(renderFn){
  try { await loadOnlineData(); renderFn(); }
  catch(e){ console.error(e); alert(`A operação foi concluída, mas a tela não conseguiu atualizar: ${e.message||e}`); renderFn(); }
}

/* O login agora depende do Auth real; não existe mais seletor de perfil. */
(async()=>{applyTheme(localStorage.getItem(THEME_KEY)||'light');try{const ok=await initializeOnlineDatabase();if(ok){startRealtime();dashboard()}else login();}catch(e){console.error(e);login()}renderThemeButton();})();

