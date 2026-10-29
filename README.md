# dsh-pocket-switch

One-tap switching between DSH hosts from your phone — store addresses and access pins once, then jump straight in.

在**公司和家两台电脑的 DSH** 之间一键切换。平时用手机访问 dsh-pocket，两台电脑要记两个网址、两套密码；装上这个插件后，密码存一次，手机上点一下直接进。

## 安装

任选一种：

**方式一：DSH 插件页**

插件 → 添加插件 → 粘贴：

```text
https://github.com/shutongX/dsh-pocket-switch
```

**方式二：我的插件市场索引**

DSH → 插件 → 实验性插件 → 更多 → 开启「自定义插件市场」→ 发现 → 添加索引源：

```text
https://shutongX.github.io/dsh-plugins-index/index.json
```

**方式三：命令行**

```sh
dsh plugin --profile desktop add https://github.com/shutongX/dsh-pocket-switch
```

依赖 [dsh-pocket](https://github.com/yjh051108/dsh-pocket)（手机访问插件）才能读本机配对信息；没有它也可以手动填写地址和密码。

## 长什么样

- 手机上打开 `/dsh-pocket-switch/`（可加到桌面）→ 一排「电脑」卡片，点一下跳过去，自动带上密码。
- DSH 界面里也加了入口：侧栏底部「⇄ 换电脑」、设置里的「换电脑」一页。
- 每台电脑可以存多个地址（局域网 / 公网），点哪个用哪个。

## 首次配置（每台各做一次）

1. 打开 DSH → 设置 →「换电脑」→ 右上角 +（或手机打开 `/dsh-pocket-switch/`）。
2. 点「从这台电脑的 dsh-pocket 自动填入」：名字、局域网地址、公网地址、密码一次填好。
3. 保存。
4. 想让手机在几台之间随便切：在一台上打开「导入/导出」→ 复制 JSON → 在另一台导入。

## 密码与地址

- **密码就是 dsh-pocket 设置页里的「访问密码」**（局域网、公网可能是两个）。
- 建议把密码设成固定的 8 位以上，否则公网密码每次开启公网都会换。
- 公网地址（`*.trycloudflare.com`）每次重启 DSH 会变；用命名隧道可以固定。
- 密码和地址只存在本机：`$DSH_HOME/dsh-pocket-switch/instances.json`（仅本机可读）。
- 页面本身不含密码；清单 API 需要 DSH 浏览器会话认证。

## 卸载

```sh
dsh plugin --profile desktop remove dsh-pocket-switch
```

数据：删掉 `$DSH_HOME/dsh-pocket-switch` 即可。

## 已知限制

- 目标机不通就跳不过去。
- 快速隧道地址会变，需要手动更新。
- 没做自动同步：几台之间用复制粘贴保持一份清单。

## 开发

```sh
npm test
```

## License

MIT
