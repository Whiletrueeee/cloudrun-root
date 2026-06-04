const express = require("express");
const mysql = require("mysql2/promise");
const catalog = require("./data/catalog.json");

const app = express();
const port = Number(process.env.PORT || 80);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

const dbConfig = {
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || process.env.MYSQL_USERNAME,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE || "halal_trust",
  waitForConnections: true,
  connectionLimit: 5,
  charset: "utf8mb4"
};

let pool;

function getPool() {
  if (!pool) {
    const missing = ["host", "user", "password", "database"].filter((key) => !dbConfig[key]);
    if (missing.length) {
      throw new Error(`Missing database config: ${missing.join(", ")}`);
    }
    pool = mysql.createPool(dbConfig);
  }
  return pool;
}

function parseJson(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeRestaurant(row) {
  return {
    id: row.id,
    name: row.name,
    province: row.province || "",
    city: row.city || "",
    district: row.district || "",
    address: row.address || "",
    phone: row.phone || "",
    lat: numberOrNull(row.lat),
    lng: numberOrNull(row.lng),
    cuisine: row.cuisine || "",
    avgPrice: row.avg_price,
    rating: numberOrNull(row.rating),
    openNow: Boolean(row.open_now),
    certificationLevel: row.certification_level || "",
    sourceType: row.source_type || "",
    sourceId: row.source_id || "",
    summary: row.summary || "",
    coverImage: row.cover_image || "",
    environmentPhotos: parseJson(row.environment_photos),
    certificatePhotos: parseJson(row.certificate_photos),
    menu: parseJson(row.menu),
    tags: parseJson(row.tags)
  };
}

function normalizeSource(row) {
  return {
    id: row.id,
    name: row.name,
    province: row.province || "",
    city: row.city || "",
    district: row.district || "",
    address: row.address || "",
    phone: row.phone || "",
    sourceType: row.source_type || "",
    certifier: row.certifier || "",
    certificateNo: row.certificate_no || "",
    validUntil: row.valid_until || "",
    traceability: row.traceability || "",
    coverImage: row.cover_image || "",
    environmentPhotos: parseJson(row.environment_photos),
    certificatePhotos: parseJson(row.certificate_photos),
    menu: parseJson(row.menu)
  };
}

function normalizeSlaughterhouse(row) {
  return {
    id: row.id,
    name: row.name,
    province: row.province || "",
    city: row.city || "",
    district: row.district || "",
    address: row.address || "",
    phone: row.phone || "",
    lat: numberOrNull(row.lat),
    lng: numberOrNull(row.lng),
    auditor: row.auditor || "",
    status: row.status || "",
    lastAudit: row.last_audit || "",
    summary: row.summary || "",
    coverImage: row.cover_image || "",
    environmentPhotos: parseJson(row.environment_photos),
    certificatePhotos: parseJson(row.certificate_photos),
    menu: parseJson(row.menu),
    requirements: parseJson(row.requirements)
  };
}

function pickFilters(query, allowedKeys) {
  const filters = [];
  const values = [];
  for (const [queryKey, column] of Object.entries(allowedKeys)) {
    const value = query[queryKey];
    if (!value) continue;
    filters.push(`${column} = ?`);
    values.push(value);
  }
  return { filters, values };
}

function pickLikeFilters(query, allowedKeys) {
  const filters = [];
  const values = [];
  for (const [queryKey, column] of Object.entries(allowedKeys)) {
    const value = String(query[queryKey] || "").trim();
    if (!value) continue;
    filters.push(`${column} LIKE ?`);
    values.push(`%${value}%`);
  }
  return { filters, values };
}

function keywordFilter(query, columns) {
  const q = String(query.q || "").trim();
  if (!q) return { clause: "", values: [] };
  return {
    clause: `(${columns.map((column) => `${column} LIKE ?`).join(" OR ")})`,
    values: columns.map(() => `%${q}%`)
  };
}

async function queryRows(table, options = {}) {
  const { filters, values } = pickFilters(options.query || {}, options.filters || {});
  const like = pickLikeFilters(options.query || {}, options.likeFilters || {});
  filters.push(...like.filters);
  values.push(...like.values);
  const keyword = keywordFilter(options.query || {}, options.keywordColumns || []);
  if (keyword.clause) {
    filters.push(keyword.clause);
    values.push(...keyword.values);
  }
  const where = filters.length ? ` WHERE ${filters.join(" AND ")}` : "";
  const orderBy = options.orderBy ? ` ORDER BY ${options.orderBy}` : "";
  const [rows] = await getPool().query(`SELECT * FROM ${table}${where}${orderBy}`, values);
  return rows;
}

function valueFrom(input, keys, fallback = "") {
  for (const key of keys) {
    const value = input[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return fallback;
}

function toNumber(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  const matched = String(value).match(/-?\d+(\.\d+)?/);
  if (!matched) return fallback;
  const number = Number(matched[0]);
  return Number.isFinite(number) ? number : fallback;
}

function toBoolean(value) {
  if (typeof value === "boolean") return value;
  const text = String(value || "").trim().toLowerCase();
  return ["1", "true", "yes", "营业中", "是", "open"].includes(text);
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === "object") return [value];
  const text = String(value).trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (error) {
    return text.split(/[\n,，、]/).map((item) => item.trim()).filter(Boolean);
  }
}

function toMenu(value) {
  return toArray(value).map((item) => {
    if (item && typeof item === "object") {
      return {
        name: String(valueFrom(item, ["name", "title", "dish", "菜品", "菜名"], "")).trim(),
        price: String(valueFrom(item, ["price", "amount", "价格", "售价"], "")).trim()
      };
    }
    const text = String(item || "").trim();
    const parts = text.split(/[:：\s]+/).filter(Boolean);
    if (parts.length >= 2 && /\d/.test(parts[parts.length - 1])) {
      return { name: parts.slice(0, -1).join(" "), price: parts[parts.length - 1] };
    }
    return { name: text, price: "" };
  }).filter((item) => item.name || item.price);
}

function parseLooseText(text) {
  const result = {};
  String(text || "").split(/\n+/).forEach((line) => {
    const match = line.match(/^\s*([^:：=]+)\s*[:：=]\s*(.+?)\s*$/);
    if (match) {
      result[match[1].trim()] = match[2].trim();
    }
  });
  return result;
}

function parseImportPayload(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    if (Array.isArray(raw.items)) return raw.items;
    if (raw.payload) return parseImportPayload(raw.payload);
    return [raw];
  }
  const text = String(raw || "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return parseImportPayload(parsed);
  } catch (error) {
    return [parseLooseText(text)];
  }
}

function normalizeImportedRestaurant(input, index) {
  const name = String(valueFrom(input, ["name", "餐厅名称", "名称", "店名", "商户名称"], "")).trim();
  if (!name) {
    throw new Error(`第 ${index + 1} 条缺少餐厅名称`);
  }
  const city = String(valueFrom(input, ["city", "城市"], "")).trim();
  const district = String(valueFrom(input, ["district", "行政区", "区县", "区域"], "")).trim();
  const id = String(valueFrom(input, ["id", "编号"], `rst-import-${Date.now()}-${index + 1}`)).trim();
  return {
    id,
    name,
    province: String(valueFrom(input, ["province", "省份", "省"], "")).trim(),
    city,
    district,
    address: String(valueFrom(input, ["address", "详细地址", "地址"], "")).trim(),
    phone: String(valueFrom(input, ["phone", "电话", "联系电话"], "")).trim(),
    lat: toNumber(valueFrom(input, ["lat", "latitude", "纬度"], null)),
    lng: toNumber(valueFrom(input, ["lng", "longitude", "经度"], null)),
    cuisine: String(valueFrom(input, ["cuisine", "菜系", "品类"], "")).trim(),
    avg_price: toNumber(valueFrom(input, ["avgPrice", "avg_price", "人均", "人均价格", "价格"], null)),
    rating: toNumber(valueFrom(input, ["rating", "评分"], 5), 5),
    open_now: toBoolean(valueFrom(input, ["openNow", "open_now", "营业状态", "是否营业"], true)),
    certification_level: String(valueFrom(input, ["certificationLevel", "certification_level", "合规级别", "认证级别"], "verified")).trim(),
    source_type: String(valueFrom(input, ["sourceType", "source_type", "来源类型"], "restaurant-direct")).trim(),
    source_id: String(valueFrom(input, ["sourceId", "source_id", "肉源记录", "来源编号"], "")).trim(),
    summary: String(valueFrom(input, ["summary", "简介", "描述", "备注"], "")).trim(),
    cover_image: String(valueFrom(input, ["coverImage", "cover_image", "封面", "封面图片"], "")).trim(),
    environment_photos: JSON.stringify(toArray(valueFrom(input, ["environmentPhotos", "environment_photos", "环境相册", "环境图片"], []))),
    certificate_photos: JSON.stringify(toArray(valueFrom(input, ["certificatePhotos", "certificate_photos", "证照相册", "证照图片"], []))),
    menu: JSON.stringify(toMenu(valueFrom(input, ["menu", "菜单", "菜品"], []))),
    tags: JSON.stringify(toArray(valueFrom(input, ["tags", "标签", "特色"], [])))
  };
}

function requireAdmin(req, res) {
  const expected = process.env.ADMIN_TOKEN || process.env.ADMIN_PASSWORD;
  if (!expected) {
    res.status(500).json({ message: "Server missing ADMIN_TOKEN" });
    return false;
  }
  const token = req.get("x-admin-token") || req.body?.token || req.query?.token;
  if (token !== expected) {
    res.status(401).json({ message: "Admin token invalid" });
    return false;
  }
  return true;
}

async function upsertRestaurants(items) {
  const columns = [
    "id",
    "name",
    "province",
    "city",
    "district",
    "address",
    "phone",
    "lat",
    "lng",
    "cuisine",
    "avg_price",
    "rating",
    "open_now",
    "certification_level",
    "source_type",
    "source_id",
    "summary",
    "cover_image",
    "environment_photos",
    "certificate_photos",
    "menu",
    "tags"
  ];
  const placeholders = columns.map(() => "?").join(", ");
  const updates = columns.filter((column) => column !== "id").map((column) => `${column}=VALUES(${column})`).join(", ");
  const sql = `INSERT INTO restaurants (${columns.join(", ")}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${updates}`;
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    for (const item of items) {
      await conn.query(sql, columns.map((column) => item[column]));
    }
    await conn.commit();
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

app.get("/", (req, res) => {
  res.json({
    name: "Halal Trust CloudRun API",
    status: "ok",
    endpoints: ["/api/health", "/api/meta", "/api/restaurants", "/api/sources", "/api/slaughterhouses", "/admin/import"]
  });
});

app.get("/admin/import", (req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Halal Trust 餐厅导入</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f3faf6; color: #0d2b20; }
    main { max-width: 980px; margin: 0 auto; padding: 32px 18px 56px; }
    h1 { margin: 0 0 8px; font-size: 28px; }
    p { color: #5d756b; line-height: 1.7; }
    label { display: block; margin: 18px 0 8px; font-weight: 700; color: #315a4b; }
    input, textarea { width: 100%; box-sizing: border-box; border: 1px solid #cfe2d8; border-radius: 8px; padding: 13px 14px; font: inherit; background: #fff; color: #0d2b20; }
    textarea { min-height: 360px; resize: vertical; line-height: 1.55; }
    button { margin-top: 18px; border: 0; border-radius: 8px; background: #08784f; color: #fff; font-size: 18px; font-weight: 800; padding: 14px 26px; cursor: pointer; }
    pre { margin-top: 18px; padding: 16px; border-radius: 8px; background: #10281f; color: #d8f5e9; white-space: pre-wrap; }
    .hint { background: #fff; border: 1px solid #dcebe3; border-radius: 8px; padding: 14px 16px; }
  </style>
</head>
<body>
  <main>
    <h1>餐厅批量导入</h1>
    <p>粘贴 JSON 数组，或粘贴“字段名: 内容”的文本。保存后会写入 SQL 的 restaurants 表，同 id 会自动覆盖更新。</p>
    <div class="hint">
      <strong>字段示例：</strong>餐厅名称、省份、城市、行政区、地址、电话、菜系、人均、评分、营业状态、合规级别、来源类型、简介、标签、菜单、封面图片、环境图片、证照图片。
    </div>
    <label for="token">导入密码</label>
    <input id="token" type="password" placeholder="填写 ADMIN_TOKEN">
    <label for="payload">导入内容</label>
    <textarea id="payload">[
  {
    "餐厅名称": "示例清真餐厅",
    "省份": "甘肃省",
    "城市": "兰州",
    "行政区": "城关区",
    "地址": "示例路 1 号",
    "电话": "待补充",
    "菜系": "兰州牛肉面",
    "人均": 32,
    "评分": 4.8,
    "营业状态": "营业中",
    "合规级别": "verified",
    "来源类型": "restaurant-direct",
    "简介": "适合日常就餐。",
    "标签": ["牛肉面", "早餐"],
    "菜单": [
      { "菜品": "牛肉面", "价格": "29" },
      { "菜品": "手抓羊肉", "价格": "88" }
    ]
  }
]</textarea>
    <button id="submit">导入餐厅</button>
    <pre id="result">等待导入...</pre>
  </main>
  <script>
    const result = document.getElementById("result");
    document.getElementById("submit").addEventListener("click", async () => {
      result.textContent = "正在导入...";
      try {
        const response = await fetch("/api/admin/import/restaurants", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-admin-token": document.getElementById("token").value
          },
          body: JSON.stringify({ payload: document.getElementById("payload").value })
        });
        const data = await response.json();
        result.textContent = JSON.stringify(data, null, 2);
      } catch (error) {
        result.textContent = error.message || "导入失败";
      }
    });
  </script>
</body>
</html>`);
});

app.get("/api/health", async (req, res, next) => {
  try {
    await getPool().query("SELECT 1");
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/api/meta", async (req, res, next) => {
  try {
    const [[restaurantCount], [sourceCount], [slaughterhouseCount]] = await Promise.all([
      getPool().query("SELECT COUNT(*) AS total FROM restaurants"),
      getPool().query("SELECT COUNT(*) AS total FROM sources"),
      getPool().query("SELECT COUNT(*) AS total FROM slaughterhouses")
    ]);
    res.json({
      provinces: [...new Set(catalog.cityCatalog.map((item) => item.province).filter(Boolean))],
      cities: [...new Set(catalog.cityCatalog.map((item) => item.city).filter(Boolean))],
      districts: catalog.cityCatalog.flatMap((item) => item.districts.map((district) => ({ city: item.city, district }))),
      cityCatalog: catalog.cityCatalog,
      cuisines: catalog.cuisineCategories,
      certificationLevels: catalog.certificationLevels,
      sourceTypes: catalog.sourceTypes,
      stats: {
        restaurants: restaurantCount[0].total,
        verifiedSources: sourceCount[0].total,
        slaughterhouses: slaughterhouseCount[0].total
      }
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/restaurants", async (req, res, next) => {
  try {
    const rows = await queryRows("restaurants", {
      query: req.query,
      filters: {
        province: "province",
        city: "city",
        district: "district",
        certification: "certification_level",
        sourceType: "source_type"
      },
      likeFilters: {
        cuisine: "cuisine"
      },
      keywordColumns: ["name", "city", "district", "address", "cuisine", "summary"],
      orderBy: "created_at DESC"
    });
    const items = rows.map(normalizeRestaurant);
    res.json({ items, total: items.length });
  } catch (error) {
    next(error);
  }
});

app.get("/api/sources", async (req, res, next) => {
  try {
    const rows = await queryRows("sources", {
      query: req.query,
      filters: {
        province: "province",
        city: "city",
        sourceType: "source_type"
      },
      keywordColumns: ["name", "city", "source_type", "certifier", "certificate_no", "traceability"],
      orderBy: "created_at DESC"
    });
    const items = rows.map(normalizeSource);
    res.json({ items, total: items.length });
  } catch (error) {
    next(error);
  }
});

app.get("/api/slaughterhouses", async (req, res, next) => {
  try {
    const rows = await queryRows("slaughterhouses", {
      query: req.query,
      filters: {
        province: "province",
        city: "city",
        district: "district",
        status: "status"
      },
      keywordColumns: ["name", "city", "district", "address", "auditor", "summary"],
      orderBy: "created_at DESC"
    });
    const items = rows.map(normalizeSlaughterhouse);
    res.json({ items, total: items.length });
  } catch (error) {
    next(error);
  }
});

app.get("/api/detail/:type/:id", async (req, res, next) => {
  try {
    const { type, id } = req.params;
    const typeConfig = {
      restaurants: { table: "restaurants", normalize: normalizeRestaurant },
      sources: { table: "sources", normalize: normalizeSource },
      slaughterhouses: { table: "slaughterhouses", normalize: normalizeSlaughterhouse }
    }[type];
    if (!typeConfig) {
      res.status(404).json({ message: "Detail type not found" });
      return;
    }

    const [rows] = await getPool().query(`SELECT * FROM ${typeConfig.table} WHERE id = ? LIMIT 1`, [id]);
    if (!rows.length) {
      res.status(404).json({ message: "Detail item not found" });
      return;
    }

    const item = typeConfig.normalize(rows[0]);
    let source = null;
    let relatedRestaurants = [];
    if (type === "restaurants" && item.sourceId) {
      const [sourceRows] = await getPool().query("SELECT * FROM sources WHERE id = ? LIMIT 1", [item.sourceId]);
      source = sourceRows[0] ? normalizeSource(sourceRows[0]) : null;
    }
    if (type === "sources") {
      const [restaurantRows] = await getPool().query("SELECT * FROM restaurants WHERE source_id = ?", [item.id]);
      relatedRestaurants = restaurantRows.map(normalizeRestaurant);
    }

    res.json({ type, item, source, relatedRestaurants });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/import/restaurants", async (req, res, next) => {
  try {
    if (!requireAdmin(req, res)) return;
    const rows = parseImportPayload(req.body?.payload ?? req.body?.items ?? req.body);
    const items = rows.map(normalizeImportedRestaurant);
    if (!items.length) {
      res.status(400).json({ message: "没有可导入的餐厅数据" });
      return;
    }
    await upsertRestaurants(items);
    res.json({
      ok: true,
      imported: items.length,
      ids: items.map((item) => item.id)
    });
  } catch (error) {
    next(error);
  }
});

app.use((req, res) => {
  res.status(404).json({ message: "API endpoint not found" });
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({
    message: "Server error",
    detail: error.message
  });
});

app.listen(port, () => {
  console.log(`Halal Trust CloudRun API listening on ${port}`);
});
