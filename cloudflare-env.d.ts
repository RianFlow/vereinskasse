interface Fetcher { fetch(input:RequestInfo|URL,init?:RequestInit):Promise<Response> }
interface D1Result<T=Record<string,unknown>> { results:T[];meta:{changes:number;[key:string]:unknown} }
interface D1PreparedStatement {
  bind(...values:unknown[]):D1PreparedStatement;
  first<T=Record<string,unknown>>():Promise<T|null>;
  all<T=Record<string,unknown>>():Promise<D1Result<T>>;
  run<T=Record<string,unknown>>():Promise<D1Result<T>>;
}
interface D1Database { prepare(query:string):D1PreparedStatement;batch(statements:D1PreparedStatement[]):Promise<D1Result[]> }
interface R2Object { key:string;size:number;uploaded:Date;customMetadata?:Record<string,string> }
interface R2ObjectBody extends R2Object { body:ReadableStream;json<T>():Promise<T> }
interface R2Bucket {
  put(key:string,value:string|ArrayBuffer|ReadableStream,options?:{httpMetadata?:{contentType?:string};customMetadata?:Record<string,string>}):Promise<R2Object>;
  get(key:string):Promise<R2ObjectBody|null>;
  head(key:string):Promise<R2Object|null>;
  list(options?:{prefix?:string;limit?:number;include?:string[]}):Promise<{objects:R2Object[]}>;
}

declare module "cloudflare:workers" {
  export const env:{ASSETS:Fetcher;DB:D1Database;BACKUPS:R2Bucket};
}
