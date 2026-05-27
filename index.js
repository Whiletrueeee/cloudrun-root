const express = require("express");
const mysql = require("mysql2/promise");
const catalog = require("./data/catalog.json");

const app = express();
const port = Number(process.env.PORT || 80);

app.use(express.json({ limit: "2mb" }));
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

app.get("/", (req, res) => {
  res.json({
    name: "Halal Trust CloudRun API",
    status: "ok",
    endpoints: ["/api/health", "/api/meta", "/api/restaurants", "/api/sources", "/api/slaughterhouses"]
  });
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
