import { createClient } from '@supabase/supabase-js';
import { getClients } from '../lib/_admin.js';
import { getInstitution } from './institution.js';

function validEmail(x){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(x||'').trim());
}

async function login(req,res){
  const {identificador, password}=req.body||{};
  if(!identificador||!password) return res.status(400).json({ok:false,error:'Usuario y contraseña son obligatorios.'});
  const url=process.env.SUPABASE_URL;
  const anon=process.env.SUPABASE_ANON_KEY;
  const secret=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
  if(!url||!anon||!secret) return res.status(500).json({ok:false,error:'Faltan variables de Supabase.'});
  const admin=createClient(url,secret), client=createClient(url,anon);
  const alias=String(identificador).trim().toLowerCase();
  const {data:profiles,error:pe}=await admin.from('perfiles').select('id,correo,correo_recuperacion,rol,activo').eq('correo',alias).limit(1);
  if(pe) throw pe;
  const profile=profiles?.[0];
  if(!profile) return res.status(401).json({ok:false,error:'Usuario o contraseña incorrectos.'});
  if(!profile.activo) return res.status(403).json({ok:false,error:'Tu usuario está inactivo.'});
  const {data:u,error:ue}=await admin.auth.admin.getUserById(profile.id);
  if(ue||!u?.user?.email) return res.status(401).json({ok:false,error:'La cuenta no está disponible.'});
  const {data,error}=await client.auth.signInWithPassword({email:u.user.email,password});
  if(error) return res.status(401).json({ok:false,error:'Usuario o contraseña incorrectos.'});
  return res.status(200).json({ok:true,session:data.session,user:data.user,profile});
}

async function recovery(req,res){
  const {identificador,redirectTo}=req.body||{};
  const alias=String(identificador||'').trim().toLowerCase();
  if(!alias) return res.status(400).json({ok:false,error:'Escribe tu usuario institucional.'});
  const url=process.env.SUPABASE_URL;
  const anon=process.env.SUPABASE_ANON_KEY;
  const secret=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY;
  if(!url||!anon||!secret) return res.status(500).json({ok:false,error:'Faltan variables de Supabase.'});
  const admin=createClient(url,secret), client=createClient(url,anon);
  const {data:p,error:pe}=await admin.from('perfiles').select('id,correo,correo_recuperacion,activo').eq('correo',alias).maybeSingle();
  if(pe) throw pe;
  if(!p||!p.activo||!p.correo_recuperacion) return res.status(200).json({ok:true,message:'Si el usuario existe y tiene correo de recuperación configurado, recibirás las instrucciones.'});
  const {data:u,error:ue}=await admin.auth.admin.getUserById(p.id);
  if(ue||!u?.user?.email) throw ue||new Error('Cuenta no disponible.');
  const institution=await getInstitution(admin); const domain=String(institution.dominio_institucional||'ithla.edu.mx').replace(/^@/,'').trim(); const {error}=await client.auth.resetPasswordForEmail(u.user.email,{redirectTo:redirectTo||process.env.PASSWORD_RESET_REDIRECT_URL||`https://${domain}/`});
  if(error) throw error;
  return res.status(200).json({ok:true,message:'Se enviaron las instrucciones al correo de recuperación registrado.'});
}

async function firstAccess(req,res){
  const {token,adminClient}=getClients(req);
  if(!token) return res.status(401).json({ok:false,error:'No autenticado.'});

  const {data:{user},error:ue}=await adminClient.auth.getUser(token);
  if(ue||!user) return res.status(401).json({ok:false,error:'La sesión expiró. Vuelve a iniciar sesión.'});

  const body=req.body||{};
  const recovery=String(body.recovery_email||'').trim().toLowerCase();
  const newPassword=String(body.password||'');
  const currentPassword=String(body.current_password||'');

  if(!validEmail(recovery)) return res.status(400).json({ok:false,error:'Escribe un correo de recuperación válido.'});
  if(newPassword && newPassword.length<8) return res.status(400).json({ok:false,error:'La contraseña debe tener al menos 8 caracteres.'});

  const {data:profile,error:pe}=await adminClient
    .from('perfiles')
    .select('id,correo,correo_recuperacion,correo_auth,rol,activo')
    .eq('id',user.id)
    .maybeSingle();

  if(pe) return res.status(500).json({ok:false,error:pe.message});
  if(!profile||!profile.activo) return res.status(403).json({ok:false,error:'Perfil no disponible o inactivo.'});

  const authEmail=(user.email||profile.correo_auth||profile.correo||'').toLowerCase();
  if(!authEmail) return res.status(400).json({ok:false,error:'La cuenta no tiene un correo de acceso válido.'});

  const mustChangePassword=Boolean(user.user_metadata?.must_change_password);
  if(mustChangePassword && !newPassword){
    return res.status(400).json({ok:false,error:'Tu cuenta tiene una contraseña temporal. Debes definir una nueva contraseña antes de continuar.'});
  }

  if(!newPassword){
    if(!currentPassword) return res.status(400).json({ok:false,error:'Escribe tu contraseña actual para confirmar el cambio.'});
    const anon=process.env.SUPABASE_ANON_KEY;
    const url=process.env.SUPABASE_URL;
    if(!url||!anon) return res.status(500).json({ok:false,error:'Faltan variables de Supabase.'});
    const client=createClient(url,anon);
    const {error:loginError}=await client.auth.signInWithPassword({email:authEmail,password:currentPassword});
    if(loginError) return res.status(400).json({ok:false,error:'La contraseña actual no es correcta.'});
  }

  const metadata={
    ...(user.user_metadata||{}),
    recovery_email:recovery,
    must_change_password:false,
    login_email:profile.correo
  };

  const patch={email:recovery,email_confirm:true,user_metadata:metadata};
  if(newPassword) patch.password=newPassword;

  // Primero persistimos el dato institucional y después cambiamos Auth.
  // Así evitamos dejar auth.users apuntando al correo de recuperación si
  // la actualización del perfil falla. Si Auth falla, revertimos el perfil.
  const {data:previousProfile,error:prevErr}=await adminClient
    .from('perfiles')
    .select('correo_recuperacion,correo_auth')
    .eq('id',user.id)
    .maybeSingle();
  if(prevErr) return res.status(500).json({ok:false,error:prevErr.message});

  const {error:pr}=await adminClient.from('perfiles').update({
    correo_recuperacion:recovery,
    correo_auth:recovery
  }).eq('id',user.id);
  if(pr) return res.status(400).json({ok:false,error:pr.message});

  const {data:updated,error:ae}=await adminClient.auth.admin.updateUserById(user.id,patch);
  if(ae){
    await adminClient.from('perfiles').update({
      correo_recuperacion:previousProfile?.correo_recuperacion||null,
      correo_auth:previousProfile?.correo_auth||null
    }).eq('id',user.id);
    return res.status(400).json({ok:false,error:ae.message});
  }

  const anon=process.env.SUPABASE_ANON_KEY;
  const url=process.env.SUPABASE_URL;
  if(!url||!anon) return res.status(500).json({ok:false,error:'Faltan variables de Supabase.'});
  const client=createClient(url,anon);
  const passwordForReauth=newPassword||currentPassword;
  const {data:reauth,error:re}=await client.auth.signInWithPassword({email:recovery,password:passwordForReauth});
  if(re||!reauth?.session){
    return res.status(200).json({
      ok:true,
      needs_relogin:true,
      message:'Los datos se guardaron correctamente. Cierra sesión y vuelve a entrar con tu usuario institucional.',
      user:updated?.user||user
    });
  }

  return res.status(200).json({
    ok:true,
    message:'Acceso configurado correctamente.',
    session:reauth.session,
    user:updated?.user||user
  });
}

async function getMe(req,res) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token) return res.status(401).json({ ok:false, error:'No autenticado.' });

    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
    if (!process.env.SUPABASE_URL || !serviceKey) {
      return res.status(500).json({ ok:false, error:'Falta SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY en Vercel.' });
    }

    // Validamos el JWT en el servidor usando la clave privilegiada.
    // La clave secreta nunca se envía al navegador.
    const admin = createClient(process.env.SUPABASE_URL, serviceKey);
    const { data:{ user }, error:userError } = await admin.auth.getUser(token);
    if (userError || !user) {
      return res.status(401).json({ ok:false, error:'Sesión inválida.', detail:userError?.message || null });
    }

    const { data:profile, error:profileError } = await admin
      .from('perfiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) return res.status(500).json({ ok:false, error:profileError.message });
    if (!profile) return res.status(403).json({ ok:false, error:'Tu cuenta no tiene un perfil en ITHLA.' });
    if (!profile.activo) return res.status(403).json({ ok:false, error:'Tu perfil está desactivado.' });

    let alumno = null;
    if (profile.rol === 'alumno') {
      const { data, error: alumnoError } = await admin
        .from('alumnos')
        .select('id,matricula,nombre_completo,activo,suspension_fecha,suspension_hasta,suspension_motivo,suspension_observaciones,revision_acceso_estado,grupo_id,grupos(id,clave,grado,letra)')
        .eq('auth_user_id', user.id)
        .maybeSingle();
      if (alumnoError) return res.status(500).json({ ok:false, error:alumnoError.message });
      alumno = data || null;
      if (!alumno) {
        const alias=String(profile.correo||user.email||'').split('@')[0].toLowerCase();
        const fallback=await admin.from('alumnos').select('id,matricula,nombre_completo,activo,suspension_fecha,suspension_hasta,suspension_motivo,suspension_observaciones,revision_acceso_estado,grupo_id,grupos(id,clave,grado,letra)').ilike('matricula',alias).maybeSingle();
        if (fallback.error) return res.status(500).json({ok:false,error:fallback.error.message});
        alumno=fallback.data||null;
      }
    }

    if (alumno) {
      const [gq,sq,wq,rq]=await Promise.all([
        admin.from('calificaciones').select('calificacion').eq('alumno_id',alumno.id),
        admin.from('horarios').select('id,grupo_materias!inner(grupo_id)').eq('grupo_materias.grupo_id',alumno.grupo_id),
        admin.from('inscripciones_talleres').select('id,taller_id,ciclo_escolar,estado,fecha_inscripcion,talleres(id,nombre,descripcion)').eq('alumno_id',alumno.id).order('id',{ascending:false}),
        admin.from('solicitudes_taller').select('id,taller_actual_id,taller_solicitado_id,motivo,estado,created_at,taller_solicitado:talleres!taller_solicitado_id(id,nombre)').eq('alumno_id',alumno.id).order('id',{ascending:false}).limit(10)
      ]);
      for(const q of [gq,sq,wq,rq]) if(q.error) return res.status(500).json({ok:false,error:q.error.message});
      const vals=(gq.data||[]).map(x=>Number(x.calificacion)).filter(Number.isFinite);
      alumno.promedio_calculado=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;
      alumno.horas_clase_semana=(sq.data||[]).length;
      alumno.suspendido=!!(alumno.suspension_fecha||alumno.suspension_motivo);
      alumno.talleres=wq.data||[];
      alumno.solicitudes_taller=rq.data||[];
    }
    return res.status(200).json({ ok:true, user, profile, ...(alumno || {}) , suspendido: !!(alumno?.suspension_fecha || alumno?.suspension_motivo) });
  } catch (e) {
    return res.status(500).json({ ok:false, error:e.message || 'Error interno.' });
  }
}


function publicConfig(req,res){
  res.setHeader('Cache-Control','no-store');
  if(!process.env.SUPABASE_URL||!process.env.SUPABASE_ANON_KEY){
    return res.status(500).json({ok:false,error:'Faltan SUPABASE_URL y SUPABASE_ANON_KEY en las variables de entorno de Vercel.'});
  }
  return res.status(200).json({ok:true,url:process.env.SUPABASE_URL,anonKey:process.env.SUPABASE_ANON_KEY});
}


export default async function handler(req,res){
  try{
    if(req.method==='GET'){
      const mode=String(req.query?.mode||'').trim().toLowerCase();
      if(mode==='config') return publicConfig(req,res);
      if(mode==='me') return await getMe(req,res);
      return res.status(400).json({ok:false,error:'Modo de consulta no válido.'});
    }
    if(req.method!=='POST') return res.status(405).json({ok:false,error:'Método no permitido.'});
    const action=String(req.body?.action||'').trim().toLowerCase();
    if(action==='login') return await login(req,res);
    if(action==='recovery') return await recovery(req,res);
    if(action==='first_access') return await firstAccess(req,res);
    return res.status(400).json({ok:false,error:'Acción de autenticación no válida.'});
  }catch(e){
    return res.status(e?.status||500).json({ok:false,error:e?.message||'Error de autenticación.'});
  }
}
