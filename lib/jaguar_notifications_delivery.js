/** Servicio interno de Notificaciones Jaguar.
 * No publica rutas de envío ni acepta peticiones directas de clientes web.
 * Recibe mensajes ya renderizados por los constructores seguros de plantillas.
 * Configuración existente: JAGUAR_SHIELD_FROM_EMAIL y API key de Brevo o Resend. */
function validEmail(input){return /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(String(input||'').trim());}
function mailError(message,code='JAGUAR_NOTIFICACIONES_ERROR',status=503){return Object.assign(new Error(message),{status,code});}

export async function deliverJaguarNotification(to,message){
  const from=String(process.env.JAGUAR_SHIELD_FROM_EMAIL||'').trim();
  if(!validEmail(from))throw mailError('Configura un correo remitente verificado en Notificaciones Jaguar.','SHIELD_REMITENTE');
  if(!validEmail(to))throw mailError('El correo destinatario no es válido.','JAGUAR_DESTINATARIO',400);
  if(typeof message?.subject!=='string'||!message.subject.startsWith('Notificaciones Jaguar | ')||typeof message.html!=='string'||typeof message.text!=='string')
    throw mailError('El mensaje institucional está incompleto.','JAGUAR_PLANTILLA',400);
  let rsp;
  if(process.env.JAGUAR_SHIELD_RESEND_KEY){
    rsp=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${process.env.JAGUAR_SHIELD_RESEND_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from,to:[to],subject:message.subject,html:message.html,text:message.text}),signal:AbortSignal.timeout(12000)});
  }else if(process.env.JAGUAR_SHIELD_BREVO_KEY){
    rsp=await fetch('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'api-key':process.env.JAGUAR_SHIELD_BREVO_KEY,'Content-Type':'application/json'},body:JSON.stringify({sender:{email:from,name:'Notificaciones Jaguar'},to:[{email:to}],subject:message.subject,htmlContent:message.html,textContent:message.text}),signal:AbortSignal.timeout(12000)});
  }else{
    throw mailError('Configura Brevo o Resend para enviar Notificaciones Jaguar.','SHIELD_CORREO_NO_CONFIGURADO');
  }
  if(!rsp.ok)throw mailError(`No se pudo enviar el correo (HTTP ${rsp.status}).`,'SHIELD_ENVIO');
  return true;
}
