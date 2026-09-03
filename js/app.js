/* גמ"ח כספים — שכבת נתונים מול Supabase (schema gemach_kspim) + כל מסכי האפליקציה. */
const nis=n=>"₪"+(Math.round(n||0)).toLocaleString("he-IL");
// תאריכים: תמיד חשבון על מחרוזת YYYY-MM-DD ישירות, בלי לעבור דרך toISOString/Date-מקומי —
// הרוד-טריפ הזה תלוי אזור-זמן ומזיז תאריכים ביום אחד (נתפס בפועל בהפקת חוזה הלוואה, 03/09/2026).
const today=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")};
const heDate=s=>{if(!s)return"";const[y,m,d]=s.split("-");return `${+d}.${+m}.${y}`};
function esc(s){return(s==null?"":""+s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}
function toast(msg,bad){const t=document.getElementById("toast");t.textContent=msg;t.className="toast on"+(bad?" bad":"");clearTimeout(window.__tt);window.__tt=setTimeout(()=>t.classList.remove("on"),4200)}

/* ===== מיפוי DB <-> מודל מקומי ===== */
const mapPerson=r=>({id:r.id,name:r.name,phone:r.phone||"",idNum:r.id_num||"",branch:r.branch||"",address:r.address||"",notes:r.notes||""});
const mapLoan=r=>({id:r.id,personId:r.person_id,amount:+r.amount,date:r.loan_date,dueDate:r.due_date||"",notes:r.notes||"",installments:r.installments||12,guarantor1:r.guarantor1||"",guarantor2:r.guarantor2||"",contractLink:r.contract_link||""});
const mapRepay=r=>({id:r.id,loanId:r.loan_id,amount:+r.amount,date:r.pay_date,note:r.note||""});
const mapCash=r=>({id:r.id,type:r.entry_type,amount:+r.amount,date:r.entry_date,source:r.source||"",note:r.note||""});
const mapReq=r=>({id:r.id,name:r.name,phone:r.phone||"",amount:+r.amount||0,reason:r.reason||"",date:r.req_date,status:r.status});

const LATE=60; // ימים בלי תשלום = "מי שתק"
let db={settings:{name:'גמ"ח כספים',branches:["מרכזי"],bankBalance:0},people:[],loans:[],repays:[],cash:[],requests:[]};

async function loadAll(){
  const [settings,people,loans,repays,cash,requests]=await Promise.all([
    AUTH.api("settings?select=*&id=eq.1"),
    AUTH.api("people?select=*&order=name.asc"),
    AUTH.api("loans?select=*&order=loan_date.desc"),
    AUTH.api("repayments?select=*"),
    AUTH.api("cash_entries?select=*&order=entry_date.desc"),
    AUTH.api("requests?select=*&order=req_date.desc"),
  ]);
  db.settings=settings&&settings[0]?{name:settings[0].name,branches:settings[0].branches||["מרכזי"],bankBalance:+settings[0].bank_balance||0}:db.settings;
  db.people=(people||[]).map(mapPerson);
  db.loans=(loans||[]).map(mapLoan);
  db.repays=(repays||[]).map(mapRepay);
  db.cash=(cash||[]).map(mapCash);
  db.requests=(requests||[]).map(mapReq);
}
async function withBusy(fn){
  try{return await fn()}
  catch(e){toast(e.message||"שגיאה",true);throw e}
}

/* ===== חישובים ===== */
function loanPaid(id){return db.repays.filter(r=>r.loanId===id).reduce((s,r)=>s+ +r.amount,0)}
function loanBalance(l){return +l.amount - loanPaid(l.id)}
function loanStatus(l){const bal=loanBalance(l);if(bal<=0)return"closed";if(l.dueDate&&l.dueDate<today())return"over";return"open"}
function personName(id){const p=db.people.find(x=>x.id===id);return p?p.name:"—"}
function personDebt(id){return db.loans.filter(l=>l.personId===id).reduce((s,l)=>s+Math.max(0,loanBalance(l)),0)}
// תשלום אחרון + ימים משם; אם מעולם לא שילם, נספר מההלוואה האחרונה שלקח (כמו בגרסת ה-Sheets).
function personLastActivity(id){
  const myLoans=db.loans.filter(l=>l.personId===id).map(l=>l.id);
  const pays=db.repays.filter(r=>myLoans.includes(r.loanId)).map(r=>r.date).sort();
  const lastPay=pays.length?pays[pays.length-1]:null;
  const loanDates=db.loans.filter(l=>l.personId===id).map(l=>l.date).sort();
  const base=lastPay||loanDates[loanDates.length-1]||today();
  const days=Math.floor((new Date(today())-new Date(base))/86400000);
  return {lastPay,days};
}
function totals(){
  const given=db.loans.reduce((s,l)=>s+ +l.amount,0);
  const repaid=db.repays.reduce((s,r)=>s+ +r.amount,0);
  const outside=db.loans.reduce((s,l)=>s+Math.max(0,loanBalance(l)),0);
  const deposits=db.cash.filter(c=>c.type!=='withdraw').reduce((s,c)=>s+ +c.amount,0);
  const withdraws=db.cash.filter(c=>c.type==='withdraw').reduce((s,c)=>s+ +c.amount,0);
  const inbox=deposits+repaid-given-withdraws;
  const keren=inbox+outside;
  return {given,repaid,outside,deposits,withdraws,inbox,keren};
}

/* ===== ניווט ===== */
const TABS=[["dash","לוח בקרה","📊"],["people","אנשים","👥"],["loans","הלוואות","🤝"],["cash","קופה","🏦"],["requests","בקשות","📩"],["docs","מסמכים","📄"],["help","הסבר","❓"],["settings","הגדרות","⚙️"]];
let cur="dash";
function nav(){document.getElementById("tabs").innerHTML=TABS.map(t=>`<button class="${t[0]===cur?'active':''}" onclick="go('${t[0]}')">${t[2]} ${t[1]}</button>`).join("");document.getElementById("gname").textContent=db.settings.name}
function go(t){cur=t;nav();render()}
function render(){({dash:vDash,people:vPeople,loans:vLoans,cash:vCash,requests:vReq,docs:vDocs,help:vHelp,settings:vSet}[cur])()}
const V=h=>document.getElementById("view").innerHTML=h;

/* ===== לוח בקרה ===== */
function vDash(){
  const t=totals();
  const activeBorrowers=new Set(db.loans.filter(l=>loanStatus(l)!=="closed").map(l=>l.personId)).size;
  const openLoans=db.loans.filter(l=>loanStatus(l)!=="closed").length;
  const overdue=db.loans.filter(l=>loanStatus(l)==="over");
  const byBranch={};
  db.settings.branches.forEach(b=>byBranch[b]=0);
  db.loans.forEach(l=>{const b=(db.people.find(p=>p.id===l.personId)||{}).branch||"—";byBranch[b]=(byBranch[b]||0)+Math.max(0,loanBalance(l))});
  const brRows=Object.entries(byBranch).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
  const recovered=t.given?Math.min(100,Math.round(t.repaid/t.given*100)):0;
  const silent=db.people.map(p=>({p,debt:personDebt(p.id),...personLastActivity(p.id)}))
    .filter(x=>x.debt>0&&x.days>=LATE).sort((a,b)=>b.days-a.days);
  const owing=db.people.map(p=>({p,debt:personDebt(p.id)})).filter(x=>x.debt>0).sort((a,b)=>b.debt-a.debt);
  const gap=(db.settings.bankBalance||0)-t.inbox;
  V(`
  <div class="grid kpis">
    <div class="kpi accent"><div class="lbl">סך הקרן (כולל בחוץ)</div><div class="val">${nis(t.keren)}</div></div>
    <div class="kpi"><div class="lbl">כסף פנוי בקופה</div><div class="val">${nis(t.inbox)}</div></div>
    <div class="kpi"><div class="lbl">כסף בהלוואות פתוחות</div><div class="val">${nis(t.outside)}</div></div>
    <div class="kpi"><div class="lbl">לווים פעילים</div><div class="val small">${activeBorrowers} <span class="muted" style="font-size:13px">(${openLoans} הלוואות)</span></div></div>
  </div>
  <div class="card" style="margin-top:16px">
    <h2>סקירה כספית</h2>
    <div class="split">
      <div>
        <table><tbody>
          <tr><td>סה"כ ניתן בהלוואות</td><td class="right" style="font-weight:600">${nis(t.given)}</td></tr>
          <tr><td>סה"כ הוחזר</td><td class="right" style="font-weight:600">${nis(t.repaid)}</td></tr>
          <tr><td>תרומות / הפקדות</td><td class="right" style="font-weight:600">${nis(t.deposits)}</td></tr>
          <tr><td>משיכות / הוצאות</td><td class="right" style="font-weight:600">${nis(t.withdraws)}</td></tr>
        </tbody></table>
        <div class="muted" style="margin-top:10px;font-size:13px">אחוז החזר מתוך שניתן</div>
        <div class="bar"><i style="width:${recovered}%"></i></div>
        <div class="muted" style="font-size:12px;margin-top:3px">${recovered}%</div>
      </div>
      <div>
        <h3 style="font-size:14px;color:var(--muted);margin-bottom:8px">פילוח לפי סניף (יתרות בחוץ)</h3>
        ${brRows.length?`<table><tbody>${brRows.map(([b,v])=>`<tr><td>${esc(b)}</td><td class="right" style="font-weight:600">${nis(v)}</td></tr>`).join("")}</tbody></table>`:'<div class="empty">אין הלוואות פתוחות</div>'}
      </div>
    </div>
  </div>
  <div class="card">
    <h2>יתרת בנק בפועל</h2>
    <div class="row" style="align-items:center">
      <div class="f"><label>הזן ידנית</label><input id="bankbal" type="number" value="${db.settings.bankBalance||0}" style="max-width:160px" onchange="saveBankBalance(this.value)"></div>
      <div class="f"><label>פער מול הקופה שבמערכת</label>
        <div style="font-weight:700;font-size:17px;color:${gap===0?'var(--green-d)':'var(--red)'}">${nis(gap)}</div>
      </div>
      <div class="muted" style="font-size:12.5px;max-width:340px">0 = תואם. אחר = יש הפרש בין מה שבפועל בבנק לבין מה שהמערכת מחשבת שאמור להיות (קופה פנויה).</div>
    </div>
  </div>
  ${silent.length?`<div class="card"><h2>⚠ דורש טיפול — לווים ששתקו מעל ${LATE} יום (${silent.length})</h2>
    <table><thead><tr><th>שם</th><th>חוב פתוח</th><th>תשלום אחרון</th><th>ימים מאז</th><th>טלפון</th></tr></thead><tbody>
    ${silent.map(x=>`<tr><td><button class="link" onclick="openPerson('${x.p.id}')">${esc(x.p.name)}</button></td><td>${nis(x.debt)}</td><td class="muted">${x.lastPay?heDate(x.lastPay):"טרם נרשם תשלום"}</td><td style="color:var(--red);font-weight:600">${x.days}</td><td class="muted">${esc(x.p.phone||"")}</td></tr>`).join("")}
    </tbody></table></div>`:`<div class="card"><div class="empty">אין לווים ששתקו מעל ${LATE} יום — כולם משלמים בזמן.</div></div>`}
  ${overdue.length?`<div class="card"><h2>⚠ הלוואות באיחור (${overdue.length})</h2>
    <table><thead><tr><th>שם</th><th>סכום מקורי</th><th>יתרה</th><th>תאריך יעד</th></tr></thead><tbody>
    ${overdue.map(l=>`<tr><td><button class="link" onclick="openPerson('${l.personId}')">${esc(personName(l.personId))}</button></td><td>${nis(l.amount)}</td><td style="color:var(--red);font-weight:600">${nis(loanBalance(l))}</td><td>${heDate(l.dueDate)}</td></tr>`).join("")}
    </tbody></table></div>`:""}
  ${owing.length?`<div class="card"><h2>כל מי שחייב כסף — מהחוב הגדול לקטן</h2>
    <table><thead><tr><th>שם</th><th>חוב פתוח</th><th>טלפון</th></tr></thead><tbody>
    ${owing.map(x=>`<tr><td><button class="link" onclick="openPerson('${x.p.id}')">${esc(x.p.name)}</button></td><td style="font-weight:600">${nis(x.debt)}</td><td class="muted">${esc(x.p.phone||"")}</td></tr>`).join("")}
    </tbody></table></div>`:""}
  `);
}
async function saveBankBalance(v){
  const n=+v||0;
  await withBusy(async()=>{await AUTH.api("settings?id=eq.1",{method:"PATCH",body:JSON.stringify({bank_balance:n})});db.settings.bankBalance=n});
  render();
}

/* ===== אנשים ===== */
let pQuery="";
function vPeople(){
  V(`
  <div class="card">
    <h2>👥 ניהול אנשים <span class="muted" style="font-size:13px;font-weight:400">— לחיצה על שם פותחת כרטיס עם כל ההלוואות והחזרים</span></h2>
    <div class="row">
      <div class="f search"><label>חיפוש (שם / טלפון / ת"ז / סניף)</label><input id="pq" value="${esc(pQuery)}" oninput="pQuery=this.value;renderPeopleTable()" placeholder="הקלד לסינון..."></div>
      <button class="btn" onclick="editPerson()">+ אדם חדש</button>
    </div>
    <div id="ptable" style="margin-top:14px"></div>
  </div>`);
  renderPeopleTable();
}
function renderPeopleTable(){
  const q=pQuery.trim();
  const list=db.people.filter(p=>!q||(p.name+(p.phone||"")+(p.idNum||"")+(p.branch||"")).includes(q)).sort((a,b)=>a.name.localeCompare(b.name,"he"));
  const el=document.getElementById("ptable");if(!el)return;
  if(!list.length){el.innerHTML='<div class="empty">אין אנשים להצגה. הוסף אדם חדש כדי להתחיל.</div>';return}
  el.innerHTML=`<table><thead><tr><th>שם</th><th>טלפון</th><th>סניף</th><th>יתרת חוב</th><th>הלוואות פתוחות</th></tr></thead><tbody>
  ${list.map(p=>{const ls=db.loans.filter(l=>l.personId===p.id);const bal=ls.reduce((s,l)=>s+Math.max(0,loanBalance(l)),0);const open=ls.filter(l=>loanStatus(l)!=="closed").length;
  return `<tr><td><button class="link" onclick="openPerson('${p.id}')">${esc(p.name)}</button></td><td class="muted">${esc(p.phone||"")}</td><td>${esc(p.branch||"")}</td><td style="font-weight:600${bal>0?';color:var(--red)':''}">${nis(bal)}</td><td>${open||"—"}</td></tr>`}).join("")}
  </tbody></table>`;
}
function editPerson(id){
  const p=id?db.people.find(x=>x.id===id):{name:"",phone:"",idNum:"",branch:db.settings.branches[0]||"",address:"",notes:""};
  openModal(`<h2>${id?"עריכת אדם":"אדם חדש"} <button class="x" onclick="closeModal()">×</button></h2>
  <div class="grid" style="gap:10px">
    <div class="f"><label>שם מלא *</label><input id="m_name" value="${esc(p.name)}"></div>
    <div class="split">
      <div class="f"><label>טלפון</label><input id="m_phone" value="${esc(p.phone||"")}"></div>
      <div class="f"><label>ת"ז</label><input id="m_id" value="${esc(p.idNum||"")}"></div>
    </div>
    <div class="f"><label>סניף / מקום</label><select id="m_branch">${db.settings.branches.map(b=>`<option ${b===p.branch?"selected":""}>${esc(b)}</option>`).join("")}</select></div>
    <div class="f"><label>כתובת</label><input id="m_address" value="${esc(p.address||"")}"></div>
    <div class="f"><label>הערות</label><textarea id="m_notes" rows="2">${esc(p.notes||"")}</textarea></div>
    <div class="row"><button class="btn" onclick="savePerson('${id||""}')">שמירה</button>${id?`<button class="btn danger mini" onclick="delPerson('${id}')">מחיקת אדם</button>`:""}<button class="btn gray" onclick="closeModal()">ביטול</button></div>
  </div>`);
}
async function savePerson(id){
  const name=document.getElementById("m_name").value.trim();if(!name){alert("חובה שם");return}
  const o={name,phone:document.getElementById("m_phone").value.trim(),id_num:document.getElementById("m_id").value.trim(),branch:document.getElementById("m_branch").value,address:document.getElementById("m_address").value.trim(),notes:document.getElementById("m_notes").value.trim()};
  await withBusy(async()=>{
    if(id){await AUTH.api(`people?id=eq.${id}`,{method:"PATCH",body:JSON.stringify(o)})}
    else{await AUTH.api("people",{method:"POST",body:JSON.stringify(o)})}
    await loadAll();
  });
  closeModal();render();
}
async function delPerson(id){
  if(db.loans.some(l=>l.personId===id)){alert("לא ניתן למחוק — קיימות הלוואות רשומות לאדם זה");return}
  if(!confirm("למחוק את האדם?"))return;
  await withBusy(async()=>{await AUTH.api(`people?id=eq.${id}`,{method:"DELETE"});await loadAll()});
  closeModal();render();
}

function openPerson(id){
  const p=db.people.find(x=>x.id===id);if(!p)return;
  const ls=db.loans.filter(l=>l.personId===id).sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  const bal=ls.reduce((s,l)=>s+Math.max(0,loanBalance(l)),0);
  openModal(`<h2>${esc(p.name)} <button class="x" onclick="closeModal()">×</button></h2>
  <div style="margin:-4px 0 10px">
    ${p.phone?`<span class="pill">📞 ${esc(p.phone)}</span>`:""}${p.branch?`<span class="pill">📍 ${esc(p.branch)}</span>`:""}${p.idNum?`<span class="pill">ת"ז ${esc(p.idNum)}</span>`:""}${p.address?`<span class="pill">🏠 ${esc(p.address)}</span>`:""}
    <span class="pill" style="background:${bal>0?'#fbe8e8':'var(--green-l)'};color:${bal>0?'var(--red)':'var(--green-d)'}">יתרת חוב: ${nis(bal)}</span>
  </div>
  ${p.notes?`<div class="muted" style="font-size:13px;margin-bottom:10px">${esc(p.notes)}</div>`:""}
  <div class="row" style="margin-bottom:10px"><button class="btn mini" onclick="addLoan('${id}')">+ הלוואה</button><button class="btn ghost mini" onclick="editPerson('${id}')">עריכת פרטים</button></div>
  ${ls.length?ls.map(l=>{const st=loanStatus(l),paid=loanPaid(l.id),rp=db.repays.filter(r=>r.loanId===l.id).sort((a,b)=>(a.date||"").localeCompare(b.date||""));
    return `<div class="card" style="box-shadow:none;margin-bottom:10px;padding:13px">
      <div class="row" style="align-items:center"><b>הלוואה ${nis(l.amount)}</b> <span class="tag ${st}">${{open:"פתוחה",closed:"נפרעה",over:"באיחור"}[st]}</span>
      <span class="muted right" style="font-size:12px">${heDate(l.date)}${l.dueDate?" · יעד "+heDate(l.dueDate):""}</span></div>
      ${l.notes?`<div class="muted" style="font-size:12.5px;margin:4px 0">${esc(l.notes)}</div>`:""}
      <div style="font-size:13px;margin:6px 0">הוחזר ${nis(paid)} · יתרה <b>${nis(loanBalance(l))}</b></div>
      <div class="bar"><i style="width:${l.amount?Math.min(100,paid/l.amount*100):0}%"></i></div>
      ${rp.length?`<table style="margin-top:8px"><tbody>${rp.map(r=>`<tr><td class="muted" style="font-size:12.5px">${heDate(r.date)} ${esc(r.note||"")}</td><td class="right">${nis(r.amount)}</td><td style="width:1%"><button class="link" style="color:var(--red)" onclick="delRepay('${r.id}','${id}')">✕</button></td></tr>`).join("")}</tbody></table>`:""}
      ${l.contractLink?`<div style="margin-top:6px"><a class="link" href="${esc(l.contractLink)}" target="_blank" rel="noopener">📎 החוזה החתום</a></div>`:""}
      <div class="row" style="margin-top:8px">${st!=="closed"?`<button class="btn mini" onclick="addRepay('${l.id}','${id}')">+ החזר</button>`:""}<button class="btn ghost mini" onclick="docPerson='${id}';docLoan='${l.id}';closeModal();go('docs')">📄 מסמכים</button><button class="btn gray mini" onclick="editLoan('${l.id}','${id}')">עריכה</button><button class="btn danger mini" onclick="delLoan('${l.id}','${id}')">מחיקה</button></div>
    </div>`}).join(""):'<div class="empty">אין הלוואות רשומות</div>'}
  `);
}

/* ===== הלוואות ===== */
function vLoans(){
  const ls=db.loans.slice().sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  V(`<div class="card"><h2>🤝 כל ההלוואות</h2>
  <div class="row" style="margin-bottom:10px"><button class="btn" onclick="addLoan()">+ הלוואה חדשה</button></div>
  ${ls.length?`<table><thead><tr><th>שם</th><th>סכום</th><th>הוחזר</th><th>יתרה</th><th>סטטוס</th><th>תאריך</th><th>יעד</th></tr></thead><tbody>
  ${ls.map(l=>{const st=loanStatus(l);return `<tr><td><button class="link" onclick="openPerson('${l.personId}')">${esc(personName(l.personId))}</button></td><td>${nis(l.amount)}</td><td class="muted">${nis(loanPaid(l.id))}</td><td style="font-weight:600">${nis(loanBalance(l))}</td><td><span class="tag ${st}">${{open:"פתוחה",closed:"נפרעה",over:"באיחור"}[st]}</span></td><td class="muted">${heDate(l.date)}</td><td class="muted">${heDate(l.dueDate)}</td></tr>`}).join("")}
  </tbody></table>`:'<div class="empty">אין הלוואות. הוסף הלוואה חדשה.</div>'}
  </div>`);
}
function addLoan(personId){
  if(!db.people.length){alert("קודם הוסף אנשים בלשונית 'אנשים'");return}
  openModal(`<h2>הלוואה חדשה <button class="x" onclick="closeModal()">×</button></h2>
  <div class="grid" style="gap:10px">
    <div class="f"><label>לווה *</label><select id="l_person">${db.people.map(p=>`<option value="${p.id}" ${p.id===personId?"selected":""}>${esc(p.name)}${p.branch?" · "+esc(p.branch):""}</option>`).join("")}</select></div>
    <div class="split">
      <div class="f"><label>סכום *</label><input id="l_amount" type="number" inputmode="numeric"></div>
      <div class="f"><label>תאריך</label><input id="l_date" type="date" value="${today()}"></div>
    </div>
    <div class="split">
      <div class="f"><label>תאריך יעד להחזר</label><input id="l_due" type="date"></div>
      <div class="f"><label>מס' תשלומים (לחוזה)</label><input id="l_inst" type="number" value="12"></div>
    </div>
    <div class="split">
      <div class="f"><label>ערב 1 (שם, אופציונלי)</label><input id="l_g1"></div>
      <div class="f"><label>ערב 2 (שם, אופציונלי)</label><input id="l_g2"></div>
    </div>
    <div class="f"><label>הערות (מטרה, תנאים)</label><textarea id="l_notes" rows="2"></textarea></div>
    <div class="row"><button class="btn" onclick="saveLoan()">שמירה</button><button class="btn gray" onclick="closeModal()">ביטול</button></div>
  </div>`);
}
async function saveLoan(){
  const amount=+document.getElementById("l_amount").value;if(!amount||amount<=0){alert("סכום לא תקין");return}
  const o={person_id:document.getElementById("l_person").value,amount,loan_date:document.getElementById("l_date").value||today(),due_date:document.getElementById("l_due").value||null,
    installments:+document.getElementById("l_inst").value||12,guarantor1:document.getElementById("l_g1").value.trim(),guarantor2:document.getElementById("l_g2").value.trim(),
    notes:document.getElementById("l_notes").value.trim()};
  await withBusy(async()=>{await AUTH.api("loans",{method:"POST",body:JSON.stringify(o)});await loadAll()});
  closeModal();render();
}
function editLoan(id,back){
  const l=db.loans.find(x=>x.id===id);
  openModal(`<h2>עריכת הלוואה <button class="x" onclick="closeModal()">×</button></h2>
  <div class="grid" style="gap:10px">
    <div class="split"><div class="f"><label>סכום</label><input id="l_amount" type="number" value="${l.amount}"></div>
    <div class="f"><label>תאריך</label><input id="l_date" type="date" value="${l.date||today()}"></div></div>
    <div class="split"><div class="f"><label>תאריך יעד</label><input id="l_due" type="date" value="${l.dueDate||""}"></div>
    <div class="f"><label>מס' תשלומים (לחוזה)</label><input id="l_inst" type="number" value="${l.installments||12}"></div></div>
    <div class="split">
      <div class="f"><label>ערב 1</label><input id="l_g1" value="${esc(l.guarantor1||"")}"></div>
      <div class="f"><label>ערב 2</label><input id="l_g2" value="${esc(l.guarantor2||"")}"></div>
    </div>
    <div class="f"><label>הערות</label><textarea id="l_notes" rows="2">${esc(l.notes||"")}</textarea></div>
    <div class="f"><label>קישור לחוזה חתום (אחרי הדפסה+חתימה+העלאה לדרייב)</label><input id="l_clink" value="${esc(l.contractLink||"")}" placeholder="https://drive.google.com/..."></div>
    <div class="row"><button class="btn" onclick="saveLoanEdit('${id}','${back}')">שמירה</button><button class="btn gray" onclick="openPerson('${back}')">חזרה</button></div>
  </div>`);
}
async function saveLoanEdit(id,back){
  const o={amount:+document.getElementById("l_amount").value,loan_date:document.getElementById("l_date").value,due_date:document.getElementById("l_due").value||null,
    installments:+document.getElementById("l_inst").value||12,guarantor1:document.getElementById("l_g1").value.trim(),guarantor2:document.getElementById("l_g2").value.trim(),
    contract_link:document.getElementById("l_clink").value.trim(),notes:document.getElementById("l_notes").value.trim()};
  await withBusy(async()=>{await AUTH.api(`loans?id=eq.${id}`,{method:"PATCH",body:JSON.stringify(o)});await loadAll()});
  back?openPerson(back):render();
}
async function delLoan(id,back){
  if(!confirm("למחוק את ההלוואה וכל ההחזרים שלה?"))return;
  await withBusy(async()=>{await AUTH.api(`loans?id=eq.${id}`,{method:"DELETE"});await loadAll()});
  back?openPerson(back):render();
}

async function addRepay(loanId,back){
  const l=db.loans.find(x=>x.id===loanId);const bal=loanBalance(l);
  openModal(`<h2>רישום החזר <button class="x" onclick="closeModal()">×</button></h2>
  <div class="muted" style="margin-bottom:8px">יתרה נוכחית: <b>${nis(bal)}</b></div>
  <div class="grid" style="gap:10px">
    <div class="split"><div class="f"><label>סכום *</label><input id="r_amount" type="number" value="${bal>0?bal:''}"></div>
    <div class="f"><label>תאריך</label><input id="r_date" type="date" value="${today()}"></div></div>
    <div class="f"><label>הערה</label><input id="r_note" placeholder="מזומן / העברה / צ'ק..."></div>
    <div class="row"><button class="btn" onclick="saveRepay('${loanId}','${back}')">שמירה</button><button class="btn gray" onclick="openPerson('${back}')">חזרה</button></div>
  </div>`);
}
async function saveRepay(loanId,back){
  const amount=+document.getElementById("r_amount").value;if(!amount||amount<=0){alert("סכום לא תקין");return}
  const o={loan_id:loanId,amount,pay_date:document.getElementById("r_date").value||today(),note:document.getElementById("r_note").value.trim()};
  await withBusy(async()=>{await AUTH.api("repayments",{method:"POST",body:JSON.stringify(o)});await loadAll()});
  openPerson(back);
}
async function delRepay(id,back){
  if(!confirm("למחוק החזר?"))return;
  await withBusy(async()=>{await AUTH.api(`repayments?id=eq.${id}`,{method:"DELETE"});await loadAll()});
  openPerson(back);
}

/* ===== קופה ===== */
function vCash(){
  const cs=db.cash.slice().sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  const t=totals();
  V(`<div class="grid kpis" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
    <div class="kpi"><div class="lbl">תרומות והפקדות</div><div class="val small">${nis(t.deposits)}</div></div>
    <div class="kpi"><div class="lbl">משיכות והוצאות</div><div class="val small">${nis(t.withdraws)}</div></div>
    <div class="kpi accent"><div class="lbl">יתרה פנויה בקופה</div><div class="val small">${nis(t.inbox)}</div></div>
  </div>
  <div class="card" style="margin-top:14px"><h2>🏦 תנועות קופה</h2>
  <div class="row" style="margin-bottom:10px"><button class="btn" onclick="addCash()">+ תנועה חדשה</button><span class="muted" style="font-size:13px">הפקדות/תרומות מגדילות את הקופה, משיכות/הוצאות מקטינות. החזרי הלוואות נספרים אוטומטית.</span></div>
  ${cs.length?`<table><thead><tr><th>תאריך</th><th>סוג</th><th>מקור/יעד</th><th>הערה</th><th>סכום</th><th></th></tr></thead><tbody>
  ${cs.map(c=>`<tr><td class="muted">${heDate(c.date)}</td><td><span class="tag ${c.type==='withdraw'?'over':'closed'}">${{deposit:"הפקדה",donation:"תרומה",withdraw:"משיכה/הוצאה"}[c.type]}</span></td><td>${esc(c.source||"")}</td><td class="muted">${esc(c.note||"")}</td><td style="font-weight:600;color:${c.type==='withdraw'?'var(--red)':'var(--green-d)'}">${c.type==='withdraw'?'−':'+'}${nis(c.amount)}</td><td><button class="link" style="color:var(--red)" onclick="delCash('${c.id}')">✕</button></td></tr>`).join("")}
  </tbody></table>`:'<div class="empty">אין תנועות קופה</div>'}
  </div>`);
}
function addCash(){
  openModal(`<h2>תנועת קופה <button class="x" onclick="closeModal()">×</button></h2>
  <div class="grid" style="gap:10px">
    <div class="f"><label>סוג</label><select id="c_type"><option value="donation">תרומה</option><option value="deposit">הפקדה</option><option value="withdraw">משיכה / הוצאה</option></select></div>
    <div class="split"><div class="f"><label>סכום *</label><input id="c_amount" type="number"></div><div class="f"><label>תאריך</label><input id="c_date" type="date" value="${today()}"></div></div>
    <div class="f"><label>מקור / יעד (שם תורם, וכו')</label><input id="c_source"></div>
    <div class="f"><label>הערה</label><input id="c_note"></div>
    <div class="row"><button class="btn" onclick="saveCash()">שמירה</button><button class="btn gray" onclick="closeModal()">ביטול</button></div>
  </div>`);
}
async function saveCash(){
  const amount=+document.getElementById("c_amount").value;if(!amount||amount<=0){alert("סכום לא תקין");return}
  const o={entry_type:document.getElementById("c_type").value,amount,entry_date:document.getElementById("c_date").value||today(),source:document.getElementById("c_source").value.trim(),note:document.getElementById("c_note").value.trim()};
  await withBusy(async()=>{await AUTH.api("cash_entries",{method:"POST",body:JSON.stringify(o)});await loadAll()});
  closeModal();render();
}
async function delCash(id){
  if(!confirm("למחוק תנועה?"))return;
  await withBusy(async()=>{await AUTH.api(`cash_entries?id=eq.${id}`,{method:"DELETE"});await loadAll()});
  render();
}

/* ===== בקשות הלוואה ===== */
function vReq(){
  const rs=db.requests.slice().sort((a,b)=>(b.date||"").localeCompare(a.date||""));
  const pubLink=location.origin+location.pathname.replace(/index\.html$/,"").replace(/\/$/,"")+"/request.html";
  V(`<div class="card"><h2>📩 בקשות הלוואה</h2>
  <div class="notice">כאן נרשמות בקשות חדשות שממתינות לאישור. לאחר אישור — צור אדם/הלוואה בפועל.<br>
  <b>קישור ציבורי לשליחה</b> (בלי צורך בכניסה) — כל מי שממלא אותו נכנס ישר לרשימה הזו:<br>
  <code style="user-select:all">${esc(pubLink)}</code>
  <button class="btn mini ghost" style="margin-inline-start:8px" onclick="navigator.clipboard.writeText('${pubLink}');toast('הקישור הועתק')">העתק קישור</button></div>
  <div class="row" style="margin-bottom:10px"><button class="btn" onclick="addReq()">+ בקשה חדשה</button></div>
  ${rs.length?`<table><thead><tr><th>שם</th><th>טלפון</th><th>סכום מבוקש</th><th>סיבה</th><th>תאריך</th><th>סטטוס</th><th></th></tr></thead><tbody>
  ${rs.map(r=>`<tr><td>${esc(r.name)}</td><td class="muted">${esc(r.phone||"")}</td><td>${nis(r.amount)}</td><td class="muted">${esc(r.reason||"")}</td><td class="muted">${heDate(r.date)}</td><td><span class="tag ${r.status==='approved'?'closed':r.status==='rejected'?'over':'wait'}">${{wait:"ממתין",approved:"אושר",rejected:"נדחה"}[r.status||'wait']}</span></td>
  <td><button class="link" onclick="cycleReq('${r.id}')">שנה</button> <button class="link" style="color:var(--red)" onclick="delReq('${r.id}')">✕</button></td></tr>`).join("")}
  </tbody></table>`:'<div class="empty">אין בקשות</div>'}
  </div>`);
}
function addReq(){openModal(`<h2>בקשת הלוואה <button class="x" onclick="closeModal()">×</button></h2>
  <div class="grid" style="gap:10px">
    <div class="split"><div class="f"><label>שם *</label><input id="q_name"></div><div class="f"><label>טלפון</label><input id="q_phone"></div></div>
    <div class="f"><label>סכום מבוקש</label><input id="q_amount" type="number"></div>
    <div class="f"><label>סיבה / מטרה</label><textarea id="q_reason" rows="2"></textarea></div>
    <div class="row"><button class="btn" onclick="saveReq()">שמירה</button><button class="btn gray" onclick="closeModal()">ביטול</button></div>
  </div>`)}
async function saveReq(){
  const name=document.getElementById("q_name").value.trim();if(!name){alert("חובה שם");return}
  const o={name,phone:document.getElementById("q_phone").value.trim(),amount:+document.getElementById("q_amount").value||0,reason:document.getElementById("q_reason").value.trim(),req_date:today(),status:"wait"};
  await withBusy(async()=>{await AUTH.api("requests",{method:"POST",body:JSON.stringify(o)});await loadAll()});
  closeModal();render();
}
async function cycleReq(id){
  const r=db.requests.find(x=>x.id===id);
  const next={wait:"approved",approved:"rejected",rejected:"wait"}[r.status||"wait"];
  await withBusy(async()=>{await AUTH.api(`requests?id=eq.${id}`,{method:"PATCH",body:JSON.stringify({status:next})});await loadAll()});
  render();
}
async function delReq(id){
  if(!confirm("למחוק בקשה?"))return;
  await withBusy(async()=>{await AUTH.api(`requests?id=eq.${id}`,{method:"DELETE"});await loadAll()});
  render();
}

/* ===== הגדרות ===== */
function vSet(){
  V(`<div class="card"><h2>⚙️ הגדרות</h2>
    <div class="f" style="max-width:340px;margin-bottom:14px"><label>שם הגמ"ח</label><input id="s_name" value="${esc(db.settings.name)}" onchange="saveSettingsName(this.value)"></div>
    <h3 style="font-size:14px;margin-bottom:6px">סניפים / מקומות</h3>
    <div id="branches"></div>
    <div class="row" style="margin-top:8px"><input id="newbr" placeholder="שם סניף חדש"><button class="btn mini" onclick="addBranch()">הוספה</button></div>
  </div>
  <div class="card"><h2>נתונים</h2>
    <div class="row"><button class="btn ghost" onclick="exportJSON()">גיבוי מלא (JSON)</button><button class="btn ghost" onclick="exportCSV()">ייצוא הלוואות (CSV)</button></div>
    <div class="muted" style="font-size:12.5px;margin-top:8px">הנתונים שמורים בענן (Supabase), מוגנים בכניסה אישית. מומלץ לגבות מדי פעם.</div>
  </div>
  <div class="card"><h2>חשבון</h2>
    <div class="muted" style="font-size:13px;margin-bottom:10px">מחובר בתור ${esc((AUTH.getSession()||{}).user?.email||"")}</div>
    <button class="btn gray" onclick="AUTH.logout()">התנתקות</button>
  </div>`);
  renderBranches();
}
async function saveSettingsName(v){
  await withBusy(async()=>{await AUTH.api("settings?id=eq.1",{method:"PATCH",body:JSON.stringify({name:v})});db.settings.name=v});
  document.getElementById("gname").textContent=v;
}
function renderBranches(){const el=document.getElementById("branches");if(!el)return;el.innerHTML=db.settings.branches.map(b=>`<span class="pill">${esc(b)} <button class="link" style="color:var(--red)" onclick="delBranch('${esc(b)}')">✕</button></span>`).join("")}
async function addBranch(){
  const v=document.getElementById("newbr").value.trim();if(!v||db.settings.branches.includes(v))return;
  const branches=db.settings.branches.concat([v]);
  await withBusy(async()=>{await AUTH.api("settings?id=eq.1",{method:"PATCH",body:JSON.stringify({branches})});db.settings.branches=branches});
  renderBranches();document.getElementById("newbr").value="";
}
async function delBranch(b){
  if(db.settings.branches.length<=1){alert("חייב סניף אחד לפחות");return}
  const branches=db.settings.branches.filter(x=>x!==b);
  await withBusy(async()=>{await AUTH.api("settings?id=eq.1",{method:"PATCH",body:JSON.stringify({branches})});db.settings.branches=branches});
  renderBranches();
}

/* ===== מסמכים ===== */
const CONTRACTS_URL="https://drive.google.com/drive/folders/13mfrZsCe5_gvSOgeagEh92aGBGfsjrG_";
function addMonths(dateStr,n){
  const [y,m,d]=dateStr.split("-").map(Number);
  const total=(m-1)+n, ny=y+Math.floor(total/12), nm=((total%12)+12)%12;
  const daysInMonth=new Date(ny,nm+1,0).getDate();
  return ny+"-"+String(nm+1).padStart(2,"0")+"-"+String(Math.min(d,daysInMonth)).padStart(2,"0");
}
let docPerson="",docLoan="";
function vDocs(){
  const person=db.people.find(p=>p.id===docPerson);
  const personLoans=person?db.loans.filter(l=>l.personId===person.id).sort((a,b)=>(b.date||"").localeCompare(a.date||"")):[];
  if(docLoan&&!personLoans.some(l=>l.id===docLoan))docLoan="";
  const loan=personLoans.find(l=>l.id===docLoan);
  V(`
  <div class="card">
    <h2>📄 מסמכים — חוזה הלוואה ואישור יתרה</h2>
    <div class="notice">בחר לווה, ואז הלוואה קיימת שלו — שני המסמכים למטה יתמלאו לבד מפרטי אותה הלוואה.
    צריך ליצור את ההלוואה קודם בלשונית "הלוואות" (כולל מס' תשלומים וערבים, אם רלוונטי).</div>
    <div class="row">
      <div class="f"><label>לווה</label><select id="d_person" onchange="docPerson=this.value;docLoan='';go('docs')">
        <option value="">— בחר —</option>
        ${db.people.map(p=>`<option value="${p.id}" ${p.id===docPerson?"selected":""}>${esc(p.name)}</option>`).join("")}
      </select></div>
      ${person?`<div class="f"><label>הלוואה</label><select id="d_loan" onchange="docLoan=this.value;go('docs')">
        <option value="">— בחר —</option>
        ${personLoans.map(l=>`<option value="${l.id}" ${l.id===docLoan?"selected":""}>${nis(l.amount)} · ${heDate(l.date)}</option>`).join("")}
      </select></div>`:""}
    </div>
    ${person&&!personLoans.length?'<div class="empty" style="margin-top:10px">ללווה הזה אין עדיין הלוואות רשומות.</div>':""}
  </div>
  ${loan?docContractHtml(person,loan)+docBalanceHtml(person):""}
  <div class="card">
    <h2>תיקיית החוזים החתומים</h2>
    <p class="muted" style="font-size:13.5px">אחרי חתימה בעט: לצלם, להעלות לתיקייה הזו בדרייב, ואז להדביק
    את הקישור בשדה "קישור לחוזה" בעריכת ההלוואה (לשונית הלוואות / כרטיס הלקוח).</p>
    <a class="link" href="${CONTRACTS_URL}" target="_blank" rel="noopener">◆ פתיחת תיקיית החוזים בדרייב</a>
  </div>
  `);
}
function docContractHtml(person,l){
  const per=Math.round(l.amount/(l.installments||12));
  const first=addMonths(l.date,1),last=addMonths(l.date,l.installments||12);
  return `<div class="card print-doc" id="doc-contract">
    <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:10px">
      <h2 style="margin:0">חוזה הלוואה</h2>
      <button class="btn mini no-print" onclick="printDoc('doc-contract')">🖨 הדפס חוזה</button>
    </div>
    <div class="docsheet">
      <div class="dochead">◆ חוזה הלוואה — ${esc(db.settings.name)}</div>
      <p>נערך ונחתם ביום ${heDate(l.date)}</p>
      <p>בין הגמ״ח (להלן: המלווה) לבין: <b>${esc(person.name)}</b> ת.ז. ${esc(person.idNum||"____________")}</p>
      <p>מכתובת: ${esc(person.address||"____________")} טלפון: ${esc(person.phone||"____________")}</p>
      <p>(להלן: הלווה)</p>
      <p>1. המלווה מעניק ללווה הלוואה בסך ${l.amount.toLocaleString("he-IL")} ש״ח (להלן: סכום ההלוואה).</p>
      <p>2. הלווה מתחייב להחזיר את סכום ההלוואה ב-${l.installments||12} תשלומים חודשיים שווים בסך ${per.toLocaleString("he-IL")} ש״ח כל אחד.</p>
      <p>3. התשלום הראשון ישולם עד ליום ${heDate(first)}, והאחרון עד ליום ${heDate(last)}.</p>
      <p>4. ההלוואה ניתנת ללא ריבית וללא הצמדה, בהתאם להלכות איסור ריבית.</p>
      <p>5. איחור בתשלום מחייב הודעה מוקדמת למלווה ותיאום מועד חלופי.</p>
      <p>6. הלווה מאשר כי קרא את החוזה, הבין את תוכנו, וחתם עליו מרצונו החופשי.</p>
      <p style="margin-top:14px"><b>ערבים (שם מלא, ת.ז. וחתימה):</b></p>
      <p>1. ${esc(l.guarantor1||"")}&nbsp; ______________________________________________________</p>
      <p>2. ${esc(l.guarantor2||"")}&nbsp; ______________________________________________________</p>
      <div class="row" style="margin-top:18px">
        <div>חתימת הלווה: ______________</div>
        <div class="right">חתימת הגבאי: ______________</div>
      </div>
    </div>
  </div>`;
}
function docBalanceHtml(person){
  const loans=db.loans.filter(l=>l.personId===person.id);
  const given=loans.reduce((s,l)=>s+l.amount,0);
  const paid=loans.reduce((s,l)=>s+loanPaid(l.id),0);
  const debt=loans.reduce((s,l)=>s+Math.max(0,loanBalance(l)),0);
  const {lastPay}=personLastActivity(person.id);
  return `<div class="card print-doc" id="doc-balance">
    <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:10px">
      <h2 style="margin:0">אישור יתרת חוב</h2>
      <button class="btn mini no-print" onclick="printDoc('doc-balance')">🖨 הדפס אישור</button>
    </div>
    <div class="docsheet">
      <div class="dochead">◆ אישור יתרת חוב</div>
      <p>תאריך ההנפקה: ${heDate(today())}</p>
      <p>לכבוד: <b>${esc(person.name)}</b> ת.ז. ${esc(person.idNum||"____________")}</p>
      <p>קיבלת מהגמ״ח בהלוואות, במצטבר, סך של ${given.toLocaleString("he-IL")} ש״ח.</p>
      <p>החזרת עד היום סך של ${paid.toLocaleString("he-IL")} ש״ח.</p>
      <p>התשלום האחרון שנרשם: ${lastPay?heDate(lastPay):"טרם נרשם תשלום"}</p>
      <p style="margin-top:10px;font-size:16px"><b>◆ יתרת החוב הפתוחה: ${nis(debt)}</b></p>
      <p style="margin-top:14px;font-size:12.5px;color:var(--muted)">אישור זה מופק מתוך מערכת הנהלת החשבונות של הגמ"ח ומשקף את הרישומים נכון למועד ההנפקה.</p>
      <div style="margin-top:18px">חתימת הגבאי: ______________</div>
    </div>
  </div>`;
}
function printDoc(id){
  document.querySelectorAll(".print-doc").forEach(d=>d.classList.remove("print-only"));
  document.getElementById(id).classList.add("print-only");
  document.body.classList.add("printing-doc");
  window.print();
  setTimeout(()=>document.body.classList.remove("printing-doc"),300);
}

/* ===== הסבר ===== */
function vHelp(){
  V(`<div class="card help"><h2>❓ איך המערכת עובדת</h2>
  <p>זו מערכת ניהול מלאה לגמ"ח כספים (הלוואות ללא ריבית). כל הנתונים נשמרים <b>בענן</b>
  (Supabase), עם כניסה אישית והרשאות אמיתיות בצד השרת — נגישים מכל מכשיר, בלי סיכון אובדן.</p>
  <h3>הזרימה המומלצת</h3>
  <p>1. <b>הגדרות</b> — קבע את שם הגמ"ח ואת רשימת הסניפים/המקומות.<br>
  2. <b>אנשים</b> — הוסף את הלווים. לחיצה על שם פותחת כרטיס אישי עם כל ההלוואות וההחזרים שלו.<br>
  3. <b>הלוואות</b> — רשום הלוואה חדשה (סכום, תאריך, יעד להחזר, הערות).<br>
  4. כשאדם מחזיר — פתח את הכרטיס שלו ולחץ <b>+ החזר</b>. היתרה מתעדכנת אוטומטית והסטטוס משתנה ל"נפרעה".<br>
  5. <b>קופה</b> — רשום תרומות, הפקדות והוצאות. <br>
  6. <b>בקשות</b> — נהל בקשות חדשות שממתינות לאישור, כולל בקשות שהגיעו מהקישור הציבורי (ראה מטה).<br>
  7. <b>מסמכים</b> — בחר לווה+הלוואה קיימת כדי להפיק ולהדפיס חוזה הלוואה ואישור יתרת חוב.</p>
  <h3>לוח הבקרה — איך מחושב</h3>
  <p>• <b>כסף פנוי בקופה</b> = תרומות והפקדות + החזרים − הלוואות שניתנו − משיכות.<br>
  • <b>כסף בהלוואות פתוחות</b> = סכום היתרות שעדיין לא הוחזרו.<br>
  • <b>סך הקרן</b> = הכסף בקופה + הכסף שבחוץ (זהו ההון הכולל של הגמ"ח).<br>
  • <b>פילוח לפי סניף</b> — כמה כסף "בחוץ" בכל מקום.<br>
  • <b>פער מול הבנק</b> — הפרש בין מה שהזנת כיתרת בנק בפועל לבין מה שהמערכת מחשבת שאמור להיות.<br>
  • <b>מי שתק</b> — לווים עם חוב פתוח ו-60+ יום בלי תשלום (נספר מהתשלום האחרון, או מההלוואה
  האחרונה אם מעולם לא שילם).</p>
  <h3>מסמכים וחוזה הלוואה</h3>
  <p>בלשונית <b>מסמכים</b>: בוחרים לווה ואז אחת מההלוואות הרשומות שלו — מופקים אוטומטית חוזה
  הלוואה מלא (עם ערבים אם מולאו, תאריכי תשלום ראשון/אחרון מחושבים) ואישור יתרת חוב. לכל מסמך
  כפתור הדפסה נפרד. אחרי חתימה בעט: לצלם, להעלות לתיקיית "חוזים חתומים" בדרייב (קישור בלשונית
  עצמה), ולהדביק את כתובת הקובץ בשדה "קישור לחוזה חתום" בעריכת ההלוואה.</p>
  <h3>קישור ציבורי לבקשת הלוואה</h3>
  <p>בלשונית <b>בקשות</b> יש קישור שאפשר לשלוח לכל מי שרוצה לבקש הלוואה — הוא ממלא טופס קצר
  בלי צורך בכניסה למערכת, והבקשה מופיעה אצלך מיד ברשימת הבקשות הממתינות. אין דרך לראות דרך
  הקישור הזה נתונים קיימים — הוא רק לשליחת בקשה חדשה.</p>
  <h3>גיבוי</h3>
  <p>בכל עת אפשר ללחוץ <b>גיבוי מלא</b> בהגדרות (מוריד קובץ JSON) — מומלץ מדי פעם, כרשת ביטחון נוספת מעל הענן.</p>
  <h3>מי יכול להיכנס</h3>
  <p>הכניסה מוגנת בסיסמה אישית, ורק משתמש שהוגדר מראש (בטבלת ההרשאות בשרת) יכול לראות
  או לערוך נתונים — כולל אתה, גם אם מישהו יגיע לכתובת האתר הפומבית.</p>
  </div>`);
}

/* ===== מודל ===== */
function openModal(h){document.getElementById("modal").innerHTML=h;document.getElementById("overlay").classList.add("on")}
function closeModal(){document.getElementById("overlay").classList.remove("on")}

/* ===== ייצוא ===== */
function exportJSON(){const b=new Blob([JSON.stringify(db,null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="gemach-backup-"+today()+".json";a.click()}
function exportCSV(){
  const rows=[["שם","סניף","סכום","הוחזר","יתרה","סטטוס","תאריך","יעד","הערות"]];
  db.loans.forEach(l=>rows.push([personName(l.personId),(db.people.find(p=>p.id===l.personId)||{}).branch||"",l.amount,loanPaid(l.id),loanBalance(l),{open:"פתוחה",closed:"נפרעה",over:"באיחור"}[loanStatus(l)],l.date,l.dueDate||"",(l.notes||"").replace(/[\n,]/g," ")]));
  const csv="﻿"+rows.map(r=>r.map(c=>`"${(""+c).replace(/"/g,'""')}"`).join(",")).join("\n");
  const b=new Blob([csv],{type:"text/csv"});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="gemach-loans-"+today()+".csv";a.click();
}

/* ===== המראה (בוט) ===== */
async function boot(){
  if(!AUTH.isValid()){showLogin();return}
  showApp();
  document.getElementById("view").innerHTML='<div class="empty">טוען…</div>';
  try{await loadAll()}catch(e){showLogin(e.message);return}
  nav();render();
}
function showLogin(err){
  document.getElementById("app").style.display="none";
  document.getElementById("loginwrap").style.display="flex";
  document.getElementById("loginerr").textContent=err||"";
}
function showApp(){
  document.getElementById("loginwrap").style.display="none";
  document.getElementById("app").style.display="block";
}
async function doLogin(ev){
  ev.preventDefault();
  const email=document.getElementById("lg_email").value.trim();
  const pass=document.getElementById("lg_pass").value;
  const btn=document.getElementById("lg_btn");btn.disabled=true;btn.textContent="מתחבר…";
  try{await AUTH.login(email,pass);await boot()}
  catch(e){document.getElementById("loginerr").textContent=e.message}
  finally{btn.disabled=false;btn.textContent="כניסה"}
}
document.addEventListener("DOMContentLoaded",boot);
