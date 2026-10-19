/**
 * NEXO: barrera de procedimientos de acceso NO verificados.
 * Evidencia: Jaguar index.html, formulario loginEmail (Correo institucional)
 * y loginPassword (Contraseña); NO existe en esa pantalla un registro de
 * visitantes por teléfono ni verificación SMS.
 *
 * Importante: NO garantiza que una IA nunca alucine. Reduce un caso crítico
 * de instrucciones inventadas; no autoriza al modelo a actuar sobre datos.
 */
const normalize = value => String(value || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();

export function publicJaguarAccessAnswer(message, trustedContext = {}) {
  if (trustedContext.aplicacion !== 'jaguar' || trustedContext.session_verificada === true) return null;
  const s = normalize(message);
  // Solo preguntas sobre acceso de usuarios, no sobre cómo funciona el código.
  const aboutAccount = /\b(correo|email|usuario|cuenta|visitante|sms|telefono|iniciar sesion|sesion|ingresar|entrar|acceder|acceso|registrar|registro|contrase)/.test(s);
  const aboutAccess = /\b(puedo|como|sin|necesito|quiero|obtener|crear|existe|hay|tiene|regist|ingreso|ingresar|entrar|acceder|acceso|visitar|recuper|inicio|iniciar|login)/.test(s);
  if (!aboutAccount || !aboutAccess) return null;
  const recovery = /olvid|recuper|restablec/.test(s);
  if (recovery) return {
    encontrado:true,modo:'manual',
    respuesta:'🔐 En la pantalla de inicio de sesión de Jaguar existe la opción **«¿Olvidaste tu contraseña?»**. Utiliza esa opción para iniciar la recuperación de tu acceso. No escribas tu contraseña ni datos personales en este chat.',
    fuentes:[{fuente:'index.html — acceso de Plataforma Jaguar',guia:'acceso-institucional-verificado'}]
  };
  const noEmail = /sin (?:un |mi |el )?(?:correo|email)|no (?:tengo|cuento con|dispongo de).*?(?:correo|cuenta)|visitante|cuenta temporal|acceso publico|por telefono|sms|codigo de verificacion/.test(s);
  return {
    encontrado:true,modo:'manual',
    respuesta: noEmail
      ? '🔐 La pantalla de acceso de **Plataforma Jaguar** que tenemos documentada solicita **correo institucional y contraseña**. No tengo confirmado un registro de visitantes por teléfono, cuentas temporales ni códigos SMS. Si aún no tienes credenciales, solicita orientación al área responsable de tu acceso institucional. 💛'
      : '🔐 Para iniciar sesión en **Plataforma Jaguar**, utiliza el formulario de acceso con tu **correo institucional y contraseña**. Si no cuentas con credenciales, consulta con el área responsable de tu acceso. No compartas contraseñas por el chat. 💛',
    fuentes:[{fuente:'index.html — acceso de Plataforma Jaguar',guia:'acceso-institucional-verificado'}]
  };
}

// Respuestas peligrosas específicas detectadas en producción. No se admite
// que la IA invente mecanismos de acceso públicos no implementados en Jaguar.
export function inventedPublicAccessClaim(reply, trustedContext = {}) {
 if(trustedContext.aplicacion !== 'jaguar' || trustedContext.session_verificada === true) return false;
 const s=normalize(reply);
 return /(?:ingresar|ingresa|entrar|entra|acceder|registrarse|registrate) como visitante|crear una cuenta (?:de usuario )?temporal|cuenta (?:de usuario )?temporal|registro de visitantes|codigo de verificacion por sms|verificacion por sms|recibiras un codigo de verificacion|biblioteca digital|nombre y (?:numero de )?telefono.{0,90}(?:crear|registro|acceso|usuario)|acceso publico.{0,100}(?:telefono|crear una cuenta|cuenta de usuario)/.test(s);
}

