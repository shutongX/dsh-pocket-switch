import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Minimal React stub: the client bundle is exercised for registration and for
// rendering the sidebar button only, so no real React installation is needed.
const React = {
  createElement(type, props, ...children) {
    return { type, props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children } };
  },
  useState(initial) { return [initial, () => {}]; },
  useEffect() {},
};

test('client bundle：能被加载、只注册侧栏入口（设置项已移除）、可反注册', () => {
  let registration;
  globalThis.window = {
    __ModuleLoader__: {
      load(value) { registration = value; },
    },
    location: { assign() {} },
  };
  const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
  // eslint-disable-next-line no-new-func
  new Function(source)();
  assert.equal(registration.id, 'dsh-pocket-switch');
  const exports = registration.factory((id) => {
    if (id === 'react') return React;
    throw new Error('unexpected require: ' + id);
  });
  assert.deepEqual(exports.inject, ['slots']);
  assert.equal(typeof exports.apply, 'function');

  const registrations = [];
  const disposers = [];
  const ctx = {
    effect(fn) {
      const dispose = fn();
      if (typeof dispose === 'function') disposers.push(dispose);
    },
    slots: {
      inject(name, factory) {
        const result = factory();
        return () => {
          if (typeof result === 'function') result();
        };
      },
      register(optionsToRegister, component) {
        registrations.push({ options: optionsToRegister, component });
        let disposed = false;
        return () => { disposed = true; };
      },
    },
  };
  exports.apply(ctx);
  const names = registrations.map((item) => item.options.name).sort();
  // 设置项已按用户要求移除：只保留侧栏底部入口
  assert.deepEqual(names, ['sidebar.footer.action']);
  for (const item of registrations) {
    assert.equal(typeof item.component, 'function');
    assert.equal(typeof item.options.id, 'string');
  }
  // 侧栏按钮不依赖 hooks，可直接渲染出元素树
  const footer = registrations.find((item) => item.options.name === 'sidebar.footer.action');
  const tree = footer.component({});
  assert.equal(tree.type, 'button');
  assert.equal(tree.props.title, '换电脑');
  const flat = JSON.stringify(tree);
  assert.match(flat, /换电脑/);
  assert.ok(disposers.length >= 1);
  for (const dispose of disposers) dispose();
});
