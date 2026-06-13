import https from "node:https"; import fs from "node:fs"; import { URL } from "node:url";
function loadEnv(p){if(!fs.existsSync(p))return;for(const line of fs.readFileSync(p,"utf8").split(/\r?\n/)){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(m&&!process.env[m[1]]){let v=m[2].trim();if(v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);v=v.replace(/\\$/g,"$");process.env[m[1]]=v;}}}
loadEnv(".env.local");
function req(method,path,opts={}){return new Promise((res,rej)=>{const t=new URL(path,process.env.SAP_B1_BASE_URL+"/");const r=https.request({hostname:t.hostname,port:t.port||443,path:t.pathname+t.search,method,rejectUnauthorized:false,headers:{"Content-Type":"application/json",...(opts.cookies?{Cookie:opts.cookies}:{})}},(resp)=>{let d="";resp.on("data",c=>d+=c);resp.on("end",()=>{let p=d;try{p=JSON.parse(d)}catch{};res({status:resp.statusCode,body:p,headers:resp.headers})})});r.on("error",rej);if(opts.body)r.write(JSON.stringify(opts.body));r.end()})}
const login=await req("POST","Login",{body:{CompanyDB:process.env.SAP_B1_COMPANY_DB,UserName:process.env.SAP_B1_USERNAME,Password:process.env.SAP_B1_PASSWORD}});
const cookies=(login.headers["set-cookie"]||[]).map(c=>c.split(";")[0]).join("; ");
// 02FRL1629 est-il un vrai ItemCode SAP ?
const it=await req("GET","Items('02FRL1629')?$select=ItemCode,ItemName",{cookies});
console.log("Items('02FRL1629') →",it.status, JSON.stringify(it.body).slice(0,120));
// La vue contient-elle des fraises (ItemName) ?
const fr=await req("GET",`view.svc/GERVI_SITE_PVB1SLQuery?$filter=${encodeURIComponent("ItemCode eq 'FE1SL'")}&$top=2`,{cookies});
console.log("view FE1SL →", fr.body?.value?.length ?? fr.status);
// échantillon de codes distincts dans la vue
const s=await req("GET","view.svc/GERVI_SITE_PVB1SLQuery?$top=400",{cookies});
const codes=[...new Set((s.body?.value||[]).map(r=>r.ItemCode))];
console.log("Codes vue (échantillon):", codes.slice(0,25).join(", "));
console.log("Nb codes distincts /400:", codes.length);
// Un de ces codes est-il un Item SAP ?
const test=codes[0];
const t2=await req("GET",`Items('${test}')?$select=ItemCode,ItemName`,{cookies});
console.log(`Items('${test}') →`, t2.status, JSON.stringify(t2.body).slice(0,120));
await req("POST","Logout",{cookies});
