import { readFile } from "node:fs/promises";
import nodemailer from "nodemailer";

const required=name=>{const value=String(process.env[name]||"").trim();if(!value)throw new Error(`${name} ist nicht gesetzt`);return value};
const host=required("CLUBIQ_SMTP_HOST"),user=required("CLUBIQ_SMTP_USER"),from=required("CLUBIQ_SMTP_FROM");
const port=Number(process.env.CLUBIQ_SMTP_PORT||587),security=process.env.CLUBIQ_SMTP_SECURITY==="tls"?"tls":"starttls";
const password=(await readFile(required("CLUBIQ_SMTP_PASSWORD_FILE"),"utf8")).trim();
if(!password)throw new Error("SMTP-Passwort ist leer");
const transport=nodemailer.createTransport({host,port,secure:security==="tls",requireTLS:security==="starttls",auth:{user,pass:password},connectionTimeout:10_000,greetingTimeout:10_000,socketTimeout:20_000,disableFileAccess:true,disableUrlAccess:true,tls:{minVersion:"TLSv1.2",servername:host}});
await transport.verify();
console.log(`Mailserver bereit: ${host}:${port} · ${security.toUpperCase()} · Absender ${from}`);
