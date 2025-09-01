// server.cjs
const express = require("express");
const cors = require("cors");
const sql = require("mssql");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const XLSX = require("xlsx");
const morgan = require("morgan");
const https = require("https");
const http = require("http");
const dotenv = require("dotenv");
dotenv.config();

let auditPool; // auditms DB (AuditIssues, reports, etc.)
let spotPool; // SPOT DB (EMP, OTP storage)

const { Client } = require("@microsoft/microsoft-graph-client");
const { ClientSecretCredential } = require("@azure/identity");
require("isomorphic-fetch");
const { v4: uuidv4 } = require("uuid");

const app = express();

/* ----------------------------- CORS & middleware ---------------------------- */
app.use(
  cors({
    origin: (origin, cb) => cb(null, true),
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  })
);
app.options(/.*/, cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));

/* ------------------------------ Static hosting ------------------------------ */
app.use(express.static(path.join(__dirname, "../dist")));

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use("/uploads", express.static(uploadsDir));

/* --------------------------------- Multer ---------------------------------- */
const memoryUpload = multer({ storage: multer.memoryStorage() });
const evidenceStorage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.random().toString(36).substr(2, 9);
    cb(null, unique + path.extname(file.originalname));
  },
});
const diskUpload = multer({ storage: evidenceStorage });

/* ------------------------------- DB (MSSQL) -------------------------------- */
const AUDIT_DB_NAME = process.env.AUDIT_DB_NAME || "auditms";
const SPOT_DB_NAME = process.env.SPOT_DB_NAME || "SPOT";
const OTP_TABLE = process.env.OTP_TABLE || "AuditPortalLogin"; // <— new table name

const commonDb = {
  user: process.env.DB_USER || "SPOT_USER",
  password: process.env.DB_PASS || "Marvik#72@",
  server: process.env.DB_HOST || "10.0.40.10",
  port: Number(process.env.DB_PORT || 1433),
  options: {
    trustServerCertificate: true,
    encrypt: false,
    connectionTimeout: 60000,
  },
};

const auditDbConfig = { ...commonDb, database: AUDIT_DB_NAME }; // for AuditIssues
const spotDbConfig = { ...commonDb, database: SPOT_DB_NAME }; // for EMP + OTPs

/* --------------------------- Microsoft Graph setup -------------------------- */
const CLIENT_ID = "3d310826-2173-44e5-b9a2-b21e940b67f7";
const TENANT_ID = "1c3de7f3-f8d1-41d3-8583-2517cf3ba3b1";
const CLIENT_SECRET = "2e78Q~yX92LfwTTOg4EYBjNQrXrZ2z5di1Kvebog";
const SENDER_EMAIL = "spot@premierenergies.com";

const credential = new ClientSecretCredential(
  TENANT_ID,
  CLIENT_ID,
  CLIENT_SECRET
);
const graphClient = Client.initWithMiddleware({
  authProvider: {
    getAccessToken: async () => {
      const tokenResponse = await credential.getToken(
        "https://graph.microsoft.com/.default"
      );
      return tokenResponse.token;
    },
  },
});

async function sendEmail(toEmail, subject, htmlContent) {
  const toList = Array.isArray(toEmail)
    ? toEmail
    : String(toEmail || "")
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter(Boolean);

  const normalize = (x) => {
    if (!x) return null;
    const s = String(x).trim();
    return s.includes("@") ? s : `${s}@premierenergies.com`;
  };
  const normalized = toList.map(normalize).filter(Boolean);

  const message = {
    subject,
    body: { contentType: "HTML", content: htmlContent },
    toRecipients: normalized.map((addr) => ({
      emailAddress: { address: addr },
    })),
  };
  try {
    await graphClient
      .api(`/users/${SENDER_EMAIL}/sendMail`)
      .post({ message, saveToSentItems: true });
  } catch (err) {
    const status = err?.statusCode || err?.status;
    const body = err?.body || err?.message;
    console.error("Graph sendMail failed:", status, body);
    throw err;
  }
}

/* ------------------------------ DB bootstrap ------------------------------- */
async function initDb() {
  try {
    // Connect to both databases
    auditPool = await new sql.ConnectionPool(auditDbConfig).connect();
    spotPool = await new sql.ConnectionPool(spotDbConfig).connect();

    // mysql2-ish shim (only for audit pool where we use connection.execute)
    auditPool.getConnection = async () => ({
      execute: async (query, params) => {
        let sqlText = query;
        const req = auditPool.request();
        if (Array.isArray(params) && params.length) {
          // Replace each "?" with @pN and bind
          params.forEach((val, i) => {
            const name = `p${i}`;
            sqlText = sqlText.replace(/\?/, `@${name}`);
            req.input(name, val);
          });
        }
        const result = await req.query(sqlText);
        return [result.recordset];
      },
    });

    // Ensure AuditIssues table exists in AUDIT DB
    const tableCheckQuery = `
    IF NOT EXISTS (
        SELECT 1
          FROM sys.tables t
          JOIN sys.schemas s ON t.schema_id = s.schema_id
         WHERE t.name = 'AuditIssues'
           AND s.name = 'dbo'
    )
    BEGIN
        CREATE TABLE dbo.AuditIssues (
            id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
            serialNumber INT IDENTITY(1,1) NOT NULL,
            fiscalYear VARCHAR(20) NOT NULL,
            date DATE NOT NULL,
            process VARCHAR(100) NOT NULL,
            entityCovered VARCHAR(100) NOT NULL,
            observation NVARCHAR(MAX) NOT NULL,
            riskLevel VARCHAR(10) NOT NULL,
            recommendation NVARCHAR(MAX) NOT NULL,
            managementComment NVARCHAR(MAX) NULL,
            personResponsible NVARCHAR(512) NOT NULL,
            approver NVARCHAR(1024) NOT NULL,
            cxoResponsible NVARCHAR(1024) NOT NULL,
            coOwner NVARCHAR(512) NULL,
            timeline DATE NULL,
            currentStatus VARCHAR(50) NOT NULL,
            evidenceReceived NVARCHAR(MAX) NULL,
            evidenceStatus VARCHAR(50) NULL,
            reviewComments NVARCHAR(MAX) NULL,
            risk NVARCHAR(MAX) NULL,
            actionRequired NVARCHAR(MAX) NULL,
            startMonth VARCHAR(20) NULL,
            endMonth VARCHAR(20) NULL,
            annexure NVARCHAR(MAX) NULL,
            createdAt DATETIME2 NOT NULL DEFAULT GETDATE(),
            updatedAt DATETIME2 NOT NULL DEFAULT GETDATE()
        );
    END;

    IF COL_LENGTH('dbo.AuditIssues','iaComments') IS NOT NULL
      ALTER TABLE dbo.AuditIssues DROP COLUMN iaComments;
    `;
    await auditPool.request().query(tableCheckQuery);
    console.log("✅ AuditIssues table is ready (AUDIT DB)");

    // Ensure OTP table exists in SPOT DB (distinct from other apps' Login table)
    const loginTableCheck = `
    IF NOT EXISTS (
        SELECT 1
          FROM sys.tables t
          JOIN sys.schemas s ON t.schema_id = s.schema_id
         WHERE t.name = '${OTP_TABLE}'
           AND s.name = 'dbo'
    )
    BEGIN
        CREATE TABLE dbo.${OTP_TABLE} (
          Username    NVARCHAR(255) NOT NULL PRIMARY KEY,
          OTP         NVARCHAR(10)  NULL,
          OTP_Expiry  DATETIME2     NULL,
          LEmpID      NVARCHAR(50)  NULL
        );
    END;
`;

    await spotPool.request().query(loginTableCheck);
    console.log(`✅ ${OTP_TABLE} table present (SPOT DB)`);
  } catch (err) {
    console.error("⛔ Failed to initialize database:", err);
    process.exit(1);
  }
}
initDb();

/* -------------------------------- Utilities -------------------------------- */
const formatDate = (val) => {
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d.toISOString().split("T")[0];
};
const convertExcelDate = (excelDate) => {
  if (!excelDate || typeof excelDate !== "number") return null;
  const jsDate = new Date(Math.round((excelDate - 25569) * 86400 * 1000));
  return jsDate.toISOString().split("T")[0];
};

// Reset identity to 1 when the table is empty (next insert becomes 1)
async function reseedSerialIfEmpty() {
  try {
    await auditPool.request().query(`
      IF NOT EXISTS (SELECT 1 FROM dbo.AuditIssues)
      BEGIN
        DBCC CHECKIDENT ('dbo.AuditIssues', RESEED, 0) WITH NO_INFOMSGS;
      END
    `);
  } catch (e) {
    console.warn("reseedSerialIfEmpty warning:", e?.message || e);
  }
}

const normStatus = (s) => {
  if (Array.isArray(s)) s = s[0] ?? "";
  const status = String(s ?? "")
    .trim()
    .toLowerCase();
  if (!status) return "To Be Received";
  if (status === "to be received" || status.includes("to be"))
    return "To Be Received";
  if (status === "partially received" || status.includes("partially"))
    return "Partially Received";
  if (
    status === "received" ||
    (status.includes("received") && !status.includes("to be"))
  )
    return "Received";
  if (status === "closed") return "Closed";
  if (status.includes("progress")) return "In Progress";
  if (status.includes("resolv")) return "Resolved";
  return "To Be Received";
};

const normRiskLevel = (r) => {
  if (Array.isArray(r)) r = r[0];
  const s = String(r ?? "")
    .trim()
    .toLowerCase();
  if (!s) return "medium";
  if (s === "high") return "high";
  if (s === "medium") return "medium";
  if (s === "low") return "low";
  if (s.includes("high")) return "high";
  if (s.includes("low")) return "low";
  if (s.includes("med")) return "medium";
  if (/^(3|h)$/.test(s)) return "high";
  if (/^(2|m)$/.test(s)) return "medium";
  if (/^(1|l)$/.test(s)) return "low";
  return "medium";
};

// Accepts array, JSON-stringified array, or delimited string and returns string[]
const toEmails = (val) => {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(Boolean);
  if (typeof val === "string") {
    const s = val.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch (_) {}
    return s
      .split(/[;,]/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [String(val)];
};

const normalizeToEmail = (raw) => {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (!s) return s;
  return s.includes("@") ? s : `${s}@premierenergies.com`;
};

// Validate that all provided emails exist in EMP (ActiveFlag=1)
async function findMissingEmployees(rawList) {
  const list = Array.from(
    new Set((rawList || []).map((e) => normalizeToEmail(e)).filter(Boolean))
  );
  if (!list.length) return [];
  const req = spotPool.request(); // EMP lives in SPOT
  const clauses = [];
  list.forEach((e, i) => {
    req.input(`e${i}`, sql.NVarChar(255), e);
    clauses.push(`LOWER(EmpEmail) = LOWER(@e${i})`);
  });
  const q = `
    SELECT LOWER(EmpEmail) AS email
    FROM dbo.EMP
    WHERE ActiveFlag = 1 AND (${clauses.join(" OR ")})
  `;
  const rs = await req.query(q);
  const found = new Set(
    (rs.recordset || []).map((r) => String(r.email || "").toLowerCase())
  );
  return list.filter((e) => !found.has(e.toLowerCase()));
}

/* ======================= OTP AUTH (SPOT: EMP + OTPs) ======================= */

// Request OTP (EMP-validated, OTP stored in dbo.AuditPortalLogin)
app.post("/api/send-otp", async (req, res) => {
  try {
    const rawEmail = (req.body.email || "").trim();
    const fullEmail = normalizeToEmail(rawEmail);

    const empQ = await spotPool
      .request()
      .input("em", sql.NVarChar(255), fullEmail).query(`
        SELECT EmpID, EmpName 
        FROM dbo.EMP
        WHERE EmpEmail = @em AND ActiveFlag = 1
      `);

    if (!empQ.recordset.length) {
      return res.status(404).json({
        message:
          "We do not have this email registered in EMP. If you have a company email ID, please contact HR.",
      });
    }

    const empID = String(empQ.recordset[0].EmpID ?? "");

    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    const expiry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Upsert OTP into dbo.AuditPortalLogin (SPOT)
    await spotPool
      .request()
      .input("u", sql.NVarChar(255), fullEmail)
      .input("o", sql.NVarChar(10), otp)
      .input("exp", sql.DateTime2, expiry)
      .input("emp", sql.NVarChar(50), empID).query(`
        IF EXISTS (SELECT 1 FROM dbo.${OTP_TABLE} WHERE Username = @u)
          UPDATE dbo.${OTP_TABLE} SET OTP = @o, OTP_Expiry = @exp, LEmpID = @emp WHERE Username = @u;
        ELSE
          INSERT INTO dbo.${OTP_TABLE} (Username, OTP, OTP_Expiry, LEmpID) VALUES (@u, @o, @exp, @emp);
      `);

    const subject = "Audit Portal – Your OTP";
    const content = `
      <p>Welcome to the Audit Portal.</p>
      <p>Your One-Time Password (OTP) is: <strong>${otp}</strong></p>
      <p>This OTP will expire in 5 minutes.</p>
      <p>Thanks &amp; Regards,<br/>Team Audit</p>
    `;
    try {
      await sendEmail(fullEmail, subject, content);
      return res.status(200).json({ message: "OTP sent successfully" });
    } catch (e) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[DEV] Email failed, using inline OTP:", otp);
        return res
          .status(200)
          .json({ message: "OTP generated (dev)", devOtp: otp });
      }
      return res.status(502).json({
        message:
          "OTP generated, but email service failed. Please try again shortly.",
      });
    }
  } catch (error) {
    console.error("Error in /api/send-otp:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Verify OTP (reads dbo.AuditPortalLogin in SPOT)
app.post("/api/verify-otp", async (req, res) => {
  try {
    const rawEmail = (req.body.email || "").trim();
    const fullEmail = normalizeToEmail(rawEmail);
    const otp = (req.body.otp || "").trim();

    const rs = await spotPool
      .request()
      .input("u", sql.NVarChar(255), fullEmail)
      .input("o", sql.NVarChar(10), otp).query(`
        SELECT OTP, OTP_Expiry, LEmpID
        FROM dbo.${OTP_TABLE}
        WHERE Username = @u AND OTP = @o
      `);

    if (!rs.recordset.length) {
      return res.status(400).json({ message: "Invalid OTP" });
    }
    const row = rs.recordset[0];
    if (new Date() > new Date(row.OTP_Expiry)) {
      return res
        .status(400)
        .json({ message: "OTP has expired. Please request a new one." });
    }

    // Optional: fetch name for convenience
    const emp = await spotPool
      .request()
      .input("id", sql.NVarChar(50), String(row.LEmpID ?? "")).query(`
        SELECT TOP 1 EmpName FROM dbo.EMP WHERE EmpID = @id
      `);
    const empName = emp.recordset.length ? emp.recordset[0].EmpName : fullEmail;

    res.status(200).json({
      message: "OTP verified successfully",
      empID: row.LEmpID,
      empName,
    });
  } catch (error) {
    console.error("Error in /api/verify-otp:", error);
    res.status(500).json({ message: "Server error" });
  }
});

/* ----------------------------- Role resolution ------------------------------ */
// 'approver' if email appears in approver or cxoResponsible in ANY issue; else 'user'
app.get("/api/resolve-role", async (req, res) => {
  try {
    const fullEmail = normalizeToEmail(req.query.email || "");
    if (!fullEmail) return res.status(400).json({ role: "user" });

    const rq = auditPool.request().input("em", sql.NVarChar(255), fullEmail);
    const approverQ = await rq.query(`
      SELECT TOP 1 id FROM dbo.AuditIssues 
      WHERE (',' + LOWER(REPLACE(approver,'; ',','))
              + ',' + LOWER(REPLACE(cxoResponsible,'; ',','))
            ) LIKE '%,' + LOWER(@em) + ',%'
    `);
    if (approverQ.recordset.length) {
      return res.json({ role: "approver" });
    }

    const userQ = await auditPool
      .request()
      .input("em", sql.NVarChar(255), fullEmail).query(`
        SELECT TOP 1 id FROM dbo.AuditIssues
        WHERE (',' + LOWER(REPLACE(personResponsible,'; ',','))
              ) LIKE '%,' + LOWER(@em) + ',%'
      `);

    if (userQ.recordset.length) return res.json({ role: "user" });
    return res.json({ role: "user" });
  } catch (err) {
    console.error("resolve-role error:", err);
    res.json({ role: "user" });
  }
});

/* ----------------------- CREATE (single, from UI modal) --------------------- */
app.post("/api/audit-issues", memoryUpload.any(), async (req, res) => {
  try {
    await reseedSerialIfEmpty();
    const body = req.body;

    const toList = (v) => (Array.isArray(v) ? v.filter(Boolean) : v ? [v] : []);
    const approvers = toList(body.approver);
    const cxoList = toList(body.cxoResponsible);
    const cxoCoOwners = toList(body["cxoCoOwner[]"]);

    // ✅ EMP validation for PR/Approver/CXO (per requirement)
    const prList = toEmails(body.personResponsible).map(normalizeToEmail);
    const apprList = approvers.flatMap((x) =>
      toEmails(x).map(normalizeToEmail)
    );
    const cxoNormalized = cxoList.flatMap((x) =>
      toEmails(x).map(normalizeToEmail)
    );
    const coOwnerList = cxoCoOwners.flatMap((x) =>
      toEmails(x).map(normalizeToEmail)
    );

    const missing = await findMissingEmployees([
      ...prList,
      ...apprList,
      ...cxoNormalized,
      ...coOwnerList,
    ]);
    if (missing.length) {
      return res
        .status(400)
        .json({ error: `Unknown employee email(s): ${missing.join(", ")}` });
    }

    // Annexure files (separate from evidence)
    const annexureFiles = (req.files || []).filter(
      (f) => f.fieldname === "annexure"
    );
    let annexureArr = [];
    if (annexureFiles.length) {
      const saved = [];
      for (const f of annexureFiles) {
        const unique =
          Date.now() +
          "-" +
          Math.random().toString(36).substr(2, 9) +
          path.extname(f.originalname);
        const dest = path.join(uploadsDir, unique);
        fs.writeFileSync(dest, f.buffer);
        saved.push({
          name: f.originalname,
          path: path.relative(__dirname, dest),
          size: f.size,
          type: f.mimetype,
          uploadedAt: new Date().toISOString(),
        });
      }
      annexureArr = saved;
    }

    const id = uuidv4();
    const connection = await auditPool.getConnection();
    const insertQuery = `
      INSERT INTO dbo.AuditIssues (
        id, fiscalYear, date, process, entityCovered, observation, riskLevel,
        recommendation, managementComment, personResponsible, approver,
        cxoResponsible, coOwner, timeline, currentStatus, evidenceReceived,
        reviewComments, risk, actionRequired, startMonth, endMonth, annexure, createdAt, updatedAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE(), GETDATE())
    `;

    const fiscalYear = body.fiscalYear || "";
    const date = formatDate(body.date) || formatDate(new Date());
    const process = body.process || "";
    const entityCovered = body.entityCovered || "";
    const observation = body.observation || "";
    const riskLevel = normRiskLevel(body.riskLevel);
    const recommendation = body.recommendation || "";
    const managementComment = body.managementComment || "";
    const personResponsible = prList.join(";"); // already normalized
    const approver = apprList.join(";");
    const cxoResponsible = cxoNormalized.join(";");
    const coOwner = coOwnerList.join(";");
    const timeline = body.timeline ? formatDate(body.timeline) : null;
    const currentStatus = normStatus(body.currentStatus);
    const evidenceReceived = JSON.stringify([]);
    const reviewComments = body.reviewComments || "";
    const risk = body.risk || "";
    const actionRequired = body.actionRequired || "";
    const startMonth = body.coverageStartMonth || body.startMonth || "";
    const endMonth = body.coverageEndMonth || body.endMonth || "";
    const annexure = JSON.stringify(annexureArr);

    const values = [
      id,
      fiscalYear,
      date,
      process,
      entityCovered,
      observation,
      riskLevel,
      recommendation,
      managementComment,
      personResponsible,
      approver,
      cxoResponsible,
      coOwner,
      timeline,
      currentStatus,
      evidenceReceived,
      reviewComments,
      risk,
      actionRequired,
      startMonth,
      endMonth,
      annexure,
    ];

    await connection.execute(insertQuery, values);

    const [rows] = await connection.execute(
      `SELECT * FROM dbo.AuditIssues WHERE id = ?`,
      [id]
    );
    const created = rows[0] || { id };
    try {
      created.evidenceReceived = JSON.parse(created.evidenceReceived || "[]");
      created.annexure = JSON.parse(created.annexure || "[]");
    } catch {}
    res.status(201).json(created);
  } catch (err) {
    console.error("⛔ Create issue error:", err);
    res.status(500).json({ error: "Failed to create audit issue" });
  }
});

/* --------------------------- BULK upload (Excel/CSV) ------------------------ */
app.post(
  "/api/audit-issues/upload",
  memoryUpload.single("file"),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    try {
      await reseedSerialIfEmpty();
      const ext = path.extname(req.file.originalname).toLowerCase();
      let workbook;
      if (ext === ".csv") {
        const text = req.file.buffer.toString("utf8");
        workbook = XLSX.read(text, { type: "string" });
      } else {
        workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      }

      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

      if (!rows.length) {
        return res.status(400).json({ error: "File is empty." });
      }

      const headerRowRaw = rows[0];
      const header = headerRowRaw.map((h) =>
        String(h || "")
          .trim()
          .toLowerCase()
      );
      const dataRows = rows
        .slice(1)
        .filter((r) => r.some((c) => String(c ?? "").trim() !== ""));

      const idx = (name) => header.indexOf(name.toLowerCase());
      const idxAny = (...names) => {
        for (const n of names) {
          const i = idx(n);
          if (i !== -1) return i;
        }
        return -1;
      };
      const val = (row, name, def = "") => {
        const i = idx(name);
        return i === -1 ? def : row[i];
      };
      const valAny = (row, names, def = "") => {
        const i = idxAny(...names);
        return i === -1 ? def : row[i];
      };

      const mustHave = [
        "fiscalyear",
        "process",
        "entitycovered",
        "observation",
        "risklevel",
        "recommendation",
        "personresponsible",
        "currentstatus",
      ];
      const missing = mustHave.filter((h) => !header.includes(h));
      if (missing.length) {
        return res
          .status(400)
          .json({ error: `Missing required columns: ${missing.join(", ")}` });
      }

      const connection = await auditPool.getConnection();
      const insertQuery = `
      INSERT INTO dbo.AuditIssues (
        id, fiscalYear, date, process, entityCovered, observation, riskLevel,
        recommendation, managementComment, personResponsible, approver,
        cxoResponsible, coOwner, timeline, currentStatus, evidenceReceived,
        reviewComments, risk, actionRequired, startMonth, endMonth, annexure, createdAt, updatedAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE(), GETDATE())
    `;

      let successCount = 0;
      let errorCount = 0;

      for (const row of dataRows) {
        try {
          const fiscalYear = val(row, "fiscalyear", "");
          const process = val(row, "process", "");
          const entityCovered = val(row, "entitycovered", "");
          const observation = val(row, "observation", "");
          const riskLevelRaw = val(row, "risklevel", "");
          const recommendation = val(row, "recommendation", "");
          const managementComment = val(row, "managementcomment", "");
          const personResponsible = valAny(
            row,
            ["personresponsible", "person responsible"],
            ""
          );
          const approver = val(row, "approver", "");
          const cxoResponsible = valAny(
            row,
            ["cxoresponsible", "cxo responsible"],
            ""
          );
          const coOwner = valAny(row, ["coowner", "co-owner", "co owner"], "");
          const timelineRaw = val(row, "timeline", "");
          const currentStatusRaw = valAny(
            row,
            ["currentstatus", "current status"],
            ""
          );
          const startMonth = valAny(
            row,
            ["startmonth", "coverage start month", "coveragestartmonth"],
            ""
          );
          const endMonth = valAny(
            row,
            ["endmonth", "coverage end month", "coverageendmonth"],
            ""
          );
          const reviewComments = valAny(
            row,
            ["reviewcomments", "review comments"],
            ""
          );
          const risk = val(row, "risk", "");
          const actionRequired = valAny(
            row,
            ["actionrequired", "action required"],
            ""
          );
          const annexureRaw = val(row, "annexure", "");

          const id = uuidv4();
          const riskLevel = normRiskLevel(riskLevelRaw);
          const currentStatus = normStatus(currentStatusRaw);

          const safeTimeline =
            typeof timelineRaw === "number"
              ? convertExcelDate(timelineRaw)
              : formatDate(timelineRaw);

          const annexureArr = String(annexureRaw || "")
            .split(/[;,]\s*/)
            .filter(Boolean)
            .map((name) => ({ name, uploadedAt: new Date().toISOString() }));

          const joinMulti = (s) =>
            String(s || "")
              .split(/[;,]\s*/)
              .filter(Boolean)
              .join(";");

          await connection.execute(insertQuery, [
            id,
            fiscalYear,
            formatDate(new Date()),
            process,
            entityCovered,
            observation,
            riskLevel,
            recommendation,
            managementComment,
            joinMulti(personResponsible),
            joinMulti(approver),
            joinMulti(cxoResponsible),
            joinMulti(coOwner),
            safeTimeline,
            currentStatus,
            JSON.stringify([]),
            reviewComments || "",
            risk || "",
            actionRequired || "",
            startMonth || "",
            endMonth || "",
            JSON.stringify(annexureArr),
          ]);
          successCount++;
        } catch (err) {
          console.error("❌ Row insert error:", err);
          errorCount++;
        }
      }

      res.status(200).json({
        message: `✅ Imported ${successCount} row(s)${
          errorCount ? `, ❌ ${errorCount} failed.` : "."
        }`,
      });
    } catch (err) {
      console.error("⛔ Upload processing error:", err);
      res.status(500).json({ error: "Failed to process upload" });
    }
  }
);

/* ------------------------------- LIST all ---------------------------------- */
app.get("/api/audit-issues", async (req, res) => {
  try {
    const viewer = String(req.query.viewer || "")
      .trim()
      .toLowerCase();
    const connection = await auditPool.getConnection();
    const [rows] = await connection.execute(`
      SELECT 
        id, serialNumber, fiscalYear, date, process,
        entityCovered, observation, riskLevel, recommendation,
        managementComment, personResponsible, approver, cxoResponsible,
        coOwner, timeline, currentStatus, evidenceReceived, evidenceStatus,
        reviewComments, risk, actionRequired, startMonth, endMonth,
        annexure, createdAt, updatedAt
      FROM dbo.AuditIssues
      ORDER BY createdAt DESC;
    `);

    const issues = rows.map((r) => {
      let ev = [],
        ax = [];
      try {
        ev = JSON.parse(r.evidenceReceived || "[]");
      } catch {}
      try {
        ax = JSON.parse(r.annexure || "[]");
      } catch {}
      const isLocked = String(r.evidenceStatus || "") === "Accepted";
      return { ...r, evidenceReceived: ev, annexure: ax, isLocked };
    });

    const filtered = viewer
      ? issues.filter((r) => {
          const norm = (s) => String(s || "").toLowerCase();
          const list = [
            r.personResponsible,
            r.approver,
            r.cxoResponsible,
          ].flatMap((s) =>
            norm(s)
              .split(/[;,]/)
              .map((x) => x.trim())
              .filter(Boolean)
          );
          return list.includes(viewer);
        })
      : issues;

    res.status(200).json(filtered);
  } catch (err) {
    console.error("⛔ Error fetching audit issues:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ------------------------ Evidence upload (multiple) ------------------------ */
app.post(
  "/api/audit-issues/:id/evidence",
  diskUpload.array("evidence"),
  async (req, res) => {
    const issueId = req.params.id;
    const uploadedBy = req.body.uploadedBy || "Unknown";
    const textEvidence = (req.body.textEvidence || "").trim();
    const justification = (req.body.justification || "").trim();

    try {
      const connection = await auditPool.getConnection();
      const [rows] = await connection.execute(
        `SELECT evidenceReceived, personResponsible, cxoResponsible, approver, serialNumber, process, entityCovered 
       FROM dbo.AuditIssues 
       WHERE id = ?`,
        [issueId]
      );
      if (rows.length === 0)
        return res.status(404).json({ error: "Audit issue not found" });

      const row = rows[0];
      let currentEvidence = [];
      try {
        currentEvidence = JSON.parse(row.evidenceReceived || "[]");
      } catch {}

      const newEntries = (req.files || []).map((file) => ({
        id: Date.now() + "-" + Math.random().toString(36).substr(2, 9),
        fileName: file.originalname,
        fileType: file.mimetype,
        fileSize: file.size,
        uploadedAt: new Date().toISOString(),
        uploadedBy,
        path: path.relative(__dirname, file.path),
      }));

      if (textEvidence) {
        newEntries.unshift({
          id: Date.now() + "-txt-" + Math.random().toString(36).substr(2, 9),
          fileName: "Comment",
          fileType: "text/plain",
          fileSize: textEvidence.length,
          uploadedAt: new Date().toISOString(),
          uploadedBy,
          content: textEvidence,
        });
      }
      if (justification) {
        newEntries.unshift({
          id: Date.now() + "-just-" + Math.random().toString(36).substr(2, 9),
          fileName: "Justification for Extension of Due Date",
          fileType: "text/plain",
          fileSize: justification.length,
          uploadedAt: new Date().toISOString(),
          uploadedBy,
          content: justification,
        });
      }

      const updatedEvidence = [...currentEvidence, ...newEntries];

      await connection.execute(
        `UPDATE dbo.AuditIssues 
       SET evidenceReceived = ?, updatedAt = GETDATE() 
       WHERE id = ?`,
        [JSON.stringify(updatedEvidence), issueId]
      );

      const caption = `${row.serialNumber} – ${row.process} / ${row.entityCovered}`;

      const htmlForPerson = `
  Your Proof for ${caption} was submitted and is awaiting Auditor Response.
`;
      const htmlForCXO = `
  ${uploadedBy} has submitted proof for ${caption}.<br/>
  You were marked as CXO responsible for ${caption}.<br/>
  Please review: <a href="https://audit.premierenergies.com">audit.premierenergies.com</a>
`;
      const htmlForAuditor = `
  ${uploadedBy} has uploaded proof for ${caption}.<br/>
  Please review and comment as soon as possible.
`;

      const personEmails = toEmails(row.personResponsible);
      const cxoEmails = toEmails(row.cxoResponsible);
      const approverEmails = toEmails(row.approver);

      await Promise.all([
        ...personEmails.map((e) =>
          sendEmail(e, "Proof Submitted", htmlForPerson)
        ),
        ...cxoEmails.map((e) =>
          sendEmail(e, `${uploadedBy} submitted proof`, htmlForCXO)
        ),
        ...approverEmails.map((e) =>
          sendEmail(e, "New Proof Uploaded", htmlForAuditor)
        ),
      ]);

      res.status(200).json({
        message: `Stored ${newEntries.length} file(s) and notified stakeholders.`,
      });
    } catch (err) {
      console.error("⛔ Evidence upload error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

/* --------------------------- Auditor review (PUT) --------------------------- */
app.put("/api/audit-issues/:id/review", async (req, res) => {
  const issueId = req.params.id;
  const { evidenceStatus, reviewComments } = req.body;

  if (
    !["Accepted", "Insufficient", "Partially Accepted"].includes(evidenceStatus)
  ) {
    return res.status(400).json({
      error:
        'evidenceStatus must be "Accepted", "Insufficient", or "Partially Accepted"',
    });
  }

  try {
    const connection = await auditPool.getConnection();
    const [lookupRows] = await connection.execute(
      `SELECT serialNumber, process, entityCovered, personResponsible, cxoResponsible
       FROM dbo.AuditIssues WHERE id = ?`,
      [issueId]
    );
    if (lookupRows.length === 0)
      return res.status(404).json({ error: "Audit issue not found" });

    const updateFields = [
      "evidenceStatus = ?",
      "reviewComments = ?",
      "updatedAt = GETDATE()",
    ];
    if (evidenceStatus === "Accepted") {
      updateFields.push("currentStatus = 'Received'");
    } else if (evidenceStatus === "Partially Accepted") {
      updateFields.push("currentStatus = 'Partially Received'");
    } else {
      updateFields.push("currentStatus = 'To Be Received'");
    }

    await connection.execute(
      `UPDATE dbo.AuditIssues SET ${updateFields.join(", ")} WHERE id = ?`,
      [evidenceStatus, reviewComments, issueId]
    );

    const [updatedRows] = await connection.execute(
      `SELECT * FROM dbo.AuditIssues WHERE id = ?`,
      [issueId]
    );
    const updated = updatedRows[0];

    try {
      updated.evidenceReceived = JSON.parse(updated.evidenceReceived || "[]");
    } catch {
      updated.evidenceReceived = [];
    }

    const caption = `${updated.serialNumber} – ${updated.process} / ${updated.entityCovered}`;
    const link = `<a href="https://audit.premierenergies.com">audit.premierenergies.com</a>`;

    const personEmails = toEmails(updated.personResponsible);
    const cxoEmails = toEmails(updated.cxoResponsible);

    if (evidenceStatus === "Accepted") {
      await Promise.all([
        ...personEmails.map((e) =>
          sendEmail(
            e,
            `Proof Accepted for ${caption}`,
            `The proof for ${caption} has been accepted. ${link}`
          )
        ),
        ...cxoEmails.map((e) =>
          sendEmail(
            e,
            `Proof Accepted for ${caption}`,
            `The proof for ${caption} has been accepted. ${link}`
          )
        ),
      ]);
    } else if (evidenceStatus === "Partially Accepted") {
      await Promise.all([
        ...personEmails.map((e) =>
          sendEmail(
            e,
            `Proof Partially Accepted for ${caption}`,
            `The proof for ${caption} has been partially accepted. ${link}`
          )
        ),
        ...cxoEmails.map((e) =>
          sendEmail(
            e,
            `Proof Partially Accepted for ${caption}`,
            `The proof for ${caption} has been partially accepted. ${link}`
          )
        ),
      ]);
    } else {
      await Promise.all([
        ...personEmails.map((e) =>
          sendEmail(
            e,
            `Proof Marked as Not Sufficient for ${caption}`,
            `The proof for ${caption} is insufficient. ${link}`
          )
        ),
        ...cxoEmails.map((e) =>
          sendEmail(
            e,
            `Proof Marked as Not Sufficient for ${caption}`,
            `The proof for ${caption} is insufficient. ${link}`
          )
        ),
      ]);
    }

    res.status(200).json(updated);
  } catch (err) {
    console.error("⛔ Review endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ------------------------------ Update an issue ----------------------------- */
// Safeguard: if evidenceStatus === 'Accepted', block changes to 'observation'
app.put("/api/audit-issues/:id", memoryUpload.none(), async (req, res) => {
  const { id } = req.params;
  const fields = req.body || {};

  const row = await getIssueRow(id);
  if (!row) return res.status(404).json({ error: "Not found" });
  if (isLocked(row)) return lockedRes(res);

  const connection = await auditPool.getConnection();
  const [rows] = await connection.execute(
    `SELECT evidenceStatus FROM dbo.AuditIssues WHERE id = ?`,
    [id]
  );
  if (!rows.length) return res.status(404).json({ error: "Not found" });

  const accepted = rows[0].evidenceStatus === "Accepted";
  if (accepted && typeof fields.observation === "string") {
    return res
      .status(400)
      .json({ error: "Observation cannot be edited after acceptance." });
  }

  // ✅ EMP validation if any of these fields are being updated
  const candidateLists = [];
  if (typeof fields.personResponsible === "string") {
    candidateLists.push(
      ...toEmails(fields.personResponsible).map(normalizeToEmail)
    );
  }
  if (typeof fields.approver === "string") {
    candidateLists.push(...toEmails(fields.approver).map(normalizeToEmail));
  }
  if (typeof fields.cxoResponsible === "string") {
    candidateLists.push(
      ...toEmails(fields.cxoResponsible).map(normalizeToEmail)
    );
  }
  if (typeof fields.coOwner === "string") {
    candidateLists.push(...toEmails(fields.coOwner).map(normalizeToEmail));
  }
  if (candidateLists.length) {
    const missing = await findMissingEmployees(candidateLists);
    if (missing.length) {
      return res
        .status(400)
        .json({ error: `Unknown employee email(s): ${missing.join(", ")}` });
    }
  }

  const clash = checkRoleOverlap(
    fields.personResponsible,
    fields.approver,
    fields.cxoResponsible
  );
  if (clash)
    return res
      .status(400)
      .json({ error: "Same user cannot be PR, Approver and CXO." });

  const up = [];
  const vals = [];
  const set = (col, v) => {
    up.push(`${col} = ?`);
    vals.push(v);
  };

  const allowed = [
    "fiscalYear",
    "date",
    "process",
    "entityCovered",
    "observation",
    "riskLevel",
    "recommendation",
    "managementComment",
    "personResponsible",
    "approver",
    "cxoResponsible",
    "coOwner",
    "timeline",
    "currentStatus",
    "reviewComments",
    "risk",
    "actionRequired",
    "startMonth",
    "endMonth",
  ];
  for (const k of allowed) if (k in fields) set(k, fields[k]);

  if (!up.length) return res.json({ message: "No changes" });

  await connection.execute(
    `UPDATE dbo.AuditIssues SET ${up.join(
      ", "
    )}, updatedAt = GETDATE() WHERE id = ?`,
    [...vals, id]
  );

  const [updated] = await connection.execute(
    `SELECT * FROM dbo.AuditIssues WHERE id = ?`,
    [id]
  );
  res.json(updated[0]);
});

// helpers required by PUT route
async function getIssueRow(id) {
  const connection = await auditPool.getConnection();
  const [rows] = await connection.execute(
    `SELECT * FROM dbo.AuditIssues WHERE id = ?`,
    [id]
  );
  return rows[0] || null;
}
function isLocked(row) {
  return String(row?.evidenceStatus || "") === "Accepted";
}
function lockedRes(res) {
  return res
    .status(423)
    .json({ error: "Issue is locked (Accepted). Viewing only." });
}
function checkRoleOverlap(pr, appr, cxo) {
  const dedupe = (s) =>
    String(s || "")
      .toLowerCase()
      .split(/[;,]\s*/)
      .map((x) => x.trim())
      .filter(Boolean);
  const a = new Set(dedupe(pr));
  const b = new Set(dedupe(appr));
  const c = new Set(dedupe(cxo));
  const inter = (x, y) => [...x].some((v) => y.has(v));
  return inter(a, b) || inter(a, c) || inter(b, c);
}

/* ------------------------------ Reports (XLSX) ------------------------------ */
app.get("/api/audit-issues/reports/:reportType", async (req, res) => {
  const { reportType } = req.params;

  let query;
  let sheetName;

  if (reportType === "next3") {
    sheetName = "Next_3_Months_Report";
    query = `
      SELECT * FROM dbo.AuditIssues
      WHERE timeline >= ?
        AND timeline < DATEADD(MONTH, 3, ?)
      ORDER BY timeline;
    `;
  } else if (reportType === "next6") {
    sheetName = "Next_6_Months_Report";
    query = `
      SELECT * FROM dbo.AuditIssues
      WHERE timeline >= ?
        AND timeline < DATEADD(MONTH, 6, ?)
      ORDER BY timeline;
    `;
  } else if (reportType === "overdue") {
    sheetName = "Overdue_Report";
    query = `
      SELECT * FROM dbo.AuditIssues
      WHERE timeline < ?
      ORDER BY timeline;
    `;
  } else {
    return res
      .status(400)
      .json({ error: "Invalid reportType. Use next3, next6 or overdue." });
  }

  try {
    const connection = await auditPool.getConnection();
    const today = new Date();
    const dateParam = today.toISOString().split("T")[0];

    const [rows] =
      reportType === "overdue"
        ? await connection.execute(query, [dateParam])
        : await connection.execute(query, [dateParam, dateParam]);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${sheetName}.xlsx`
    );
    res.type(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.send(buf);
  } catch (err) {
    console.error("⛔ Report generation error:", err);
    res.status(500).json({ error: "Failed to generate report" });
  }
});

/* --------------------------- Manual closure (POST) -------------------------- */
app.post("/api/audit-issues/:id/close", async (req, res) => {
  const { id } = req.params;
  try {
    const connection = await auditPool.getConnection();
    await connection.execute(
      "UPDATE dbo.AuditIssues SET currentStatus = 'Closed', updatedAt = GETDATE() WHERE id = ?",
      [id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("⛔ Close issue error:", err);
    res.status(500).json({ error: "Failed to close audit issue" });
  }
});

/* --------------------------------- SPA fallthrough -------------------------- */
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "../dist", "index.html"));
});

/* --------------------------------- Servers --------------------------------- */
const PORT = process.env.PORT || 60443;
const HOST = process.env.HOST || "0.0.0.0";

const httpsOptions = {
  key: fs.readFileSync(path.join(__dirname, "certs", "mydomain.key"), "utf8"),
  cert: fs.readFileSync(
    path.join(__dirname, "certs", "d466aacf3db3f299.crt"),
    "utf8"
  ),
  ca: fs.readFileSync(
    path.join(__dirname, "certs", "gd_bundle-g2-g1.crt"),
    "utf8"
  ),
};

const startServer = async () => {
  try {
    https.createServer(httpsOptions, app).listen(PORT, HOST, () => {
      console.log(`HTTPS Server running at https://${HOST}:${PORT}`);
    });

    const HTTP_PORT = process.env.HTTP_PORT || 7723;
    http.createServer(app).listen(HTTP_PORT, HOST, () => {
      console.log(` HTTP Server running at http://${HOST}:${HTTP_PORT}`);
    });
  } catch (error) {
    console.error("Error starting the server:", error);
    process.exit(1);
  }
};

startServer();
