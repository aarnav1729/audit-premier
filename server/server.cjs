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
const { Client } = require("@microsoft/microsoft-graph-client");
const { ClientSecretCredential } = require("@azure/identity");
require("isomorphic-fetch");
const { v4: uuidv4 } = require("uuid");

const app = express();

// Use CORS with all origins and allow PATCH
app.use(
  cors({
    origin: "http://localhost:8080", // Allow all origins
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  })
);
//app.options(/.*/, cors()); // Handle preflight requests

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));

// Serve static files from the "dist" folder
app.use(express.static(path.join(__dirname, "../dist")));

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use("/uploads", express.static(uploadsDir));

// Multer setup
const upload = multer({ storage: multer.memoryStorage() });
const evidenceStorage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.random().toString(36).substr(2, 9);
    cb(null, unique + path.extname(file.originalname));
  },
});
const uploadEvidence = multer({ storage: evidenceStorage });

//config mysql

const mysql = require("mysql2/promise");

const dbConfig = {
  host: "localhost", // or your MySQL server IP
  user: "root",
  password: "Newpass12",
  database: "audit_database",
  port: 3306, // default MySQL port
  connectTimeout: 10000, // optional, in milliseconds
};

const pool = mysql.createPool(dbConfig);

// Initialize DB and ensure AuditIssues table exists

async function initDb() {
  try {
    const connection = await pool.getConnection();

     /*  // Create DB if not exists
    await connection.query("CREATE DATABASE IF NOT EXISTS audit_database");
    console.log("✅ Database 'audit_database' ready");

    // Now connect to it
    await connection.changeUser({ database: "audit_database" });*/

    const tableCheckQuery = `
      CREATE TABLE IF NOT EXISTS AuditIssues (
        id CHAR(36) NOT NULL PRIMARY KEY,
        serialNumber INT AUTO_INCREMENT UNIQUE,
        fiscalYear VARCHAR(20) NOT NULL,
        date DATE NOT NULL,
        process VARCHAR(100) NOT NULL,
        entityCovered VARCHAR(100) NOT NULL,
        observation TEXT NOT NULL,
        riskLevel VARCHAR(10) NOT NULL,
        recommendation TEXT NOT NULL,
        managementComment TEXT,
        personResponsible VARCHAR(256) NOT NULL,
        approver VARCHAR(256) NOT NULL,
        cxoResponsible VARCHAR(256) NOT NULL,
        coOwner VARCHAR(255),  
        timeline DATE,
        currentStatus VARCHAR(50) NOT NULL,
        evidenceReceived TEXT,
        evidenceStatus VARCHAR(50),
        reviewComments TEXT,
        risk TEXT,
        actionRequired TEXT,
        startMonth VARCHAR(50),
        endMonth VARCHAR(50) ,                      
        annexure TEXT,
        createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      );
    `;

    await connection.execute(tableCheckQuery);

    console.log("✅ AuditIssues table is ready (MySQL)");

    return connection;
  } catch (err) {
    console.error("⛔ Failed to initialize MySQL database:", err);
    process.exit(1);
  }
}

initDb();

module.exports = {
  pool,
  initDb,
};

// Microsoft Graph API credentials
const CLIENT_ID = "3d310826-2173-44e5-b9a2-b21e940b67f7";
const TENANT_ID = "1c3de7f3-f8d1-41d3-8583-2517cf3ba3b1";
const CLIENT_SECRET = "2e78Q~yX92LfwTTOg4EYBjNQrXrZ2z5di1Kvebog";
const SENDER_EMAIL = "spot@premierenergies.com";

// Create credential and Graph client
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

// Helper to send email via Graph
async function sendEmail(toEmail, subject, htmlContent) {
  const message = {
    subject: subject,
    body: {
      contentType: "HTML",
      content: htmlContent,
    },
    toRecipients: [{ emailAddress: { address: toEmail } }],
  };

  await graphClient
    .api(`/users/${SENDER_EMAIL}/sendMail`)
    .post({ message, saveToSentItems: "true" });
}

// POST /api/audit-issues → insert & send emails/mysql
app.post(
  "/api/audit-issues/upload",
  upload.single("file"),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    try {
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

      if (rows.length < 2) {
        return res.status(400).json({
          error: "File must have header and at least one row",
        });
      }

      const dataRows = rows.slice(1);
      let successCount = 0;
      let errorCount = 0;

      const connection = await pool.getConnection();

      const insertQuery = `
  INSERT INTO AuditIssues (
    id, fiscalYear, date, process, entityCovered, observation, riskLevel,
    recommendation, managementComment, personResponsible, approver,
    cxoResponsible, coOwner, timeline, currentStatus, evidenceReceived,
    reviewComments, risk, actionRequired, startMonth, endMonth, annexure
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;
      console.log("fiscalYear raw:", JSON.stringify(rows["fiscalYear"]));

      for (const row of dataRows) {
        if (!row.some((cell) => cell.trim?.())) continue;

        try {
          const [
            ,// skipping serial number
            fiscalYear,
            process,
            entityCovered,
            observation,
            riskLevel,
            recommendation,
            managementComment,
            personResponsible,
            approver,
            cxoResponsible,
            coOwner, // ✅ new field
            timeline,
            currentStatus,
            startMonth, // ✅ new field
            endMonth, // ✅ new field
            reviewComments,
            risk, // formerly riskAnnexure
            actionRequired,
            annexure, // ✅ from file if present in Excel
          ] = row;

          const mapRiskLevel = (r) => {
            const rl = (r || "").toLowerCase();
            if (rl === "high") return "high";
            if (rl === "low") return "low";
            return "medium";
          };
      
          const mapStatus = (s) => {
            if (Array.isArray(s)) s = s[0] ?? "";
            if (typeof s !== "string") s = String(s ?? "");

            const status = s.trim().toLowerCase();

            if (status.includes("partially")) return "Partially Received";
            if (status.includes("received")) return "Received";
            return "To Be Received";
          };

          const id = uuidv4();

          const values = [
            id,
            fiscalYear || "",
            new Date(),
            process || "",
            entityCovered || "",
            observation || "",
            mapRiskLevel(riskLevel),
            recommendation || "",
            managementComment || "",
            personResponsible || "",
            approver || "",
            cxoResponsible || "",
            coOwner || "",
            timeline ? new Date(timeline) : null,
            mapStatus(currentStatus),
            JSON.stringify([]),
            reviewComments || "",
            risk || "",
            actionRequired || "",
            startMonth || "",
            endMonth || "",
            annexure || "",
          ];

          await connection.execute(insertQuery, values);
          successCount++;
        } catch (err) {
          console.error("Row insert error:", err);
          errorCount++;
        }
      }

      res.status(200).json({
        message: `Imported ${successCount} rows${
          errorCount ? `, ${errorCount} failed` : ""
        }.`,
      });
    } catch (err) {
      console.error("Upload error:", err);
      res.status(500).json({ error: "Failed to process upload" });
    }
  }
);

// GET /api/audit-issues → fetch all (latest first)/mysql
app.get("/api/audit-issues", async (req, res) => {
  try {

    const connection = await pool.getConnection();

    const [rows] = await connection.execute(`
      SELECT 
        id, serialNumber, fiscalYear, date, process,
        entityCovered, observation, riskLevel, recommendation,
        managementComment, personResponsible, approver, cxoResponsible,
        coOwner,
        timeline, currentStatus, evidenceReceived, evidenceStatus,
        reviewComments, risk, 
        actionRequired, startMonth, endMonth,
        annexure,
        createdAt, updatedAt
      FROM AuditIssues
      ORDER BY createdAt DESC;
    `);

    const issues = rows.map((r) => {
      let ev = [];
      if (typeof r.evidenceReceived === "string") {
        try {
          ev = JSON.parse(r.evidenceReceived);
        } catch {
          ev = [];
        }
      }
      return { ...r, evidenceReceived: ev };
    });

    res.status(200).json(issues);
  } catch (err) {
    console.error("⛔ Error fetching audit issues:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Helpers to safely format date values
const formatDate = (val) => {
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d.toISOString().split("T")[0];
};

const convertExcelDate = (excelDate) => {
  if (!excelDate || typeof excelDate !== "number") return null;
  const jsDate = new Date(Math.round((excelDate - 25569) * 86400 * 1000));
  return jsDate.toISOString().split("T")[0];
};

// Route: POST /api/audit-issues/upload- insert bulk from excel and csv
app.post("/api/audit-issues/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  try {
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

    if (rows.length < 2) {
      return res.status(400).json({
        error: "File must contain a header and at least one data row.",
      });
    }

    const dataRows = rows.slice(1);
    let successCount = 0;
    let errorCount = 0;

    const connection = await pool.getConnection();

    const insertQuery = `
      INSERT INTO AuditIssues (
        id, fiscalYear, date, process, entityCovered, observation, riskLevel,
        recommendation, managementComment, personResponsible, approver,
        cxoResponsible, coOwner, timeline, currentStatus, evidenceReceived,
        risk, actionRequired, startMonth, endMonth, annexure
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    for (const row of dataRows) {
      // Skip empty rows
      if (!row.some((cell) => cell?.toString().trim())) continue;

      try {
        const [
          , // S.NO (ignored)
          fiscalYear,
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
          annexure,
          actionRequired,
          startMonth,
          endMonth,
        ] = row;

        const mapRiskLevel = (r) => {
          const rl = (r || "").toString().toLowerCase();
          if (rl === "high") return "high";
          if (rl === "low") return "low";
          return "medium";
        };

        const mapStatus = (s) => {
          if (Array.isArray(s)) s = s[0] ?? "";
          if (typeof s !== "string") s = String(s ?? "");
          const status = s.trim().toLowerCase();

          if (status.includes("partially")) return "Partially Received";
          if (status.includes("received")) return "Received";
          return "To Be Received";
        };

        const id = uuidv4();

        // Determine timeline format
        const safeTimeline =
          typeof timeline === "number"
            ? convertExcelDate(timeline)
            : formatDate(timeline);

        const values = [
          id,
          fiscalYear || "",
          new Date(), // current insert timestamp
          process || "",
          entityCovered || "",
          observation || "",
          mapRiskLevel(riskLevel),
          recommendation || "",
          managementComment || "",
          personResponsible || "",
          approver || "",
          cxoResponsible || "",
          coOwner || "",
          safeTimeline,
          mapStatus(currentStatus),
          JSON.stringify(evidenceReceived || []),
          reviewComments || "",
          actionRequired || "",
          startMonth || "",
          endMonth || "",
          annexure || "",
        ];

        console.log("startMonth value length:", (startMonth || "").length, "| value:", startMonth);


        await connection.execute(insertQuery, values);
        successCount++;
      } catch (err) {
        console.error("❌ Row insert error:", err);
        errorCount++;
      }
    }

    res.status(200).json({
      message: `✅ Imported ${successCount} rows${errorCount ? `, ❌ ${errorCount} failed.` : "."}`,
    });
  } catch (err) {
    console.error("⛔ Upload processing error:", err);
    res.status(500).json({ error: "Failed to process upload" });
  }
});

// NEW: POST /api/audit-issues/:id/evidence → upload proof files & notify/mysql
app.post(
  "/api/audit-issues/:id/evidence",
  uploadEvidence.array("evidence"),
  async (req, res) => {
    const issueId = req.params.id;
    const uploadedBy = req.body.uploadedBy || "Unknown";
    const textEvidence = (req.body.textEvidence || "").trim();

    try {
      const connection = await pool.getConnection();
      // 1) Fetch current issue
      const [rows] = await connection.execute(
        `SELECT evidenceReceived, personResponsible, cxoResponsible, approver, serialNumber, process, entityCovered 
         FROM AuditIssues 
         WHERE id = ?`,
        [issueId]
      );

      if (rows.length === 0) {
        return res.status(404).json({ error: "Audit issue not found" });
      }

      const row = rows[0];

      // 2) Parse current evidence if any
      let currentEvidence = [];
      if (row.evidenceReceived) {
        try {
          currentEvidence = JSON.parse(row.evidenceReceived);
        } catch {
          currentEvidence = [];
        }
      }

      // 3) Process uploaded files
      const newEntries = req.files.map((file) => ({
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

      const updatedEvidence = [...currentEvidence, ...newEntries];

      // 4) Update DB
      await connection.execute(
        `UPDATE AuditIssues 
         SET evidenceReceived = ?, updatedAt = NOW() 
         WHERE id = ?`,
        [JSON.stringify(updatedEvidence), issueId]
      );

      // 5) Notifications (mocked with sendEmail)
      const caption = `${row.serialNumber} – ${row.process} / ${row.entityCovered}`;

      const htmlForPerson = `
        Your Proof for ${caption} was submitted and is awaiting Auditor Response.
      `;
      const htmlForCXO = `
        ${uploadedBy} has submitted proof for ${caption}.<br/>
        You were marked as CXO responsible for ${caption} and they have added evidence.<br/>
        Please review: <a href="https://audit.premierenergies.com">audit.premierenergies.com</a>
      `;
      const htmlForAuditor = `
        ${uploadedBy} has uploaded proof for ${caption}.<br/>
        Please review and comment as soon as possible.
      `;

      await Promise.all([
        sendEmail(row.personResponsible, "Proof Submitted", htmlForPerson),
        sendEmail(
          row.cxoResponsible,
          `${uploadedBy} submitted proof`,
          htmlForCXO
        ),
        sendEmail(row.approver, `New Proof Uploaded`, htmlForAuditor),
      ]);

      // 6) Done
      res.status(200).json({
        message: `Stored ${newEntries.length} file(s) and notified stakeholders.`,
      });
    } catch (err) {
      console.error("⛔ Evidence upload error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

// ─── NEW: PUT /api/audit-issues/:id/review ───────────/mysql
app.put("/api/audit-issues/:id/review", async (req, res) => {

   console.log(" Received PUT /review with body:", req.body);

  const issueId = req.params.id;
  const { evidenceStatus, reviewComments } = req.body;

  // ✅ Validate allowed statuses
  if (!["Accepted", "Insufficient", "Partially Accepted"].includes(evidenceStatus)) {
    return res.status(400).json({
      error: 'evidenceStatus must be "Accepted", "Insufficient", or "Partially Accepted"',
    });
  }

  try {
    const connection = await pool.getConnection();

    // 1. Fetch current issue info
    const [lookupRows] = await connection.execute(
      `SELECT serialNumber, process, entityCovered, personResponsible, cxoResponsible
       FROM AuditIssues
       WHERE id = ?`,
      [issueId]
    );

    if (lookupRows.length === 0) {
      return res.status(404).json({ error: "Audit issue not found" });
    }

    const {
      serialNumber,
      process,
      entityCovered,
      personResponsible,
      cxoResponsible,
    } = lookupRows[0];
    const caption = `${serialNumber} – ${process} / ${entityCovered}`;

    // 2. Build update query
    const updateFields = [
      "evidenceStatus = ?",
      "reviewComments = ?",
      "updatedAt = NOW()"
    ];
    const updateValues = [evidenceStatus, reviewComments];

    // ✅ Update currentStatus based on evidenceStatus
    if (evidenceStatus === "Accepted") {
      updateFields.push("currentStatus = 'Received'");
    } else if (evidenceStatus === "Partially Accepted") {
      updateFields.push("currentStatus = 'Partially Received'");
    } else if (evidenceStatus === "Insufficient") {
      updateFields.push("currentStatus = 'To Be Received'");
    }

    updateValues.push(issueId);

    await connection.execute(
      `UPDATE AuditIssues SET ${updateFields.join(", ")} WHERE id = ?`,
      updateValues
    );

    // 3. Send email notifications
    const link = `<a href="https://audit.premierenergies.com">audit.premierenergies.com</a>`;

    if (evidenceStatus === "Accepted") {
      await Promise.all([
        sendEmail(
          personResponsible,
          `Proof Accepted for ${caption}`,
          `The proof you have uploaded for ${caption} has been accepted by the auditor. Please review here: ${link}`
        ),
        sendEmail(
          cxoResponsible,
          `Proof Accepted for ${caption}`,
          `The proof uploaded for ${caption} by ${personResponsible} has been accepted by the auditor. Please review here: ${link}`
        )
      ]);
    } else if (evidenceStatus === "Partially Accepted") {
      await Promise.all([
        sendEmail(
          personResponsible,
          `Proof Partially Accepted for ${caption}`,
          `The proof you uploaded for ${caption} has been partially accepted by the auditor. Please review here: ${link}`
        ),
        sendEmail(
          cxoResponsible,
          `Proof Partially Accepted for ${caption}`,
          `The proof uploaded for ${caption} by ${personResponsible} has been partially accepted by the auditor. Please review here: ${link}`
        )
      ]);
    } else {
      await Promise.all([
        sendEmail(
          personResponsible,
          `Proof Marked as Not Sufficient for ${caption}`,
          `The proof you have uploaded for ${caption} has been marked as insufficient by the auditor. Please review here: ${link}`
        ),
        sendEmail(
          cxoResponsible,
          `Proof Marked as Not Sufficient for ${caption}`,
          `The proof uploaded for ${caption} by ${personResponsible} has been marked as insufficient by the auditor. Please review here: ${link}`
        )
      ]);
    }

    // 4. Return updated record
    const [updatedRows] = await connection.execute(
      `SELECT * FROM AuditIssues WHERE id = ?`,
      [issueId]
    );
    const updated = updatedRows[0];

    try {
      updated.evidenceReceived = JSON.parse(updated.evidenceReceived || "[]");
    } catch {
      updated.evidenceReceived = [];
    }

    res.status(200).json(updated);
  } catch (err) {
    console.error("⛔ Review endpoint error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});


// ─── NEW: GET /api/audit-issues/reports/:reportType ─────────────────────/mysql
app.get("/api/audit-issues/reports/:reportType", async (req, res) => {
  const { reportType } = req.params;
  const today = new Date();
  let query;
  let sheetName;

  if (reportType === "next3") {
    sheetName = "Next_3_Months_Report";
    query = `
      SELECT * FROM AuditIssues
      WHERE timeline >= ?
        AND timeline < DATE_ADD(?, INTERVAL 3 MONTH)
      ORDER BY timeline;
    `;
  } else if (reportType === "next6") {
    sheetName = "Next_6_Months_Report";
    query = `
      SELECT * FROM AuditIssues
      WHERE timeline >= ?
        AND timeline < DATE_ADD(?, INTERVAL 6 MONTH)
      ORDER BY timeline;
    `;
  } else if (reportType === "overdue") {
    sheetName = "Overdue_Report";
    query = `
      SELECT * FROM AuditIssues
      WHERE timeline < ?
      ORDER BY timeline;
    `;
  } else {
    return res
      .status(400)
      .json({ error: "Invalid reportType. Use next3, next6 or overdue." });
  }

  try {

   const connection = await pool.getConnection();

    const dateParam = today.toISOString().split("T")[0];

    const [rows] =
      reportType === "overdue"
        ? await connection.execute(query, [dateParam])
        : await connection.execute(query, [dateParam, dateParam]);

    // Generate Excel workbook
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

// POST /api/audit-issues/:id/close
app.post("/:id/close", async (req, res) => {
  const { id } = req.params;
  try {
    await db.query("UPDATE AuditIssues SET currentStatus = ? WHERE id = ?", [
      "Closed",
      id,
    ]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to close audit issue" });
  }
});

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "../dist", "index.html"));
});

const PORT = process.env.PORT || 12443;
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
    // HTTPS
    https.createServer(httpsOptions, app).listen(PORT, HOST, () => {
      console.log(`HTTPS Server running at https://${HOST}:${PORT}`);
    });

    // HTTP (for local/dev)
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
