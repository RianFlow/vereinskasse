const messages={
  INVALID_EMAIL_OR_PASSWORD:'E-Mail oder Passwort stimmt nicht.',
  EMAIL_NOT_VERIFIED:'Bitte zuerst den Einladungslink verwenden.',
  INVALID_TOKEN:'Dieser Link ist abgelaufen oder bereits verwendet. Bitte einen neuen anfordern.',
  INVALID_TWO_FACTOR_COOKIE:'Bitte erneut mit E-Mail und Passwort anmelden.',
  INVALID_TWO_FACTOR_CODE:'Der Code stimmt nicht oder ist abgelaufen.',
  INVALID_PASSWORD:'Das aktuelle Passwort stimmt nicht.',
  PASSWORD_TOO_SHORT:'Das Passwort muss mindestens 15 Zeichen enthalten.'
};

function requestError(message,properties={}){
  return Object.assign(new Error(message),properties);
}

export function isCloudflareAccessResponse(response){
  const type=response.headers?.get?.('content-type')||'';
  if(type.toLowerCase().includes('application/json'))return false;
  const url=String(response.url||'').toLowerCase();
  return (response.status===401||response.status===403)
    || Boolean(response.redirected&&(url.includes('cloudflareaccess.com')||url.includes('/cdn-cgi/access/')));
}

export async function apiRequest(path,body,method=body?'POST':'GET',signal,fetcher=fetch){
  const headers={'X-Requested-With':'XMLHttpRequest'};
  if(body)headers['Content-Type']='application/json';
  if(signal)headers['X-ClubIQ-Background']='1';
  let response;
  try{
    response=await fetcher(path,{method,signal,credentials:'same-origin',cache:'no-store',headers,body:body?JSON.stringify(body):undefined});
  }catch(cause){
    throw requestError('Der Verwaltungsserver ist gerade nicht erreichbar.',{kind:'connection',cause});
  }
  if(isCloudflareAccessResponse(response)){
    throw requestError('Deine Cloudflare-Anmeldung ist abgelaufen.',{kind:'cloudflare-access',status:response.status});
  }
  let data;
  try{data=await response.json();}
  catch{throw requestError('Der Verwaltungsserver antwortet gerade nicht richtig.',{kind:'connection',status:response.status});}
  if(!response.ok){
    if(response.status===401)throw requestError('Anmeldung abgelaufen oder Anmeldedaten nicht korrekt.',{kind:'session',status:401});
    throw requestError(typeof data.error==='string'?data.error:messages[data.code]||(response.status===429?'Zu viele Versuche. Bitte vor dem nächsten Versuch warten.':'Die Anfrage konnte nicht abgeschlossen werden. Bitte Eingaben prüfen.'),{status:response.status});
  }
  return data;
}
