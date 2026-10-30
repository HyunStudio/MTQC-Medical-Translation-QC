import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../web_demo/wwwroot/index.html',import.meta.url),'utf8');
const workbench=readFileSync(new URL('../web_demo/wwwroot/document-workbench.js',import.meta.url),'utf8');
test('a fresh release entry bypasses previously cached unversioned workbench code',()=>{
 assert.match(html, /src="\/document-workbench\.js\?v=[a-zA-Z0-9-]+"/);
});
test('the entry and its changed review module share the same cache version',()=>{
 const entry=html.match(/src="\/document-workbench\.js\?v=([a-zA-Z0-9-]+)"/);
 const dependency=workbench.match(/from '\.\/document-structure-review\.mjs\?v=([a-zA-Z0-9-]+)'/);
 assert.ok(entry&&dependency,'Version the modified dependency as well as its entry');
 assert.equal(entry[1],dependency[1]);
});
