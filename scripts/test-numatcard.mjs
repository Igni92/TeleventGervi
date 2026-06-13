import https from "node:https"; import fs from "node:fs"; import { URL } from "node:url";
function loadEnv(p){if(!fs.existsSync(p))return;for(const line of fs.readFileSync(p,"utf8").split(/\r?\n/)){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(m&&!process.env[m[1]]){let v=m[2].trim();if(v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);v=v.replace(/\\\$/g,"$");process.env[m[1]]=v;}}}
loadEnv(".env.local");
function req(method,path,opts={}){return new Promise((res,rej)=>{const t=new URL(path,process.env.SAP_B1_BASE_URL+"/");const r=https.request({hostname:t.hostname,port:t.port||443,path:t.pathname+t.search,method,rejectUnauthorized:false,headers:{"Content-Type":"application/json",...(opts.cookies?{Cookie:opts.cookies}:{})}},(resp)=>{let d="";resp.on("data",c=>d+=c);resp.on("end",()=>{let p=d;try{p=JSON.parse(d)}catch{};res({status:resp.statusCode,body:p,headers:resp.headers})})});r.on("error",rej);if(opts.body)r.write(JSON.stringify(opts.body));r.end()})}
const login=await req("POST","Login",{body:{CompanyDB:process.env.SAP_B1_COMPANY_DB,UserName:process.env.SAP_B1_USERNAME,Password:process.env.SAP_B1_PASSWORD}});
const cookies=(login.headers["set-cookie"]||[]).map(c=>c.split(";")[0]).join("; ");
// Trouve une commande récente
const list=await req("GET","Orders?$top=1&$orderby=DocEntry desc&$select=DocEntry,DocNum,NumAtCard",{cookies});
const o=list.body.value[0];
console.log("Avant: #"+o.DocNum+" DocEntry="+o.DocEntry+" NumAtCard="+JSON.stringify(o.NumAtCard));
const patch=await req("PATCH","Orders("+o.DocEntry+")",{cookies,body:{NumAtCard:"BC-TEST-9999"}});
console.log("PATCH status:",patch.status);
const after=await req("GET","Orders("+o.DocEntry+")?$select=DocNum,NumAtCard",{cookies});
console.log("Après: NumAtCard="+JSON.stringify(after.body.NumAtCard));
// restore
await req("PATCH","Orders("+o.DocEntry+")",{cookies,body:{NumAtCard:o.NumAtCard||""}});
console.log("Restauré à",JSON.stringify(o.NumAtCard||""));
await req("POST","Logout",{cookies});
