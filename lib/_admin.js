import { createClient } from '@supabase/supabase-js';

export function getClients(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const anon = process.env.SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!process.env.SUPABASE_URL || !anon || !service) throw new Error('Faltan variables de Supabase.');
  return {
    token,
    userClient: createClient(process.env.SUPABASE_URL, anon, { global:{headers:{Authorization:`Bearer ${token}`}} }),
    adminClient: createClient(process.env.SUPABASE_URL, service)
  };
}

export async function requireControl(req) {
  const { token, adminClient } = getClients(req);
  if (!token) throw Object.assign(new Error('No autenticado.'), { status:401 });

  const { data:{user}, error:userError } = await adminClient.auth.getUser(token);
  if (userError || !user) throw Object.assign(new Error('Sesión inválida.'), { status:401 });

  const { data:profile, error } = await adminClient
    .from('perfiles')
    .select('id,rol,activo')
    .eq('id',user.id)
    .maybeSingle();

  if (error) throw Object.assign(new Error(error.message), { status:500 });
  if (!profile || !['control','control_escolar'].includes(profile.rol) || !profile.activo) {
    throw Object.assign(new Error('Permiso de Control Escolar requerido.'), { status:403 });
  }
  return { user, profile, userClient:null, adminClient };
}

export async function requireRoles(req, roles=[]) {
 const {token,adminClient}=getClients(req); if(!token) throw Object.assign(new Error('No autenticado.'),{status:401});
 const {data:{user},error}=await adminClient.auth.getUser(token); if(error||!user) throw Object.assign(new Error('Sesión inválida.'),{status:401});
 const {data:profile,error:pe}=await adminClient.from('perfiles').select('id,rol,activo,nombre_completo,correo').eq('id',user.id).maybeSingle();
 if(pe) throw Object.assign(new Error(pe.message),{status:500});
 if(!profile||!profile.activo||!roles.includes(profile.rol)) throw Object.assign(new Error('Permiso insuficiente.'),{status:403});
 return {user,profile,adminClient};
}
