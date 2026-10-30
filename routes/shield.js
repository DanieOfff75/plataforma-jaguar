import { identity,assertSameOrigin,shieldError,startChallenge,verifyChallenge,proofDigest,normalizeEmail,validEmail,maskEmail } from '../lib/jaguar_shield.js';

export default async function shield(req,res){
  res.setHeader('Cache-Control','no-store');
  try{
    if(req.method!=='POST')throw shieldError('Método no permitido.',405);
    assertSameOrigin(req);
    const ctx=await identity(req);
    const action=String(req.body?.action||'');
    if(action==='status')return res.status(200).json({ok:true,data:{
      recovery_email:maskEmail(ctx.profile.correo_recuperacion||''),
      email_verified:Boolean(ctx.profile.shield_correo_verificado_at),
      email_enabled:Boolean(process.env.JAGUAR_SHIELD_FROM_EMAIL&&(process.env.JAGUAR_SHIELD_RESEND_KEY||process.env.JAGUAR_SHIELD_BREVO_KEY)),
      sms_enabled:false, // NUNCA habilitar por una SIM de consumo sin la autorización correspondiente.
      policy:'Códigos de un solo uso; 5 minutos; 5 intentos; 10 envíos por hora.'
    }});
    if(action==='start')return res.status(200).json({ok:true,data:await startChallenge(ctx,req.body)});
    if(action==='verify')return res.status(200).json({ok:true,data:await verifyChallenge(ctx,req.body)});
    if(action==='confirm_enroll'){
      const proof=String(req.body?.proof||'');if(proof.length<20)throw shieldError('Verifica antes el código recibido.',403);
      const r=await ctx.db.rpc('jaguar_shield_confirmar_correo',{p_actor:ctx.user.id,p_sesion:ctx.sid,p_prueba_hash:proofDigest(proof)});
      if(r.error)throw shieldError('Falló la confirmación en Supabase.',503,'SHIELD_SQL');
      if(!r.data)throw shieldError('La verificación no corresponde al correo actual o ya venció.',403);
      return res.status(200).json({ok:true,message:'Correo de recuperación verificado.'});
    }
    if(action==='change_recovery'){
      const next=normalizeEmail(req.body?.new_email),old=normalizeEmail(ctx.profile.correo_recuperacion);
      if(!ctx.profile.shield_correo_verificado_at||!validEmail(next)||next===old)
        throw shieldError('Verifica tu correo actual y elige un correo nuevo válido.',403);
      const p1=String(req.body?.old_proof||''),p2=String(req.body?.new_proof||'');
      if(p1.length<20||p2.length<20)throw shieldError('Necesitas códigos válidos del correo anterior y del nuevo.',403);
      // Primero preparar Auth, después confirmar AMBOS comprobantes dentro de una sola transacción SQL.
      // Si falla, restaurar el correo Auth previo sin revelar datos privados en la respuesta.
      const patch={email:next,email_confirm:true,user_metadata:{...(ctx.user.user_metadata||{}),recovery_email:next,login_email:ctx.profile.correo}};
      const {error:ae}=await ctx.db.auth.admin.updateUserById(ctx.user.id,patch);
      if(ae)throw shieldError('No se pudo preparar el cambio en la cuenta de acceso.',503,'SHIELD_AUTH');
      const r=await ctx.db.rpc('jaguar_shield_cambiar_correo',{
        p_actor:ctx.user.id,p_sesion:ctx.sid,p_anterior:old,p_nuevo:next,
        p_prueba_anterior:proofDigest(p1),p_prueba_nueva:proofDigest(p2)
      });
      if(r.error||!r.data){
        const restored=await ctx.db.auth.admin.updateUserById(ctx.user.id,{email:ctx.user.email,email_confirm:true,user_metadata:ctx.user.user_metadata||{}});
        if(restored.error)console.error('Jaguar Shield: cambio Auth no revertido; requiere soporte autorizado.');
        throw shieldError('No se completó la verificación de ambos correos. Revisa el estado de tu cuenta antes de reintentar.',409,'SHIELD_CONFIRMACION');
      }
      await ctx.db.from('ithla_sesiones').update({revocada_en:new Date().toISOString()}).eq('usuario_id',ctx.user.id).is('revocada_en',null);
      return res.status(200).json({ok:true,message:'Correo actualizado y sesiones revocadas. Vuelve a iniciar sesión.',needs_relogin:true});
    }
    throw shieldError('Acción Shield no disponible.',404);
  }catch(e){
    const safe=e?.code==='SHIELD_SQL'?'Error al consultar la migración Jaguar Shield.':e?.message||'No se pudo completar la verificación.';
    return res.status(e?.status||500).json({ok:false,error:safe,code:e?.code||'SHIELD_ERROR'});
  }
}
