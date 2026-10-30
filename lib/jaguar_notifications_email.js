/** Notificaciones Jaguar · plantilla HTML segura para mensajes transaccionales.
 * Invocar solo desde procesos del servidor; no expone envíos arbitrarios a usuarios.
 * Sin dependencias externas ni imágenes remotas; funciona en clientes que bloquean imágenes. */
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cleanLine = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,300);
const PURPOSE = Object.freeze({
  enroll:{title:'Verifica tu correo',description:'Confirma que esta dirección de correo te pertenece para proteger tu cuenta Jaguar.',preview:'Verifica tu dirección de correo con este código temporal.'},
  change_old:{title:'Confirma tu identidad',description:'Se solicitó un cambio de correo de recuperación. Verifica primero tu dirección actual.',preview:'Confirma el cambio de correo de recuperación.'},
  change_new:{title:'Verifica tu nuevo correo',description:'Comprueba que tienes acceso a la nueva dirección antes de guardar el cambio.',preview:'Verifica tu nueva dirección de correo.'},
  eval_open:{title:'Autoriza la apertura de evaluaciones',description:'Dirección Escolar solicitó abrir un periodo de captura. Verifica tu identidad para autorizar esta operación.',preview:'Se requiere tu aprobación para abrir evaluaciones.'},
  eval_close:{title:'Autoriza el cierre de evaluaciones',description:'Dirección Escolar solicitó cerrar un periodo de captura. Verifica tu identidad para autorizar esta operación.',preview:'Se requiere tu aprobación para cerrar evaluaciones.'}
});

function shell({title,description,eyebrow,bodyHtml,closing,preview}){
  const safeTitle=escapeHtml(title), safeDescription=escapeHtml(description);
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle} · Notificaciones Jaguar</title></head>
<body style="margin:0;padding:0;background-color:#edf2f7;color:#243448;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
<div style="display:none!important;visibility:hidden;opacity:0;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(preview)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;background:#edf2f7;"><tr><td align="center" style="padding:32px 14px 40px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:580px;border-collapse:separate;border-spacing:0;">
<tr><td style="padding:28px 30px 26px;background:#1B365D;border-radius:20px 20px 0 0;border-top:5px solid #D4AF37;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="width:44px;vertical-align:middle;"><div style="background:#D4AF37;color:#1B365D;width:40px;height:40px;line-height:40px;text-align:center;font-size:22px;font-weight:800;border-radius:12px;">J</div></td><td style="vertical-align:middle;padding-left:12px;"><div style="font-size:19px;font-weight:800;letter-spacing:.2px;color:#fff;">Notificaciones Jaguar</div><div style="font-size:11px;letter-spacing:1.4px;font-weight:700;color:#DCC88A;text-transform:uppercase;padding-top:5px;">Comunicación institucional</div></td></tr></table>
</td></tr>
<tr><td style="padding:32px 30px 28px;background:#ffffff;border-left:1px solid #e1e8f0;border-right:1px solid #e1e8f0;">
<div style="font-size:11px;font-weight:800;color:#008080;letter-spacing:1.6px;text-transform:uppercase;padding-bottom:12px;">${escapeHtml(eyebrow)}</div>
<h1 style="font-size:26px;line-height:1.25;color:#1B365D;margin:0 0 15px;font-weight:800;">${safeTitle}</h1>
<p style="font-size:15px;line-height:1.75;color:#43576d;margin:0 0 24px;">${safeDescription}</p>
${bodyHtml}
<div style="height:1px;background:#e6ebf1;margin:28px 0 22px;"></div>
<p style="font-size:13px;line-height:1.65;color:#5f7084;margin:0;">${escapeHtml(closing)}</p>
</td></tr>
<tr><td style="padding:23px 30px 25px;background:#f8fafc;border:1px solid #e1e8f0;border-top:0;border-radius:0 0 20px 20px;">
<p style="font-size:12px;line-height:1.6;color:#6c7c8e;margin:0;">Este mensaje fue enviado automáticamente por <strong style="color:#1B365D;">Notificaciones Jaguar</strong>. No respondas a este correo.</p>
<p style="font-size:11px;line-height:1.6;color:#8290a1;margin:10px 0 0;">Protegemos tu información. Los enlaces y archivos institucionales se consultan únicamente en los portales autorizados.</p>
</td></tr></table></td></tr></table></body></html>`;
}

export function renderOtpNotification({code,purpose}){
  if(!/^\d{6}$/.test(String(code)))throw new TypeError('Un código OTP válido debe contener seis dígitos.');
  const content=PURPOSE[purpose];
  if(!content)throw new TypeError('Propósito OTP no permitido.');
  const bodyHtml=`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;border-spacing:0;background:#eff6f6;border:1px solid #cce4e0;border-radius:16px;"><tr><td align="center" style="padding:22px 12px 20px;">
<div style="font-size:11px;letter-spacing:1.3px;font-weight:800;color:#316b70;text-transform:uppercase;margin-bottom:10px;">Tu código de seguridad</div>
<div style="font-family:Consolas,'Courier New',monospace;letter-spacing:8px;font-size:36px;line-height:1.4;font-weight:800;color:#183856;white-space:nowrap;">${code}</div>
<div style="font-size:12px;color:#527277;margin-top:12px;">Válido durante 5 minutos · Un solo uso</div>
</td></tr></table>
<p style="font-size:13px;line-height:1.65;color:#607184;margin:20px 0 0;">Escribe este código en la ventana de verificación que dejaste abierta en Jaguar. No necesitas responder este mensaje.</p>`;
  return {subject:`Notificaciones Jaguar | ${content.title}`,html:shell({title:content.title,description:content.description,eyebrow:'Seguridad de tu cuenta',bodyHtml,preview:content.preview,closing:'¿No solicitaste este código? Puedes ignorar este mensaje. No compartas el código con otras personas ni con NEXO.'}),text:`Notificaciones Jaguar\n\n${content.title}\n\n${content.description}\n\nTu código de seguridad: ${code}\nVálido 5 minutos. Un solo uso.\n\nNo compartas el código, tampoco con NEXO. Si no lo solicitaste, ignora este correo.`};
}

/** Componente listo para avisos futuros. No crea por sí mismo una ruta de envío. */
export function renderSystemNotification({title,description,category='Aviso institucional',details=[]}){
  const safeTitle=cleanLine(title),safeDescription=cleanLine(description);
  if(!safeTitle||!safeDescription)throw new TypeError('Faltan título o descripción.');
  const safeDetails=Array.isArray(details)?details.slice(0,8).map(v=>cleanLine(v)).filter(Boolean):[];
  const body=safeDetails.length?`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f3f7fa;border-radius:12px;border-collapse:separate;border-spacing:0;">${safeDetails.map(v=>`<tr><td style="padding:10px 16px;font-size:14px;color:#344960;border-bottom:1px solid #e0e7ee;">${escapeHtml(v)}</td></tr>`).join('')}</table>`:'';
  return {subject:`Notificaciones Jaguar | ${safeTitle}`,html:shell({title:safeTitle,description:safeDescription,eyebrow:cleanLine(category),bodyHtml:body,preview:safeDescription,closing:'Para realizar una gestión, ingresa directamente a Plataforma Jaguar. Nunca compartas tus credenciales ni códigos de verificación.'}),text:`Notificaciones Jaguar\n\n${safeTitle}\n${safeDescription}\n${safeDetails.join('\n')}\n\nAccede directamente a Jaguar para realizar cualquier gestión.`};
}
