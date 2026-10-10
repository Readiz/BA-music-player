import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, stat, rm, writeFile, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { mountStatic } from './mount-static.mjs';

async function fixture(t) {
  const root = await mkdtemp('/private/tmp/music-mount-test-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const settings = { publishMount: join(root, 'publish'), serveMount: join(root, 'serve'), source: '//readiz@192.168.0.5/readiz_static', serveSource: '//readiz@192.168.0.5/readiz_static/music' };
  const helper = '/test/keychain-helper';
  let output = '';
  const calls = [];
  const add = async kind => {
    const readonly = kind === 'serve';
    output += `${readonly ? settings.serveSource : settings.source} on ${settings[kind + 'Mount']} (smbfs, nodev, ${readonly ? 'read-only, ' : ''}nobrowse)\n`;
    if (!readonly) {
      // Simulate the writable NAS mounted over the deliberately 0500 local stub.
      await chmod(settings.publishMount, 0o700);
      await mkdir(join(settings.publishMount, 'music'));
    }
  };
  const run = async (command, args, options) => {
    calls.push({ command, args, options });
    if (command === '/sbin/mount' && !args.length) return { stdout: output };
    if (command === helper) { await add(args[0]); return {}; }
    throw new Error('No authenticated SMB session after reboot');
  };
  return { settings, helper, run, calls, add, setOutput(value) { output = value; } };
}

test('a missing boot-time SMB session is restored through bounded Keychain mounts', async t => {
  const f = await fixture(t);
  await mountStatic(f);
  assert.deepEqual(f.calls.filter(c => c.command === f.helper).map(c => c.args), [['publish', f.settings.publishMount], ['serve', f.settings.serveMount]]);
  assert.ok(f.calls.filter(c => c.command === f.helper).every(c => c.options.timeout === 25_000));
  assert.equal((await stat(f.settings.serveMount)).mode & 0o777, 0o500);
  f.calls.length = 0;
  await mountStatic(f);
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every(c => c.command === '/sbin/mount' && !c.args.length));
});

test('unavailable Keychain leaves an unwritable empty stub and never tries the serve mount', async t => {
  const f = await fixture(t);
  const run = async (...args) => {
    if (args[0] === f.helper) throw new Error('EAUTH');
    return f.run(...args);
  };
  await assert.rejects(mountStatic({ ...f, run }), /unlock the login Keychain/);
  assert.equal((await stat(f.settings.publishMount)).mode & 0o777, 0o500);
  await assert.rejects(stat(f.settings.serveMount), { code: 'ENOENT' });
});

test('a saved credential for the wrong account cannot satisfy mount validation', async t => {
  const f = await fixture(t);
  const run = async (...args) => {
    if (args[0] === f.helper) {
      f.setOutput(`//other@192.168.0.5/readiz_static on ${f.settings.publishMount} (smbfs, nobrowse)\n`);
      return {};
    }
    return f.run(...args);
  };
  await assert.rejects(mountStatic({ ...f, run }), /expected NAS/);
});

test('mount recovery refuses a nonempty local directory without invoking authentication', async t => {
  const f = await fixture(t);
  await mkdir(f.settings.publishMount);
  await writeFile(join(f.settings.publishMount, 'keep'), 'unrelated data');
  await assert.rejects(mountStatic(f), /unsafe or nonempty/);
  assert.equal(f.calls.length, 1);
});
