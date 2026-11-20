process.env.PEOPLEFLOW_EMPLOYEE_PASSWORD='test-only-employee-password';
process.env.PEOPLEFLOW_HR_PASSWORD='test-only-hr-password';
process.env.PEOPLEFLOW_ADMIN_PASSWORD='test-only-admin-password';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp, db } = require('../server');

let server;
let base;
const tokens = {};

async function api(path, options={}) {
  const headers = {'Content-Type':'application/json', ...(options.token?{Authorization:`Bearer ${options.token}`}:{})};
  const response = await fetch(`${base}${path}`, {...options, headers, body: options.body===undefined?undefined:JSON.stringify(options.body)});
  const body = await response.json();
  return {status:response.status, body};
}
async function login(key,email,password){ const result=await api('/api/login',{method:'POST',body:{email,password}}); assert.equal(result.status,200); tokens[key]=result.body.token; }

test.before(async()=>{ server=createApp(); await new Promise(resolve=>server.listen(0,resolve)); base=`http://127.0.0.1:${server.address().port}`; await login('employee','ahmed@example.com','test-only-employee-password'); await login('hr','hr@example.com','test-only-hr-password'); await login('admin','admin@example.com','test-only-admin-password'); });
test.after(()=>server.close());

test('employee cannot view another employee salary', async()=>{
  const other=db.prepare("SELECT id FROM users WHERE email='hr@example.com'").get().id;
  const result=await api(`/api/employees/${other}/salary`,{token:tokens.employee});
  assert.equal(result.status,403);
});

test('employee cannot approve their own request and HR can approve it', async()=>{
  const created=await api('/api/requests',{method:'POST',token:tokens.employee,body:{type:'annual_leave',payload:{days:2}}});
  assert.equal(created.status,201);
  const own=await api(`/api/requests/${created.body.request.id}/approve`,{method:'POST',token:tokens.employee,body:{decision:'approved'}});
  assert.equal(own.status,403);
  const approved=await api(`/api/requests/${created.body.request.id}/approve`,{method:'POST',token:tokens.hr,body:{decision:'approved'}});
  assert.equal(approved.status,200);
  assert.equal(approved.body.request.status,'approved');
});

test('overtime cannot be treated as approved without recorded approval', async()=>{
  const result=await api('/api/calculations/overtime',{method:'POST',token:tokens.employee,body:{basicSalary:650,hours:6,multiplier:1.25,approvalRecorded:false}});
  assert.equal(result.status,409);
});

test('leave balance calculation returns calendar days', async()=>{
  const result=await api('/api/calculations/leave',{method:'POST',token:tokens.employee,body:{opening:15,accrued:7.5,taken:4}});
  assert.equal(result.status,200); assert.equal(result.body.remaining,18.5); assert.equal(result.body.unit,'calendar_days');
});

test('attendance calculation returns hours and late arrival', async()=>{
  const result=await api('/api/calculations/attendance',{method:'POST',token:tokens.employee,body:{clockIn:'08:30',clockOut:'17:00',breakMinutes:60,scheduledStart:'08:00'}});
  assert.equal(result.status,200); assert.equal(result.body.hours,7.5); assert.equal(result.body.late,true);
});

test('approved overtime calculation shows OMR steps', async()=>{
  const result=await api('/api/calculations/overtime',{method:'POST',token:tokens.employee,body:{basicSalary:650,hours:6,multiplier:1.25,category:'regular_day',approvalRecorded:true}});
  assert.equal(result.status,200); assert.equal(result.body.amountOMR,23.44); assert.equal(result.body.unit,'OMR'); assert.equal(result.body.steps.length,3);
});

test('HR and Admin can manage drafts, employees only see approved policies', async()=>{
  const title=`سياسة الاختبار bilingual policy ${Date.now()}`;
  const created=await api('/api/policies',{method:'POST',token:tokens.hr,body:{title,section:'Section QA',summary:'English and العربية',status:'draft',version:'0.1',content:['Draft content']}});
  assert.equal(created.status,201);
  const employeePolicies=await api('/api/policies',{token:tokens.employee});
  assert.equal(employeePolicies.status,200); assert.equal(employeePolicies.body.policies.some(p=>p.title===title),false);
  const hrPolicies=await api('/api/policies',{token:tokens.hr});
  assert.equal(hrPolicies.body.policies.some(p=>p.title===title),true);
  const approved=await api(`/api/policies/${created.body.policy.id}`,{method:'PATCH',token:tokens.admin,body:{status:'approved',version:'1.0',content:['Approved content','محتوى معتمد']}});
  assert.equal(approved.status,200); assert.equal(db.prepare('SELECT COUNT(*) AS count FROM knowledge_base_updates WHERE policy_id=?').get(created.body.policy.id).count,1);
});

test('only HR and Admin can create policies and upload approved document types', async()=>{
  const denied=await api('/api/policies',{method:'POST',token:tokens.employee,body:{title:'Nope',section:'X',content:[]}});
  assert.equal(denied.status,403);
  const policy=db.prepare('SELECT id FROM policies LIMIT 1').get().id;
  const file=await api(`/api/policies/${policy}/files`,{method:'POST',token:tokens.hr,body:{filename:'policy.pdf',mimeType:'application/pdf',contentBase64:Buffer.from('%PDF-1.4 test').toString('base64')}});
  assert.equal(file.status,201);
  const bad=await api(`/api/policies/${policy}/files`,{method:'POST',token:tokens.hr,body:{filename:'secret.exe',mimeType:'application/octet-stream',contentBase64:Buffer.from('x').toString('base64')}});
  assert.equal(bad.status,400);
});
