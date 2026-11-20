const fs = require('node:fs');
const path = require('node:path');
const { db } = require('../server');

const source = process.argv[2] || 'C:\\Users\\xif66\\Downloads\\Telegram Desktop\\Omani-Labor-Law-update (2).pdf';
if (!fs.existsSync(source)) throw new Error(`Source PDF not found: ${source}`);

const admin = db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get();
if (!admin) throw new Error('Admin seed account is missing');

const title = 'Omani Labour Law Update';
const summary = 'Uploaded legal reference document. HR or Legal must review and approve this document before the HR Agent can use it as an approved policy source.';
const content = [
  'Source document: Omani Labor Law update PDF attached to this policy.',
  'Approval gate: the HR Agent must not treat this document as an approved policy until an authorized HR or Legal administrator changes its status to Approved.',
  'Legal safeguards: do not infer legal rates or obligations from an unapproved draft; refer unclear or exceptional questions to HR or Legal.'
];

let policy = db.prepare('SELECT * FROM policies WHERE title=? LIMIT 1').get(title);
if (!policy) {
  const result = db.prepare('INSERT INTO policies(title,section,summary,status,effective_date,current_version,created_by) VALUES (?,?,?,?,?,?,?)').run(title,'Omani Labour Law · Reference',summary,'draft',null,'1.0',admin.id);
  policy = db.prepare('SELECT * FROM policies WHERE id=?').get(result.lastInsertRowid);
  db.prepare('INSERT INTO policy_versions(policy_id,version,content_json,status,effective_date,created_by) VALUES (?,?,?,?,?,?)').run(policy.id,'1.0',JSON.stringify(content),'draft',null,admin.id);
}

const uploadDir = path.join(__dirname, '..', 'data', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const storedName = `omani-labor-law-update-${policy.id}.pdf`;
const destination = path.join(uploadDir, storedName);
fs.copyFileSync(source, destination);
const existingFile = db.prepare('SELECT id FROM policy_files WHERE policy_id=? AND original_name=? LIMIT 1').get(policy.id,path.basename(source));
if (!existingFile) {
  db.prepare('INSERT INTO policy_files(policy_id,original_name,stored_name,mime_type,size_bytes,uploaded_by) VALUES (?,?,?,?,?,?)').run(policy.id,path.basename(source),storedName,'application/pdf',fs.statSync(destination).size,admin.id);
}
db.prepare('INSERT INTO audit_logs(actor_id,action,entity,entity_id,details_json) VALUES (?,?,?,?,?)').run(admin.id,'legal_reference_imported','policy',policy.id,JSON.stringify({status:'draft',source:path.basename(source)}));
console.log(JSON.stringify({policyId:policy.id,title,status:'draft',version:'1.0',file:storedName}));
db.close();
