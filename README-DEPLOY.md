# 泡泡糖大作战 · 云部署步骤（Render 免费版）

目标：把游戏和房间服务器放到 Render 上，得到一个固定网址。
之后朋友用手机/电脑打开这个网址就能玩，**不需要你的电脑一直开着**。

> 云服务器只负责“发网页 + 房间消息 relay”。
> 每局仍由房主的浏览器运行游戏和 AI，所以房主设备要留在游戏页面里。
> 电脑、手机可以混玩，人数不足 4 人会补 AI。

---

## 准备

1. 本目录「云部署包」里的所有文件
2. 一个 GitHub 账号（免费）
3. 一个 Render 账号（免费，可用 GitHub 登录）

不需要买服务器，不需要信用卡（以 Render 页面为准）。

---

## 第一步：把代码放到 GitHub

1. 打开 https://github.com 注册并验证邮箱
2. 登录后点右上角 `+` → **New repository**
3. 仓库名填 `bubble-battle`
4. 选 **Private**（私有）或 Public 都可以
5. 点 **Create repository**
6. 在仓库页面点 **Add file → Upload files**
7. 打开电脑上的「云部署包」文件夹
8. 把里面的**所有内容**拖进 GitHub 上传区：
   - `index.html`
   - `server.js`
   - `package.json`
   - `render.yaml`
   - `favicon.svg`
   - `css/` 文件夹
   - `js/` 文件夹
9. 确认上传后的文件在仓库**根目录**，不是嵌套在「云部署包」文件夹里
10. 点 **Commit changes**

---

## 第二步：在 Render 创建 Web Service

1. 打开 https://render.com
2. 用 GitHub 账号登录（Sign in with GitHub），授权访问仓库
3. 点 **New +** → **Web Service**
4. 选择刚才的 `bubble-battle` 仓库
5. 按下表填写：

| 项目 | 值 |
| --- | --- |
| Name | `bubble-battle`（可改） |
| Language / Runtime | Node |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Instance Type | **Free** |
| Region | 选离你近的（有 Singapore 就选 Singapore） |

6. 环境变量（Environment）添加：

| Key | Value |
| --- | --- |
| `AUTO_OPEN` | `0` |

7. 点 **Create Web Service**

如果使用 Blueprint：New + → Blueprint → 选仓库，`render.yaml` 会自动带出上面的配置。

---

## 第三步：等待部署

第一次部署通常需要 1–3 分钟。  
部署成功后，Render 会给你一个固定网址，例如：

```text
https://bubble-battle-xxxx.onrender.com
```

打开这个网址，能看到粉色游戏首页就成功了。

> Render 免费实例闲置约 15 分钟后会休眠。
> 下一次打开可能需要等 30–60 秒唤醒，这是正常现象。

---

## 第四步：开始玩

1. 打开 Render 网址，点「联机房间」→「创建房间」
2. 把 **同一个网址 + 4 位房间口令** 发给朋友
3. 朋友用手机或电脑打开网址，输入口令加入
4. 人数不足 4 人会补 AI
5. 房主点「开始对战」

**房主可以是电脑，也可以是手机。**  
房主设备要留在游戏页面，别关标签、别锁屏；其他玩家可以退出。

---

## 后续更新

修改 GitHub 仓库里的文件并提交后，Render 会自动重新部署。

---

## 常见问题

**打开很慢 / 显示 502**  
免费实例在唤醒，等 30–60 秒刷新。

**房间创建失败 / WebSocket 连不上**  
去 Render 的 Logs 看服务是否启动成功；确认 Start Command 是 `npm start`。

**手机显示不全**  
用新版文件，底部点「全屏」；QQ 浏览器夜间模式可在浏览器菜单关闭。

**能不能不用 GitHub**  
Render 需要从 Git 仓库部署。不想注册 GitHub 的话，只能继续用手机直连 P2P 版，或者改用其他云平台（也需要账号）。

---

## 安全提醒

- 不要把 GitHub / Render 的密码、验证码发给任何人（包括我）
- 我可以指导你操作，但账号需要你自己注册和登录
- 部署完成后把网址发我，我可以帮你测试房间和手机访问
