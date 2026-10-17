/** Jaguar Classroom OAuth, etapa 2. Solo servidor. No exportar tokens al navegador. */
import {createHmac,randomBytes,createCipheriv,createDecipheriv,timingSafeEqual} from 'node:crypto';

export const GOOGLE_SCOPES=['openid','email','https://www.googleapis.com/auth/classroom.courses.readonly','https://www.googleapis.com/auth/classroom.courses','https://www.googleapis.com/auth/classroom.topics','https://www.googleapis.com/auth/classroom.coursework.students.readonly','https://www.googleapis.com/auth/classroom.rosters.readonly'];
export const GOOGLE_CONN_KEY='servicios_docentes';
export const COOKIE_NAME='jaguar_google_oauth';
const invalid=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const cfg=(key)=>String(process.env[key]||'').trim();
export function googleConfig(){
 const clientId=cfg('GOOGLE_OAUTH_CLIENT_ID'),clientSecret=cfg('GOOGLE_OAUTH_CLIENT_SECRET');
 const redirectUri=cfg('GOOGLE_OAUTH_REDIRECT_URI'),ownerEmail=cfg('GOOGLE_SERVICIOS_EMAIL').toLowerCase();
 const stateSecret=cfg('GOOGLE_OAUTH_STATE_SECRET'),cryptoKey=cfg('GOOGLE_TOKEN_KEY');
 if(!clientId||!clientSecret||!redirectUri||!ownerEmail||!stateSecret||!cryptoKey)invalid('Falta configurar la conexión Google en las variables privadas de Vercel.',503);
 if(stateSecret.length<32)invalid('GOOGLE_OAUTH_STATE_SECRET debe contener al menos 32 caracteres.',503);
 if(!/^\S+@\S+\.\S+$/.test(ownerEmail))invalid('GOOGLE_SERVICIOS_EMAIL no es válido.',503);
 let url;try{url=new URL(redirectUri);}catch{invalid('GOOGLE_OAUTH_REDIRECT_URI es inválida.',503);}
 if(url.protocol!=='https:'||url.pathname!=='/api/google-oauth-callback'||url.search||url.hash||url.username||url.password)invalid('Usa la URI HTTPS exacta /api/google-oauth-callback.',503);
 const key=Buffer.from(cryptoKey,'base64');
 if(key.length!==32)invalid('GOOGLE_TOKEN_KEY debe ser una clave de 32 bytes codificada en Base64.',503);
 return {clientId,clientSecret,redirectUri,ownerEmail,stateSecret,key,origin:url.origin};
}
const b64=(b)=>Buffer.from(b).toString('base64url');
const hmac=(payload,secret)=>b64(createHmac('sha256',secret).update(payload).digest());
function eq(a,b){const aa=Buffer.from(String(a)),bb=Buffer.from(String(b));return aa.length===bb.length&&timingSafeEqual(aa,bb);}
export function signState(userId,secret,now=Date.now()){
 const nonce=b64(randomBytes(24));
 const data=b64(JSON.stringify({u:userId,n:nonce,t:now}));
 return {state:`${data}.${hmac(data,secret)}`,nonce};
}
export function verifyState(state,cookieNonce,secret,now=Date.now()){
 if(!state||String(state).length>1500||!cookieNonce)invalid('Sesión de autorización no encontrada. Vuelve a conectar Google.',403);
 const parts=String(state).split('.');
 if(parts.length!==2||!eq(parts[1],hmac(parts[0],secret)))invalid('Autorización Google inválida.',403);
 let d;try{d=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));}catch{invalid('Autorización Google ilegible.',403);}
 if(!d.u||!eq(d.n,cookieNonce)||!Number.isSafeInteger(d.t)||d.t>now+60_000||now-d.t>10*60_000)invalid('La autorización caducó o no coincide con este navegador.',403);
 return d.u;
}
export function seal(secretText,key){
 if(typeof secretText!=='string'||!secretText)invalid('Google no proporcionó un token utilizable.',502);
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
 const body=Buffer.concat([cipher.update(secretText,'utf8'),cipher.final()]);
 return `g1.${b64(iv)}.${b64(cipher.getAuthTag())}.${b64(body)}`;
}
export function unseal(stored,key){
 const parts=String(stored||'').split('.');if(parts.length!==4||parts[0]!=='g1')invalid('La conexión Google guardada es inválida. Reconéctala.',409);
 try{const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(parts[1],'base64url'));
  decipher.setAuthTag(Buffer.from(parts[2],'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(parts[3],'base64url')),decipher.final()]).toString('utf8');
 }catch{invalid('No se pudo descifrar la conexión Google. Comprueba GOOGLE_TOKEN_KEY.',503);}
}
export function authUrl(config,state){
 const u=new URL('https://accounts.google.com/o/oauth2/v2/auth');
 for(const [k,v] of Object.entries({client_id:config.clientId,redirect_uri:config.redirectUri,response_type:'code',scope:GOOGLE_SCOPES.join(' '),state,access_type:'offline',prompt:'select_account consent',login_hint:config.ownerEmail}))u.searchParams.set(k,v);
 return u.href;
}
export function setNonceCookie(res,nonce,config){
 res.setHeader('Set-Cookie',`${COOKIE_NAME}=${encodeURIComponent(nonce)}; HttpOnly; Secure; SameSite=Lax; Path=/api/google-oauth-callback; Max-Age=600`);
 res.setHeader('Cache-Control','no-store');
}
export function clearNonceCookie(res){res.setHeader('Set-Cookie',`${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/api/google-oauth-callback; Max-Age=0`);res.setHeader('Cache-Control','no-store');}
export function nonceCookie(req){const header=String(req.headers.cookie||'');const found=header.split(';').map(v=>v.trim()).find(s=>s.startsWith(`${COOKIE_NAME}=`));return found?decodeURIComponent(found.slice(COOKIE_NAME.length+1)):null;}
async function googleJson(url,options={}){
 let response;try{response=await fetch(url,{...options,signal:AbortSignal.timeout(15000)});}catch{invalid('Google no respondió a tiempo. Inténtalo de nuevo.',502);}
 const body=await response.json().catch(()=>({}));
 if(!response.ok){
  // No propagamos respuestas completas de Google, pues pueden contener información privada.
  if(response.status===401||body.error==='invalid_grant')invalid('Google requiere reconectar la cuenta de Servicios Docentes.',409);
  if(response.status===403){
   // Mostrar una explicación verificable, sin propagar mensajes privados de Google.
   const reasons=JSON.stringify(body.error?.details||[]);
   const desc=String(body.error?.message||'');
   if(/ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient[_\s-]*(?:authentication[_\s-]*)?scopes?|insufficientPermissions/i.test(reasons+' '+desc))
    invalid('Google rechazó esta consulta por permisos OAuth insuficientes. Revisa el acceso concedido a Classroom y vuelve a autorizar si faltan permisos.',403);
   invalid('Google rechazó acceder a este recurso de Classroom. Comprueba el acceso de la cuenta al curso y los permisos de la API.',403);
  }
  invalid('Google no completó la operación solicitada.',502);
 }
 return body;
}
export function tokenExchange(config,code){
 if(!code||String(code).length>3000)invalid('Código OAuth no válido.');
 const params=new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,code,redirect_uri:config.redirectUri,grant_type:'authorization_code'});
 return googleJson('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:params});
}
export function refreshGoogleToken(config,refreshToken){
 const params=new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,refresh_token:refreshToken,grant_type:'refresh_token'});
 return googleJson('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:params});
}
export function googleIdentity(token){return googleJson('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:`Bearer ${token}`}});}
export async function readConnection(db){const {data,error}=await db.from('jaguar_google_conexiones').select('*').eq('clave',GOOGLE_CONN_KEY).maybeSingle();if(error){if(/jaguar_google_conexiones|schema cache|does not exist|relation/i.test(error.message||''))invalid('Instala primero la migración SQL de OAuth V5.7 en Supabase.',409);invalid('No se pudo consultar la conexión de Google.',502);}return data;}
export async function googleAccess(db,config){
 const row=await readConnection(db);if(!row||!row.refresh_token_cifrado)invalid('Servicios Docentes debe conectar primero su cuenta Google.',409);
 if(row.correo?.toLowerCase()!==config.ownerEmail)invalid('La cuenta conectada no corresponde al Gmail configurado.',409);
 const expiry=new Date(row.expires_at||0).getTime();
 if(row.access_token_cifrado&&expiry>Date.now()+90_000)return unseal(row.access_token_cifrado,config.key);
 const next=await refreshGoogleToken(config,unseal(row.refresh_token_cifrado,config.key));
 if(!next.access_token)invalid('Google no devolvió un token de acceso.',502);
 const updates={access_token_cifrado:seal(next.access_token,config.key),expires_at:new Date(Date.now()+Number(next.expires_in||3600)*1000).toISOString(),actualizado_at:new Date().toISOString()};
 const {error}=await db.from('jaguar_google_conexiones').update(updates).eq('clave',GOOGLE_CONN_KEY);
 if(error)invalid('No se pudo guardar la renovación de Google.',502);
 return next.access_token;
}
export async function googleCourses(token){
 const courses=[];let pageToken='';
 for(let page=0;page<15;page++){
  const url=new URL('https://classroom.googleapis.com/v1/courses');
  // Sin teacherId: devuelve las clases accesibles para la cuenta autorizada,
  // sin excluir cursos donde la cuenta tiene acceso por un rol diferente.
  // La asociación a la materia y grupo siempre requiere revisión humana.
  url.searchParams.set('pageSize','100');
  if(pageToken)url.searchParams.set('pageToken',pageToken);
  const data=await googleJson(url.href,{headers:{Authorization:`Bearer ${token}`}});
  courses.push(...(data.courses||[]));
  if(!data.nextPageToken)return courses;
  pageToken=data.nextPageToken;
 }
 invalid('La cuenta tiene demasiadas clases para esta consulta; consulta a soporte antes de sincronizar.',409);
}
/** Crea exclusivamente una clase PROVISIONED. La cuenta Gmail dueña debe activarla después. */
export async function googleCreateCourse(token,payload){
 const data=await googleJson('https://classroom.googleapis.com/v1/courses',{
  method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(payload)
 });
 if(!data.id||!data.name)invalid('Google no devolvió los datos de la clase creada. Consulta Classroom antes de repetir.',502);
 return data;
}
export function projectCourse(course){return {id:String(course.id||''),nombre:String(course.name||''),seccion:String(course.section||''),descripcion:String(course.descriptionHeading||''),codigo:String(course.enrollmentCode||''),enlace:String(course.alternateLink||''),estado:String(course.courseState||''),owner_id:String(course.ownerId||'')};}

/** Classroom topics/work/submissions are read through the institution owner only. */
async function googlePaged(token,path,collection,{maxPages=15}={}){
 const results=[];let next='';
 for(let i=0;i<maxPages;i++){
  const url=new URL('https://classroom.googleapis.com/v1/'+path);
  url.searchParams.set('pageSize','100');if(next)url.searchParams.set('pageToken',next);
  const data=await googleJson(url.href,{headers:{Authorization:`Bearer ${token}`}});
  results.push(...(data[collection]||[]));
  if(results.length>2500)invalid('La consulta excede el límite seguro de registros por curso.',409);
  if(!data.nextPageToken)return results;
  next=data.nextPageToken;
 }
 invalid('Classroom devolvió demasiadas páginas. No se calcularán resultados parciales.',409);
}
const coursePath=id=>{const s=String(id||'');if(!/^[a-zA-Z0-9_-]{4,70}$/.test(s))invalid('ID de Google Classroom inválido.');return encodeURIComponent(s);};
export function googleTopics(token,courseId){return googlePaged(token,`courses/${coursePath(courseId)}/topics`,'topic');}
export function googleWork(token,courseId){return googlePaged(token,`courses/${coursePath(courseId)}/courseWork`,'courseWork');}
export function googleSubmissions(token,courseId){return googlePaged(token,`courses/${coursePath(courseId)}/courseWork/-/studentSubmissions`,'studentSubmissions');}
export function googleStudents(token,courseId){return googlePaged(token,`courses/${coursePath(courseId)}/students`,'students');}
export async function googleMakeTopic(token,courseId,name){
 const label=String(name||'').trim();if(!label||label.length>100)invalid('Nombre de tema inválido.');
 return googleJson(`https://classroom.googleapis.com/v1/courses/${coursePath(courseId)}/topics`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({name:label})});
}
