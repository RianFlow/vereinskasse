import { env } from "cloudflare:workers";

type SmtpSecurity="starttls"|"tls";
export type SmtpPublicStatus={configured:boolean;available:boolean;sender:string|null;replyTo:string|null;reason?:string};
export type SmtpAttachment={filename:string;content:string;contentType:string};
type SmtpConfig={host:string;port:number;security:SmtpSecurity;user:string;password:string;from:string;replyTo:string|null};

const clean=(value:unknown)=>String(value||"").trim();
const validMailbox=(value:string)=>value.length<=320&&!/[\r\n]/.test(value)&&/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(value.replace(/^.*<([^>]+)>.*$/,"$1"));
const validMailboxList=(value:string)=>value.length<=1600&&!/[\r\n]/.test(value)&&value.split(",").map(item=>item.trim()).filter(Boolean).length>0&&value.split(",").every(item=>validMailbox(item.trim()));
const runtimeImport=(specifier:string)=>import(/* @vite-ignore */ specifier);

async function readPassword(path:string){
  const fs=await runtimeImport("node:fs/promises") as {readFile:(file:string,encoding:string)=>Promise<string>};
  return (await fs.readFile(path,"utf8")).trim();
}

async function smtpConfig():Promise<SmtpConfig>{
  const runtime=env as unknown as Record<string,unknown>;
  if(clean(runtime.VEREINSKASSE_RUNTIME)!=="raspberry")throw new Error("SMTP_RUNTIME_UNAVAILABLE");
  const host=clean(runtime.CLUBIQ_SMTP_HOST),user=clean(runtime.CLUBIQ_SMTP_USER),from=clean(runtime.CLUBIQ_SMTP_FROM);
  const port=Number(clean(runtime.CLUBIQ_SMTP_PORT)||587);
  const security=clean(runtime.CLUBIQ_SMTP_SECURITY)==="tls"?"tls":"starttls";
  const passwordFile=clean(runtime.CLUBIQ_SMTP_PASSWORD_FILE);
  const replyTo=clean(runtime.CLUBIQ_SMTP_REPLY_TO)||null;
  if(!host||!user||!passwordFile||!validMailbox(from)||!Number.isInteger(port)||port<1||port>65535)throw new Error("SMTP_NOT_CONFIGURED");
  if(replyTo&&!validMailboxList(replyTo))throw new Error("SMTP_INVALID_REPLY_TO");
  const password=await readPassword(passwordFile);
  if(!password)throw new Error("SMTP_NOT_CONFIGURED");
  return {host,port,security,user,password,from,replyTo};
}

export function smtpPublicStatus():SmtpPublicStatus{
  const runtime=env as unknown as Record<string,unknown>;
  const available=clean(runtime.VEREINSKASSE_RUNTIME)==="raspberry";
  const sender=clean(runtime.CLUBIQ_SMTP_FROM)||null,replyTo=clean(runtime.CLUBIQ_SMTP_REPLY_TO)||null;
  const configured=available&&Boolean(clean(runtime.CLUBIQ_SMTP_HOST)&&clean(runtime.CLUBIQ_SMTP_USER)&&clean(runtime.CLUBIQ_SMTP_PASSWORD_FILE)&&sender&&validMailbox(sender)&&(!replyTo||validMailboxList(replyTo)));
  return {configured,available,sender,replyTo,reason:available?(configured?undefined:"SMTP ist auf dem Raspberry noch nicht eingerichtet."):"E-Mail-Versand steht nur auf dem Raspberry zur Verfügung."};
}

export function smtpCashManagerRecipients(){
  const value=clean((env as unknown as Record<string,unknown>).CLUBIQ_SMTP_REPLY_TO);
  return value&&validMailboxList(value)?value.split(",").map(item=>item.trim()).filter(Boolean):[];
}

async function transporter(){
  const config=await smtpConfig();
  const imported=await runtimeImport("nodemailer") as {default?:{createTransport:(options:Record<string,unknown>)=>unknown};createTransport?:(options:Record<string,unknown>)=>unknown};
  const createTransport=imported.default?.createTransport||imported.createTransport;
  if(!createTransport)throw new Error("SMTP_LIBRARY_UNAVAILABLE");
  const transport=createTransport({
    host:config.host,
    port:config.port,
    secure:config.security==="tls",
    requireTLS:config.security==="starttls",
    auth:{user:config.user,pass:config.password},
    connectionTimeout:10_000,
    greetingTimeout:10_000,
    socketTimeout:25_000,
    disableFileAccess:true,
    disableUrlAccess:true,
    tls:{minVersion:"TLSv1.2",servername:config.host}
  }) as {verify:()=>Promise<boolean>;sendMail:(message:Record<string,unknown>)=>Promise<{messageId?:string;accepted?:unknown[]}>};
  return {config,transport};
}

export async function verifySmtp(){const {transport}=await transporter();await transport.verify();return true}
export async function sendSmtpMessage(message:{to:string;subject:string;text:string;html:string;attachments?:SmtpAttachment[];replyTo?:string|null}){
  if(!validMailbox(message.to))throw new Error("INVALID_RECIPIENT");
  if(message.replyTo&&!validMailbox(message.replyTo))throw new Error("INVALID_REPLY_TO");
  const {config,transport}=await transporter();
  const result=await transport.sendMail({from:config.from,to:message.to,replyTo:message.replyTo===null?undefined:message.replyTo||config.replyTo||undefined,subject:message.subject,text:message.text,html:message.html,attachments:message.attachments,disableFileAccess:true,disableUrlAccess:true});
  return {messageId:result.messageId||null,accepted:Array.isArray(result.accepted)?result.accepted.length:0};
}
