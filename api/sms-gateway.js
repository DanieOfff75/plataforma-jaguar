import {smsGateway} from '../lib/jaguar_sms_gateway.js';
export default async function handler(req,res){return smsGateway(req,res);}
