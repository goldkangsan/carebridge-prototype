import {cp,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
await mkdir(resolve(root,'public'),{recursive:true});
await cp(resolve(root,'web'),resolve(root,'public'),{recursive:true});
console.log('Built web assets in public/; API functions remain in api/.');
