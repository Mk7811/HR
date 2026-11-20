const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'peopleflow.sqlite');
const PORT = Number(process.env.PORT || 3000);
const TOKEN_SECRET = process.env.PEOPLEFLOW_TOKEN_SECRET || 'local-development-secret-change-me';
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const db = new DatabaseSync(DB_FILE);

function initDb() {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('employee','hr','admin')), salary_omr REAL NOT NULL DEFAULT 0,
      password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS policies (
      id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, section TEXT NOT NULL,
      summary TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','approved')) DEFAULT 'draft',
      effective_date TEXT, current_version TEXT NOT NULL DEFAULT '1.0', created_by INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(created_by) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS policy_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, policy_id INTEGER NOT NULL, version TEXT NOT NULL,
      content_json TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','approved')),
      effective_date TEXT, created_by INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(policy_id) REFERENCES policies(id) ON DELETE CASCADE, FOREIGN KEY(created_by) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS policy_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT, policy_id INTEGER NOT NULL, original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL, mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL,
      uploaded_by INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(policy_id) REFERENCES policies(id) ON DELETE CASCADE, FOREIGN KEY(uploaded_by) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT, requester_id INTEGER NOT NULL, type TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(requester_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT, request_id INTEGER NOT NULL, approver_id INTEGER NOT NULL,
      decision TEXT NOT NULL CHECK(decision IN ('approved','rejected')), note TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(request_id, approver_id),
      FOREIGN KEY(request_id) REFERENCES requests(id) ON DELETE CASCADE, FOREIGN KEY(approver_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS leave_balances (
      id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL, opening REAL NOT NULL,
      accrued REAL NOT NULL, taken REAL NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(employee_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS attendance_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL, clock_in TEXT NOT NULL,
      clock_out TEXT NOT NULL, break_minutes INTEGER NOT NULL DEFAULT 0, scheduled_start TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(employee_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS overtime_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT, employee_id INTEGER NOT NULL, basic_salary REAL NOT NULL,
      hours REAL NOT NULL, category TEXT NOT NULL, multiplier REAL NOT NULL, amount_omr REAL NOT NULL,
      approval_recorded INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(employee_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS knowledge_base_updates (
      id INTEGER PRIMARY KEY AUTOINCREMENT, policy_id INTEGER NOT NULL, version TEXT NOT NULL,
      action TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(policy_id) REFERENCES policies(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id INTEGER, action TEXT NOT NULL,
      entity TEXT NOT NULL, entity_id INTEGER, details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(actor_id) REFERENCES users(id)
    );
  `);
  seed();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(password, salt, 32).toString('hex')}`;
}
function verifyPassword(password, stored) {
  const [salt, expected] = String(stored).split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 32).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
}
function seed() {
  const count = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (count) return;
  const passwords = {employee:process.env.PEOPLEFLOW_EMPLOYEE_PASSWORD||crypto.randomBytes(18).toString('base64url'),hr:process.env.PEOPLEFLOW_HR_PASSWORD||crypto.randomBytes(18).toString('base64url'),admin:process.env.PEOPLEFLOW_ADMIN_PASSWORD||crypto.randomBytes(18).toString('base64url')};
  const add = db.prepare('INSERT INTO users(email,name,role,salary_omr,password_hash) VALUES (?,?,?,?,?)');
  add.run('ahmed@example.com', 'Ahmed Al Mansoori', 'employee', 650, hashPassword(passwords.employee));
  add.run('hr@example.com', 'PeopleFlow HR', 'hr', 0, hashPassword(passwords.hr));
  add.run('admin@example.com', 'PeopleFlow Admin', 'admin', 0, hashPassword(passwords.admin));
  if(!process.env.PEOPLEFLOW_EMPLOYEE_PASSWORD) console.warn('PeopleFlow local accounts were generated. Set PEOPLEFLOW_*_PASSWORD to choose credentials.');
}

const policySeed = [
  ['Salary & Benefits Policy','Section 7','Purpose: To ensure transparency in employee compensation.', ['Employee salaries are paid monthly.','Basic salary and allowances must be recorded separately.','Overtime payments must be calculated separately from basic salary.','Any salary changes must be approved by authorized management.','Employees may request a salary certificate from HR.','Salary information must remain confidential.']],
  ['Employee Data & Privacy Policy','Section 8','Rules for protecting employee information and confidential records.', ['Employee personal information must be handled confidentially.','Only authorized HR personnel may access confidential employee records.','The HR Agent must not reveal one employee’s information to another employee.','The Agent must not invent employee details or salary information.','Any request involving confidential records must follow access authorization procedures.']],
  ['HR Requests & Approvals Policy','Section 9','How the HR Agent supports employee services while preserving management review.', ['Employees may use the HR Agent to request information and HR services.','The Agent may calculate overtime, leave balances, and working hours.','The Agent may explain eligibility requirements.','Leave requests, overtime approvals, and salary changes must be reviewed by authorized managers.','The Agent must not claim that a request has been approved unless approval has actually been recorded.']],
  ['HR Agent Operational Rules','Section 10','The Agent follows these steps when processing employee requests.', ['Overtime: ask for basic salary, overtime hours, category, and recorded approval; apply the relevant sample policy multiplier; show the calculation and final amount in OMR.','Leave balance: ask for opening balance, accrued leave, and leave days taken; calculate and display the remaining calendar days.','Attendance: ask for clock-in, clock-out, and break duration; calculate total working hours and identify late arrival against the approved schedule.','Policy questions: search approved policy documents, answer from the relevant policy, explain conditions and approval requirements, and refer unclear or exceptional cases to HR.','Restrictions: never invent employee data, never approve requests automatically, never use unverified legal rates, distinguish sample rules from legal requirements, and show calculation steps for financial amounts.']]
];
function ensurePolicySeed() {
  if (db.prepare('SELECT COUNT(*) AS count FROM policies').get().count) return;
  const user = db.prepare('SELECT id FROM users WHERE role=? LIMIT 1').get('admin');
  const insert = db.prepare('INSERT INTO policies(title,section,summary,status,effective_date,current_version,created_by) VALUES (?,?,?,?,?,?,?)');
  const version = db.prepare('INSERT INTO policy_versions(policy_id,version,content_json,status,effective_date,created_by) VALUES (?,?,?,?,?,?)');
  for (const [title, section, summary, items] of policySeed) { const result = insert.run(title,section,summary,'approved','2026-01-01','1.0',user.id); version.run(result.lastInsertRowid,'1.0',JSON.stringify(items),'approved','2026-01-01',user.id); }
}
initDb(); ensurePolicySeed();

function json(res, status, body) { const payload = JSON.stringify(body); res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}); res.end(payload); }
function parseBody(req) { return new Promise((resolve,reject)=>{ let data=''; req.on('data', chunk=>{ data+=chunk; if(data.length>MAX_UPLOAD_BYTES+1024*1024) req.destroy(); }); req.on('end',()=>{ try{ resolve(data?JSON.parse(data):{}); }catch(e){ reject(new Error('Invalid JSON body')); } }); req.on('error',reject); }); }
function tokenFor(user) { const payload = Buffer.from(JSON.stringify({id:user.id,email:user.email,role:user.role,exp:Date.now()+8*60*60*1000})).toString('base64url'); const sig=crypto.createHmac('sha256',TOKEN_SECRET).update(payload).digest('base64url'); return `${payload}.${sig}`; }
function auth(req) { const value=req.headers.authorization||''; if(!value.startsWith('Bearer ')) return null; const [payload,sig]=value.slice(7).split('.'); if(!payload||!sig) return null; const expected=crypto.createHmac('sha256',TOKEN_SECRET).update(payload).digest('base64url'); if(sig.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected))) return null; try{const user=JSON.parse(Buffer.from(payload,'base64url').toString()); return user.exp>Date.now()?user:null;}catch{return null} }
function requireRole(user, roles) { return user && roles.includes(user.role); }
function audit(actor, action, entity, entityId, details={}) { db.prepare('INSERT INTO audit_logs(actor_id,action,entity,entity_id,details_json) VALUES (?,?,?,?,?)').run(actor?.id||null,action,entity,entityId||null,JSON.stringify(details)); }
function safePolicy(row, includeDrafts) { const version=db.prepare('SELECT version,content_json,status,effective_date FROM policy_versions WHERE policy_id=? AND status=? ORDER BY id DESC LIMIT 1').get(row.id, includeDrafts?'draft':'approved'); return {...row, content:version?JSON.parse(version.content_json):[], version:version?.version||row.current_version, version_status:version?.status||row.status, version_effective_date:version?.effective_date||row.effective_date}; }
function allowedFile(mime,name) { return ['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(mime) || /\.(pdf|doc|docx)$/i.test(name); }

async function handle(req,res) {
  const url=new URL(req.url,`http://${req.headers.host||'localhost'}`); const pathname=url.pathname; const method=req.method; const user=auth(req);
  try {
    if(pathname==='/api/health') return json(res,200,{ok:true,db:'sqlite'});
    if(pathname==='/api/login'&&method==='POST'){ const body=await parseBody(req); const row=db.prepare('SELECT id,email,name,role,salary_omr,password_hash FROM users WHERE email=?').get(String(body.email||'')); if(!row||!verifyPassword(String(body.password||''),row.password_hash)) return json(res,401,{error:'Invalid credentials'}); delete row.password_hash; return json(res,200,{token:tokenFor(row),user:row}); }
    if(pathname==='/api/session'&&method==='GET'){ if(!user)return json(res,401,{error:'Authentication required'}); const row=db.prepare('SELECT id,email,name,role,salary_omr FROM users WHERE id=?').get(user.id); return json(res,200,{user:row}); }
    if(pathname==='/api/policies'&&method==='GET'){ const includeDrafts=requireRole(user,['hr','admin']); const rows=db.prepare(includeDrafts?'SELECT * FROM policies ORDER BY id':'SELECT * FROM policies WHERE status=\'approved\' AND (effective_date IS NULL OR effective_date<=date(\'now\')) ORDER BY id').all(); return json(res,200,{policies:rows.map(r=>safePolicy(r,includeDrafts))}); }
    if(pathname==='/api/policies'&&method==='POST'){ if(!requireRole(user,['hr','admin']))return json(res,403,{error:'HR or Admin role required'}); const body=await parseBody(req); if(!body.title||!body.section||!Array.isArray(body.content))return json(res,400,{error:'title, section and content are required'}); const status=body.status==='approved'?'approved':'draft'; const version=String(body.version||'1.0'); const result=db.prepare('INSERT INTO policies(title,section,summary,status,effective_date,current_version,created_by) VALUES (?,?,?,?,?,?,?)').run(body.title,body.section,body.summary||'',status,body.effectiveDate||null,version,user.id); db.prepare('INSERT INTO policy_versions(policy_id,version,content_json,status,effective_date,created_by) VALUES (?,?,?,?,?,?)').run(result.lastInsertRowid,version,JSON.stringify(body.content),status,body.effectiveDate||null,user.id); if(status==='approved')db.prepare('INSERT INTO knowledge_base_updates(policy_id,version,action) VALUES (?,?,?)').run(result.lastInsertRowid,version,'policy_approved'); audit(user,'policy_created','policy',result.lastInsertRowid,{status,version}); return json(res,201,{policy:safePolicy(db.prepare('SELECT * FROM policies WHERE id=?').get(result.lastInsertRowid),true)}); }
    const policyMatch=pathname.match(/^\/api\/policies\/(\d+)$/); if(policyMatch&&['PUT','PATCH'].includes(method)){ if(!requireRole(user,['hr','admin']))return json(res,403,{error:'HR or Admin role required'}); const id=Number(policyMatch[1]); const existing=db.prepare('SELECT * FROM policies WHERE id=?').get(id); if(!existing)return json(res,404,{error:'Policy not found'}); const body=await parseBody(req); const status=body.status==='approved'?'approved':(body.status==='draft'?'draft':existing.status); const version=String(body.version||existing.current_version); db.prepare('UPDATE policies SET title=?,section=?,summary=?,status=?,effective_date=?,current_version=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(body.title||existing.title,body.section||existing.section,body.summary||existing.summary,status,body.effectiveDate??existing.effective_date,version,id); if(Array.isArray(body.content)){ db.prepare('INSERT INTO policy_versions(policy_id,version,content_json,status,effective_date,created_by) VALUES (?,?,?,?,?,?)').run(id,version,JSON.stringify(body.content),status,body.effectiveDate??existing.effective_date,user.id); } if(status==='approved'){db.prepare('INSERT INTO knowledge_base_updates(policy_id,version,action) VALUES (?,?,?)').run(id,version,'policy_approved');} audit(user,'policy_updated','policy',id,{status,version}); return json(res,200,{policy:safePolicy(db.prepare('SELECT * FROM policies WHERE id=?').get(id),true)}); }
    const fileMatch=pathname.match(/^\/api\/policies\/(\d+)\/files$/); if(fileMatch&&method==='POST'){ if(!requireRole(user,['hr','admin']))return json(res,403,{error:'HR or Admin role required'}); const body=await parseBody(req); if(!body.filename||!body.mimeType||!body.contentBase64||!allowedFile(body.mimeType,body.filename))return json(res,400,{error:'Only PDF, DOC, or DOCX files are accepted'}); const buffer=Buffer.from(body.contentBase64,'base64'); if(buffer.length>MAX_UPLOAD_BYTES)return json(res,413,{error:'File exceeds 10MB limit'}); const stored=`${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(body.filename).toLowerCase()}`; fs.writeFileSync(path.join(UPLOAD_DIR,stored),buffer,{flag:'wx'}); const result=db.prepare('INSERT INTO policy_files(policy_id,original_name,stored_name,mime_type,size_bytes,uploaded_by) VALUES (?,?,?,?,?,?)').run(Number(fileMatch[1]),body.filename,stored,body.mimeType,buffer.length,user.id); audit(user,'policy_file_uploaded','policy_file',result.lastInsertRowid,{filename:body.filename}); return json(res,201,{file:{id:result.lastInsertRowid,filename:body.filename,size:buffer.length}}); }
    if(pathname==='/api/requests'&&method==='POST'){ if(!user)return json(res,401,{error:'Authentication required'}); const body=await parseBody(req); if(!body.type)return json(res,400,{error:'Request type is required'}); const result=db.prepare('INSERT INTO requests(requester_id,type,payload_json) VALUES (?,?,?)').run(user.id,body.type,JSON.stringify(body.payload||{})); audit(user,'request_created','request',result.lastInsertRowid,{type:body.type}); return json(res,201,{request:{id:result.lastInsertRowid,type:body.type,status:'pending'}}); }
    if(pathname==='/api/requests'&&method==='GET'){ if(!user)return json(res,401,{error:'Authentication required'}); const rows=requireRole(user,['hr','admin'])?db.prepare('SELECT r.*,u.name requester_name FROM requests r JOIN users u ON u.id=r.requester_id ORDER BY r.id DESC').all():db.prepare('SELECT * FROM requests WHERE requester_id=? ORDER BY id DESC').all(user.id); return json(res,200,{requests:rows}); }
    const approveMatch=pathname.match(/^\/api\/requests\/(\d+)\/approve$/); if(approveMatch&&method==='POST'){ if(!requireRole(user,['hr','admin']))return json(res,403,{error:'Only HR or Admin may approve requests'}); const id=Number(approveMatch[1]); const request=db.prepare('SELECT * FROM requests WHERE id=?').get(id); if(!request)return json(res,404,{error:'Request not found'}); if(request.requester_id===user.id)return json(res,403,{error:'Self-approval is prohibited'}); if(db.prepare('SELECT id FROM approvals WHERE request_id=? AND decision=\'approved\'').get(id))return json(res,409,{error:'Request already approved'}); const body=await parseBody(req); db.prepare('INSERT INTO approvals(request_id,approver_id,decision,note) VALUES (?,?,?,?)').run(id,user.id,body.decision==='rejected'?'rejected':'approved',body.note||''); db.prepare('UPDATE requests SET status=? WHERE id=?').run(body.decision==='rejected'?'rejected':'approved',id); audit(user,'request_decision','request',id,{decision:body.decision||'approved'}); return json(res,200,{request:{id,status:body.decision==='rejected'?'rejected':'approved'}}); }
    const salaryMatch=pathname.match(/^\/api\/employees\/(\d+)\/salary$/); if(salaryMatch&&method==='GET'){ if(!user)return json(res,401,{error:'Authentication required'}); const id=Number(salaryMatch[1]); if(user.role==='employee'&&user.id!==id)return json(res,403,{error:'You are not authorized to view this salary information'}); if(!requireRole(user,['employee','hr','admin']))return json(res,403,{error:'Access denied'}); const row=db.prepare('SELECT id,name,salary_omr FROM users WHERE id=?').get(id); if(!row)return json(res,404,{error:'Employee not found'}); audit(user,'salary_viewed','user',id); return json(res,200,{employee:row}); }
    if(pathname==='/api/calculations/leave'&&method==='POST'){ if(!user)return json(res,401,{error:'Authentication required'}); const body=await parseBody(req); const opening=Number(body.opening),accrued=Number(body.accrued),taken=Number(body.taken); if([opening,accrued,taken].some(v=>!Number.isFinite(v)||v<0))return json(res,400,{error:'Leave values must be non-negative numbers'}); return json(res,200,{remaining:Number((opening+accrued-taken).toFixed(2)),unit:'calendar_days'}); }
    if(pathname==='/api/calculations/attendance'&&method==='POST'){ if(!user)return json(res,401,{error:'Authentication required'}); const body=await parseBody(req); const start=new Date(`1970-01-01T${body.clockIn}`),end=new Date(`1970-01-01T${body.clockOut}`); if(Number.isNaN(start.getTime())||Number.isNaN(end.getTime())||end<=start)return json(res,400,{error:'Valid clock-in and clock-out times are required'}); const breakMinutes=Number(body.breakMinutes||0); const hours=Number(((end-start)/3600000-breakMinutes/60).toFixed(2)); const scheduled=new Date(`1970-01-01T${body.scheduledStart||'08:00'}`); return json(res,200,{hours,late:start>scheduled,unit:'hours'}); }
    if(pathname==='/api/calculations/overtime'&&method==='POST'){ if(!user)return json(res,401,{error:'Authentication required'}); const body=await parseBody(req); const basic=Number(body.basicSalary),hours=Number(body.hours),multiplier=Number(body.multiplier||1.25); if(![basic,hours,multiplier].every(Number.isFinite)||basic<0||hours<0||multiplier<=0)return json(res,400,{error:'Invalid overtime values'}); if(body.approvalRecorded!==true)return json(res,409,{error:'Overtime approval must be recorded before payable overtime is calculated'}); const amount=Number((basic/208*hours*multiplier).toFixed(2)); db.prepare('INSERT INTO overtime_records(employee_id,basic_salary,hours,category,multiplier,amount_omr,approval_recorded) VALUES (?,?,?,?,?,?,1)').run(user.id,basic,hours,body.category||'regular_day',multiplier,amount); return json(res,200,{amountOMR:amount,hourlyRate:Number((basic/208).toFixed(2)),steps:['Basic salary ÷ 208','Hourly rate × overtime hours','Result × approved sample multiplier'],unit:'OMR'}); }
    if(pathname.startsWith('/api/'))return json(res,404,{error:'API route not found'});
    const filePath=pathname==='/'?path.join(ROOT,'index.html'):path.join(ROOT,pathname.replace(/^\//,'')); if(!filePath.startsWith(ROOT)||!fs.existsSync(filePath)||fs.statSync(filePath).isDirectory())return json(res,404,{error:'Not found'}); const ext=path.extname(filePath); const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'}; res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream'}); fs.createReadStream(filePath).pipe(res);
  } catch(error) { console.error(error); return json(res,500,{error:'Internal server error'}); }
}
function createApp(){ return http.createServer(handle); }
if(require.main===module){ createApp().listen(PORT,()=>console.log(`PeopleFlow HR Agent running at http://localhost:${PORT}`)); }
module.exports={createApp,db,initDb,tokenFor};
