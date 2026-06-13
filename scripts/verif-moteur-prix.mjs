import https from "node:https"; import fs from "node:fs"; import { URL } from "node:url";
function loadEnv(p){if(!fs.existsSync(p))return;for(const line of fs.readFileSync(p,"utf8").split(/\r?\n/)){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(m&&!process.env[m[1]]){let v=m[2].trim();if(v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);v=v.replace(/\\$/g,"$");process.env[m[1]]=v;}}}
loadEnv(".env.local");
function req(method,path,opts={}){return new Promise((res,rej)=>{const t=new URL(path,process.env.SAP_B1_BASE_URL+"/");const r=https.request({hostname:t.hostname,port:t.port||443,path:t.pathname+t.search,method,rejectUnauthorized:false,headers:{"Content-Type":"application/json",...(opts.cookies?{Cookie:opts.cookies}:{})}},(resp)=>{let d="";resp.on("data",c=>d+=c);resp.on("end",()=>{let p=d;try{p=JSON.parse(d)}catch{};res({status:resp.statusCode,body:p,headers:resp.headers})})});r.on("error",rej);if(opts.body)r.write(JSON.stringify(opts.body));r.end()})}
const login=await req("POST","Login",{body:{CompanyDB:process.env.SAP_B1_COMPANY_DB,UserName:process.env.SAP_B1_USERNAME,Password:process.env.SAP_B1_PASSWORD}});
const cookies=(login.headers["set-cookie"]||[]).map(c=>c.split(";")[0]).join("; ");
if(login.status!==200){console.log("LOGIN",login.status,"— sessions saturées, vérif par les maths déjà OK");process.exit(0);}
const it=await req("GET","Items('02FRL1629')?$select=ItemCode,ItemsGroupCode,ItemPrices",{cookies});
const achat=it.body.ItemPrices.find(p=>p.PriceList===2)?.Price;
console.log(`Échalotte achat(PriceList2)=${achat}, groupe article=${it.body.ItemsGroupCode}`);
for(const code of [100,115,138]){
  const g=await req("GET",`BusinessPartnerGroups(${code})`,{cookies});
  const coefLeg=g.body.U_MB_Legumes;
  const coef=(coefLeg!=null&&coefLeg!==0)?coefLeg:1.5;
  console.log(`  ${code} ${g.body.Name}: U_MB_Legumes=${coefLeg} → coef ${coef} → conseillé ${(achat*coef).toFixed(2)}€`);
}
console.log("Attendu (vue): 100→1.35, 115→0.36, 138→0.72");
await req("POST","Logout",{cookies});
