import https from "node:https"; import fs from "node:fs"; import { URL } from "node:url";
function loadEnv(p){if(!fs.existsSync(p))return;for(const line of fs.readFileSync(p,"utf8").split(/\r?\n/)){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(m&&!process.env[m[1]]){let v=m[2].trim();if(v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);v=v.replace(/\\$/g,"$");process.env[m[1]]=v;}}}
loadEnv(".env.local");
function req(method,path,opts={}){return new Promise((res,rej)=>{const t=new URL(path,process.env.SAP_B1_BASE_URL+"/");const r=https.request({hostname:t.hostname,port:t.port||443,path:t.pathname+t.search,method,rejectUnauthorized:false,headers:{"Content-Type":"application/json",...(opts.cookies?{Cookie:opts.cookies}:{})}},(resp)=>{let d="";resp.on("data",c=>d+=c);resp.on("end",()=>{let p=d;try{p=JSON.parse(d)}catch{};res({status:resp.statusCode,body:p,headers:resp.headers})})});r.on("error",rej);if(opts.body)r.write(JSON.stringify(opts.body));r.end()})}
const login=await req("POST","Login",{body:{CompanyDB:process.env.SAP_B1_COMPANY_DB,UserName:process.env.SAP_B1_USERNAME,Password:process.env.SAP_B1_PASSWORD}});
const cookies=(login.headers["set-cookie"]||[]).map(c=>c.split(";")[0]).join("; ");
// items réels avec attributs : GRO12C, FE1SL
for (const it of ["GRO12C","FE1SL","MYRT12MD"]) {
  const r=await req("GET",`view.svc/GERVI_SITE_PVB1SLQuery?$filter=${encodeURIComponent("ItemCode eq '"+it+"'")}&$top=3`,{cookies});
  const row=r.body?.value?.[0];
  if(row) console.log(`${it}: PV=${row["Prix vente"]} PV_HT=${row.PV_HT} marque=${row.U_GER_Marque} pays=${row.U_Pays} cal=${row.Calibre}/${row.Calibre_S} classe=${row.Classe}/${row.Classe_S} arome=${row.Arome}/${row.Arome_S} mat=${row.Maturite}/${row.Maturite_S}`);
  else console.log(`${it}: aucune ligne`);
}
await req("POST","Logout",{cookies});
