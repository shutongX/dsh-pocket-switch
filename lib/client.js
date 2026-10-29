// dsh-pocket-switch 的 DSH 界面部分（手写 bundle，无构建步骤）。
// 只做两件事：侧栏底部一个「换电脑」入口，设置里一页电脑列表（点一下直接跳）。
window.__ModuleLoader__.load({
  id: 'dsh-pocket-switch',
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require('react');
    var h = React.createElement;
    var PAGE = '/dsh-pocket-switch/';
    var API = '/dsh-pocket-switch/api';
    var inject = ['slots'];

    function openPage() {
      try { window.location.assign(PAGE); } catch (error) { /* 忽略 */ }
    }

    function useSwitcherState() {
      var state = React.useState({ loading: true, instances: [], error: null });
      var value = state[0];
      var setValue = state[1];
      React.useEffect(function () {
        var alive = true;
        fetch(API, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'state' })
        }).then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          return res.json();
        }).then(function (data) {
          if (alive) setValue({ loading: false, instances: data.instances || [], error: null });
        }).catch(function (error) {
          if (alive) setValue({ loading: false, instances: [], error: error && error.message ? error.message : '读取失败' });
        });
        return function () { alive = false; };
      }, []);
      return value;
    }

    function endpointOf(instance) {
      var list = instance.endpoints || [];
      for (var i = 0; i < list.length; i += 1) {
        if (list[i].id === instance.preferredEndpointId) return list[i];
      }
      return list[0];
    }

    function openInstance(instance) {
      var endpoint = endpointOf(instance);
      if (!endpoint) return;
      var target;
      try {
        target = new URL(endpoint.url);
      } catch (error) {
        openPage();
        return;
      }
      if (endpoint.token) target.searchParams.set('token', endpoint.token);
      try {
        fetch(API, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'record-open', id: instance.id, endpointId: endpoint.id }),
          keepalive: true
        }).catch(function () {});
      } catch (error) { /* 导航会打断请求，忽略 */ }
      window.location.assign(target.toString());
    }

    function SwitchSection() {
      var state = useSwitcherState();
      var rows = [];
      if (state.loading) {
        rows.push(h('div', { key: 'loading', style: { fontSize: 13, color: 'var(--dsw-alias-label-tertiary,#8b93a1)' } }, '读取中…'));
      } else if (state.error) {
        rows.push(h('div', { key: 'error', style: { fontSize: 13, color: 'var(--dsw-alias-label-tertiary,#8b93a1)' } }, '列表读不到：' + state.error));
      } else if (state.instances.length === 0) {
        rows.push(h('div', { key: 'empty', style: { fontSize: 13, color: 'var(--dsw-alias-label-tertiary,#8b93a1)' } }, '还没有添加电脑。打开切换页可以添加。'));
      } else {
        state.instances.forEach(function (instance) {
          var endpoint = endpointOf(instance) || { url: '', kind: 'custom' };
          var host = endpoint.url;
          try { host = new URL(endpoint.url).host; } catch (error) { /* 原样显示 */ }
          rows.push(h('div', {
            key: instance.id,
            style: {
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 10px', border: '1px solid var(--dsw-alias-border-l2,#e5e7eb)',
              borderRadius: 10, marginTop: 8
            }
          },
            h('div', { style: { minWidth: 0, flex: 1 } },
              h('div', { style: { fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, instance.name),
              h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-tertiary,#8b93a1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, host)
            ),
            h('button', {
              type: 'button',
              onClick: function () { openInstance(instance); },
              style: {
                font: 'inherit', fontSize: 12, cursor: 'pointer', border: 'none',
                background: 'var(--dsw-alias-brand-primary,#4f6ef7)', color: '#fff',
                height: 28, padding: '0 12px', borderRadius: 999, flex: 'none'
              }
            }, '打开')
          ));
        });
      }
      return h('div', { style: { maxWidth: 520 } },
        h('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4
          }
        },
          h('div', { style: { fontSize: 13, color: 'var(--dsw-alias-label-tertiary,#8b93a1)', flex: 1 } }, '在几台电脑的 DSH 之间切换，密码已保存，点一下直接进。'),
          h('button', {
            type: 'button',
            onClick: openPage,
            style: {
              font: 'inherit', fontSize: 12, cursor: 'pointer',
              border: '1px solid var(--dsw-alias-border-l2,#e5e7eb)', background: 'transparent',
              color: 'inherit', height: 28, padding: '0 12px', borderRadius: 999, flex: 'none'
            }
          }, '管理')
        ),
        rows
      );
    }

    function FooterButton() {
      return h('button', {
        type: 'button',
        onClick: openPage,
        title: '换电脑',
        style: {
          font: 'inherit', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center',
          gap: 6, height: 28, padding: '0 8px', borderRadius: 8, border: 'none',
          background: 'transparent', color: 'inherit', width: '100%'
        }
      }, h('span', { style: { fontSize: 14 } }, '⇄'), h('span', null, '换电脑'));
    }

    function apply(ctx) {
      // 设置项已按用户要求移除：只保留侧栏入口，设置里不再出现「换电脑」。
      ctx.effect(function () {
        return ctx.slots.inject('sidebar.footer.action', function () {
          return ctx.slots.register({
            name: 'sidebar.footer.action',
            id: 'pocket-switch'
          }, FooterButton);
        });
      }, 'dsh-pocket-switch: sidebar footer action');
    }

    exports.name = 'dsh-pocket-switch';
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});
