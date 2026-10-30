import {randomBytes,createHmac} from 'node:crypto';
export const normalizeEmail = input => String(input || '').trim().toLowerCase();
export const validEmail = input => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(normalizeEmail(input));
export function secret(){
 const value=String(process.env.JAGUAR_SHIELD_SECRET||'');
 if(value.length<32)throw Object.assign(new Error('Configura JAGUAR_SHIELD_SECRET (mínimo 32 caracteres aleatorios).'),{status:503,code:'SHIELD_NO_CONFIGURADO'});
 return value;
}
export function digest(value){return createHmac('sha256',secret()).update(String(value)).digest('hex');}
export function otpDigest(id,code){return digest(`otp:${id}:${code}`);}
export function proofDigest(proof){return digest(`proof:${proof}`);}
export function newCode(){return String(randomBytes(4).readUInt32BE(0)%1000000).padStart(6,'0');}
export const newProof=()=>randomBytes(32).toString('base64url');
export const maskEmail=email=>normalizeEmail(email).replace(/^(.{1,2}).*(@.*)$/,'$1••••$2');
