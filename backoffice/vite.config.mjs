import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
export default defineConfig({plugins:[react(),{
  name:'clubiq-existing-brand',generateBundle(){
    for(const name of ['app-icon-192.png','og.png']){
      this.emitFile({type:'asset',fileName:`brand/${name}`,source:readFileSync(new URL(`../public/${name}`,import.meta.url))});
    }
  },configureServer(server){server.middlewares.use('/brand',(req,res,next)=>{
    const name=req.url?.slice(1).split('?')[0];
    if(!['app-icon-192.png','og.png'].includes(name))return next();
    res.setHeader('Content-Type','image/png');res.end(readFileSync(new URL(`../public/${name}`,import.meta.url)));
  });}
}],server:{port:5176,strictPort:true,proxy:{'/api':'http://127.0.0.1:8092'}}});
