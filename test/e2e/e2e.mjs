// End-to-end checks against a real Directus. Run with `npm run test:e2e`.
import fs from 'node:fs';
import path from 'node:path';
import { deflateRawSync, gzipSync } from 'node:zlib';

const B = process.env.E2E_URL;
const UP = path.join(process.env.E2E_DATA, 'uploads');
let pass = 0;
let fail = 0;
const ok = (name, condition, detail = '') => {
	condition ? pass++ : fail++;
	console.log(`${condition ? 'PASS' : 'FAIL'} ${name}${condition ? '' : `  -> ${JSON.stringify(detail).slice(0, 300)}`}`);
};
const j = async (method, url, body, headers = {}, token = T) => {
	const response = await fetch(B + url, {
		method,
		headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await response.text();
	let data;
	try {
		data = JSON.parse(text);
	} catch {
		data = text;
	}
	return { s: response.status, d: data };
};
let T = null;
T = (await j('POST', '/auth/login', { email: 'admin@example.com', password: 'e2e-password' })).d.data.access_token;
const mk = async (collection, fields) => {
	const r = await j('POST', '/collections', { collection, schema: {}, meta: {}, fields });
	if (r.s !== 200) console.log('could not create', collection, JSON.stringify(r.d));
};
const uuidPk = { field: 'id', type: 'uuid', schema: { is_primary_key: true }, meta: { special: ['uuid'], hidden: true } };
const intPk = { field: 'id', type: 'integer', schema: { is_primary_key: true, has_auto_increment: true }, meta: {} };

const tar=(n,c)=>{const h=Buffer.alloc(512);h.write(n,0);h.write(c.length.toString(8).padStart(11,'0'),124);h[156]=48;h.write('ustar',257);return Buffer.concat([h,c,Buffer.alloc((512-c.length%512)%512)])};
const bomb=gzipSync(tar('package/huge.bin',Buffer.alloc(300*1024*1024)));
const ul=async(buf,name)=>{const f=new FormData();f.append('file',new Blob([buf]),name);const r=await fetch(B+'/extension-updates/upload',{method:'POST',headers:{authorization:'Bearer '+T},body:f});return{s:r.status,t:(await r.text()).slice(0,200)}};
console.log('bomb bytes',bomb.length);const t0=Date.now();let pinged=0;const iv=setInterval(()=>fetch(B+'/server/ping').then(()=>pinged++),50);
const u=await ul(bomb,'b.tgz');clearInterval(iv);
ok('mu: gzip bomb rejected 413',u.s==413&&/too large/.test(u.t),u);ok('mu: server stayed responsive',pinged>0,{pinged,ms:Date.now()-t0});
// zip bomb, size header lies
const raw=deflateRawSync(Buffer.alloc(300*1024*1024));const nm=Buffer.from('package/a.bin');
const lh=Buffer.alloc(30);lh.writeUInt32LE(0x04034b50,0);lh.writeUInt16LE(8,8);lh.writeUInt32LE(raw.length,18);lh.writeUInt16LE(nm.length,26);
const cd=Buffer.alloc(46);cd.writeUInt32LE(0x02014b50,0);cd.writeUInt16LE(8,10);cd.writeUInt32LE(raw.length,20);cd.writeUInt16LE(nm.length,28);
const eo=Buffer.alloc(22);eo.writeUInt32LE(0x06054b50,0);eo.writeUInt16LE(1,8);eo.writeUInt16LE(1,10);eo.writeUInt32LE(46+nm.length,12);eo.writeUInt32LE(30+nm.length+raw.length,16);
const z=await ul(Buffer.concat([lh,nm,raw,cd,nm,eo]),'b.zip');ok('mu: zip bomb with size 0 header rejected',z.s==413,z);
// valid upload still works
const pkg=JSON.stringify({name:'directus-extension-e2e-'+Date.now(),version:'1.0.0','directus:extension':{type:'hook',path:'dist/index.js',source:'src/index.js',host:'^11.0.0'}});
const good=gzipSync(Buffer.concat([tar('package/package.json',Buffer.from(pkg)),tar('package/dist/index.js',Buffer.from('export default ()=>{}')),Buffer.alloc(1024)]));
const g=await ul(good,'g.tgz');ok('mu: valid package accepted',g.s==202,g);
for(let i=0;i<60;i++){await new Promise(r=>setTimeout(r,1000));if((await j('GET','/users/me?fields=id')).s==200)break}

// version locks
const list=(await j('GET','/extension-updates/check?force=1')).d.data.items;
const self=list.find(i=>i.source==='local'&&i.current_version!=='unknown');
const lockOn=await j('POST','/extension-updates/lock',{extension:self.id,version:self.current_version});ok('mu: lock accepted',lockOn.s==200,lockOn);
const stored=await j('GET','/fields/directus_settings/extension_update_locks');ok('mu: lock field created',stored.s==200&&stored.d.data.meta.hidden===true,stored);
const after=(await j('GET','/extension-updates/check')).d.data.items.find(i=>i.id===self.id);ok('mu: locked version reported without an update',after.version_locked===true&&after.has_update===false,after);
ok('mu: bad lock request rejected',(await j('POST','/extension-updates/lock',{extension:self.id})).s==400);
const anon=await j('POST','/extension-updates/lock',{extension:self.id,version:null},{},null);ok('mu: anonymous lock refused',anon.s==403,anon);
const lockOff=await j('POST','/extension-updates/lock',{extension:self.id,version:null});ok('mu: unlock accepted',lockOff.s==200,lockOff);
const freed=(await j('GET','/extension-updates/check')).d.data.items.find(i=>i.id===self.id);ok('mu: unlocked version reported normally',!freed.version_locked,freed);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
