import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync(
  new URL('../tizen/launcher.js', import.meta.url),
  'utf8',
);
function launch(blocked = false, returning = false) {
  const listeners = {},
    navigations = [];
  const status = { textContent: '' };
  const spinner = {},
    hint = {};
  const main = { setAttribute() {} };
  const timers = new Map();
  let nextTimer = 0;
  const retry = {
    addEventListener: (name, fn) => (listeners[name] = fn),
    focus() {
      this.focused = true;
    },
  };
  const window = {
    history: {
      state: returning ? { readizMusicHosted: true } : null,
      replaceState(state) {
        this.state = state;
      },
    },
    setTimeout(fn) {
      timers.set(++nextTimer, fn);
      return nextTimer;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    addEventListener: (name, fn) => (listeners[name] = fn),
    location: {
      assign(url) {
        if (blocked) throw Error('blocked');
        navigations.push(url);
      },
    },
  };
  runInNewContext(source, {
    window,
    URL,
    document: {
      getElementById: (id) => ({ retry, status, spinner, hint })[id],
      querySelector: () => main,
      addEventListener: (name, fn) => (listeners[name] = fn),
    },
  });
  if (listeners.load) {
    listeners.load();
    const [id, start] = [...timers.entries()][0];
    timers.delete(id);
    start();
  }
  return {
    window,
    status,
    listeners,
    navigations,
    retry,
    spinner,
    hint,
    timers,
  };
}
test('WGT launcher navigates directly to the music website origin', () => {
  const app = launch();
  assert.deepEqual(app.navigations, ['https://music.readiz.com/app-start.html?launcher=tizen']);
  app.listeners.click();
  assert.equal(app.navigations.length, 2);
});
test('blocked navigation shows retry message; missing app API is harmless', () => {
  const app = launch(true);
  assert.match(app.status.textContent, /열지 못했습니다/);
  assert.doesNotThrow(() => app.listeners.keydown({ keyCode: 10009 }));
});
test('local launcher Back exits only through an available Tizen application API', () => {
  const app = launch();
  let exited = false,
    prevented = false;
  app.window.tizen = {
    application: {
      getCurrentApplication: () => ({ exit: () => (exited = true) }),
    },
  };
  app.listeners.keydown({
    keyCode: 10009,
    preventDefault: () => (prevented = true),
  });
  assert.equal(exited && prevented, true);
});

test('startup hides retry until delayed; retry and page exit clear pending timers', () => {
  const app = launch();
  assert.equal(app.retry.hidden, true);
  assert.equal(app.hint.hidden, true);
  assert.equal(app.spinner.hidden, false);
  [...app.timers.values()][0]();
  assert.equal(app.retry.hidden, false);
  assert.equal(app.retry.focused, true);
  assert.equal(app.spinner.hidden, true);
  app.listeners.click();
  assert.equal(app.retry.hidden, true);
  assert.equal(app.timers.size, 1);
  app.listeners.pagehide();
  assert.equal(app.timers.size, 0);
});

test('return to local launcher exits and never relaunches the hosted website', () => {
  const app = launch();
  let exits = 0;
  app.window.tizen = {
    application: { getCurrentApplication: () => ({ exit: () => exits++ }) },
  };
  app.listeners.pageshow();
  assert.equal(exits, 0);
  app.listeners.pagehide();
  app.listeners.pageshow();
  assert.equal(exits, 1);
  assert.equal(app.navigations.length, 1);
  const reloaded = launch(false, true);
  assert.equal(reloaded.navigations.length, 0);
  assert.match(reloaded.status.textContent, /종료/);
});
