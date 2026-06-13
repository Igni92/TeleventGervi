/** Trouve le lien commande → facture (BL = commande SAP, facture liée). */
import https from "node:https"; import fs from "node:fs"; import { URL } from "node:url";
function loadEnv(p){if(!fs.existsSync(p))return;for(const line of fs.readFileSync(p,"utf8").split(/\r?\n/)){const m=line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);if(m&&!process.env[m[1]]){let v=m[2].trim();if(v.startsWith('"')&&v.endsWith('"'))v=v.slice(1,-1);v=v.replace(/\\\$/g,"$");process.env[m[1]]=v;}}}
loadEnv(".env.local");
function req(method,path,opts={}){return new Promise((res,rej)=>{const t=new URL(path,process.env.SAP_B1_BASE_URL+"/");const r=https.request({hostname:t.hostname,port:t.port||443,path:t.pathname+t.search,method,rejectUnauthorized:false,headers:{"Content-Type":"application/json",...(opts.cookies?{Cookie:opts.cookies}:{})}},(resp)=>{let d="";resp.on("data",c=>d+=c);resp.on("end",()=>{let p=d;try{p=JSON.parse(d)}catch{};res({status:resp.statusCode,body:p,headers:resp.headers})})});r.on("error",rej);if(opts.body)r.write(JSON.stringify(opts.body));r.end()})}
const login=await req("POST","Login",{body:{CompanyDB:process.env.SAP_B1_COMPANY_DB,UserName:process.env.SAP_B1_USERNAME,Password:process.env.SAP_B1_PASSWORD}});
const cookies=(login.headers["set-cookie"]||[]).map(c=>c.split(";")[0]).join("; ");
if(login.status!==200){console.log("LOGIN FAIL",login.status);process.exit(0);}

// Cherche une commande clôturée (probablement facturée)
const orders=await req("GET","Orders?$top=50&$orderby=DocEntry desc&$filter=DocumentStatus eq 'bost_Close'&$select=DocEntry,DocNum,DocumentStatus",{cookies});
const closed=orders.body?.value||[];
console.log("Commandes clôturées trouvées:",closed.length);
for(const o of closed.slice(0,3)){
  const full=await req("GET",`Orders(${o.DocEntry})`,{cookies});
  const od=full.body;
  console.log(`\n#${o.DocNum} (DocEntry ${o.DocEntry})`);
  // Champs doc-level liés au target/facture
  const docTargets=Object.entries(od).filter(([k,v])=>/target|invoice|facture/i.test(k)&&v!=null&&v!==-1&&v!=="");
  docTargets.forEach(([k,v])=>console.log(`  doc ${k}=${JSON.stringify(v)}`));
  // Lignes : TargetType / TargetEntry
  for(const l of (od.DocumentLines||[]).slice(0,2)){
    console.log(`  ligne ${l.ItemCode}: TargetType=${l.TargetType} TargetEntry=${l.TargetEntry} TrgetEntry=${l.TrgetEntry}`);
  }
}

// 2. Y a-t-il une entité de liens ? Test Invoices filtrées par une commande
console.log("\n=== Test : Invoices récentes, voir BaseType/BaseEntry des lignes ===");
const inv=await req("GET","Invoices?$top=3&$orderby=DocEntry desc",{cookies});
for(const i of (inv.body?.value||[])){
  console.log(`Facture #${i.DocNum} (DocEntry ${i.DocEntry})`);
  for(const l of (i.DocumentLines||[]).slice(0,2)){
    console.log(`  ligne ${l.ItemCode}: BaseType=${l.BaseType} BaseEntry=${l.BaseEntry} BaseRef=${l.BaseRef}`);
  }
}
await req("POST","Logout",{cookies});
