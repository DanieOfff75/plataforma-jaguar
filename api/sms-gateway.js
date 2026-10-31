import {smsGateway} from '../lib/jaguar_sms_gateway.js';
export default function handler(req,res){return smsGateway(req,res);}
