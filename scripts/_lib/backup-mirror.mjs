import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { readRecoveryEnvelope } from '../../api/_lib/recovery-envelope.mjs';
import { restoreRecoveryChain } from './recovery-chain.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export async function verifyBackupDirectory(directory, workspace, key) {
  const names = (await fs.readdir(directory)).filter(name => name.startsWith(`recovery-${workspace}-`) && /^recovery-[\w-]+-\d+-\d+\.json$/.test(name));
  const states = [];
  for (const name of names) {
    const state = readRecoveryEnvelope(JSON.parse(await fs.readFile(path.join(directory, name), 'utf8')), key);
    if (state.workspaceId !== workspace) throw new Error('Backup workspace mismatch.');
    states.push(state);
  }
  return { state: restoreRecoveryChain(states), names };
}
export async function mirrorBackupDirectory(source, destination, workspace, key) {
  if (!path.isAbsolute(destination) || path.resolve(destination) === path.resolve(source)) throw new Error('Choose a separate absolute backup location.');
  const { state, names } = await verifyBackupDirectory(source, workspace, key);
  await fs.mkdir(destination, {recursive:true});
  let copied = 0;
  for (const name of names) {
    const bytes = await fs.readFile(path.join(source, name));
    const target = path.join(destination, name);
    try {
      if (hash(await fs.readFile(target)) !== hash(bytes)) throw new Error('Existing mirror file differs; refusing to overwrite recovery evidence.');
      continue;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const pending = target + '.' + randomBytes(8).toString('hex') + '.pending';
    try {
      await fs.writeFile(pending, bytes, {flag:'wx',mode:0o600});
      if (hash(await fs.readFile(pending)) !== hash(bytes)) throw new Error('Mirror checksum mismatch.');
      // Exclusive publication: never replace an existing historical file.
      await fs.copyFile(pending, target, fs.constants.COPYFILE_EXCL);
      copied++;
    } finally { await fs.unlink(pending).catch(()=>{}); }
  }
  const checked = await verifyBackupDirectory(destination, workspace, key);
  if (checked.state.storageRevision !== state.storageRevision) throw new Error('Mirror revision mismatch.');
  return {copied,revision:state.storageRevision,verified:true};
}
