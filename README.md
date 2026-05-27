# Halal Trust CloudRun Server

这是给微信云托管使用的独立后端接口服务，只负责从 MySQL 读取数据并返回给微信小程序。

## 接口

- `GET /api/health`
- `GET /api/meta`
- `GET /api/restaurants`
- `GET /api/sources`
- `GET /api/slaughterhouses`
- `GET /api/detail/:type/:id`

## 发布到微信云托管时填写

端口：

```text
80
```

环境变量：

```text
MYSQL_HOST=10.12.110.227
MYSQL_PORT=3306
MYSQL_USER=halal_app
MYSQL_PASSWORD=你创建 halal_app 时设置的密码
MYSQL_DATABASE=halal_trust
```

`MYSQL_HOST` 只填内网 IP，不要带 `:3306`。

## 发布流程

1. 把整个 `cloudrun-server` 文件夹作为一个新的 GitHub 仓库上传。
2. 在微信云托管里新建或重新发布服务。
3. 选择这个新的 GitHub 仓库。
4. 分支选择 `main`。
5. 端口填 `80`。
6. 填好上面的环境变量。
7. 发布后访问 `/api/health`，看到 `{ "ok": true }` 就说明数据库连接成功。
