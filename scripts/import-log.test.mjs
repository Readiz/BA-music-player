import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importFailureLog } from '../server/import-log.mjs';
import { ImportError } from '../server/imports.mjs';

test('publication failures retain the filesystem cause without exposing exception content', () => {
  const error = new ImportError('User-facing error', 503, { cause: Object.assign(new Error('/private/source?token=secret'), { code: 'ENOENT', path: '/private/source' }) });
  const lines = [];
  const result = importFailureLog({ id: '8d65b08b-6d7b-4316-932f-e27da882bdd2', stage: 'publishing-static', error }, line => lines.push(line));
  assert.equal(result.reason, 'ENOENT');
  assert.equal(result.stage, 'publishing-static');
  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0], /private|source|secret|token|User-facing/);
});

test('only known failure labels are logged, including unknown and cyclic exceptions', () => {
  const error = new Error('NAS static object checksum mismatch');
  assert.equal(importFailureLog({ stage: 'publishing-static', error }, () => {}).reason, 'static-checksum');
  const unknown = new Error('https://private.example/?token=secret');
  unknown.code = 'SECRET'; unknown.cause = unknown;
  const result = importFailureLog({ id: 'private-owner', stage: 'private-title', error: unknown }, () => { throw new Error(); });
  assert.equal(result.reason, 'unknown');
  assert.equal(result.stage, 'unknown');
  assert.equal(result.job, undefined);
});
