# Audit Premier

**Audit Premier** is a custom audit issue creation and tracking system built for Premier Energies. It provides a streamlined interface for managing audit issues, uploading evidence, tracking resolutions, and generating reports with detailed metadata and delegation structures.

---

## 🚀 Features

- 📥 Upload audit issues via Excel/CSV
- 🗂️ Issue tracking with status updates
- 📎 Attach evidence and annexures
- ✅ Manual closure by auditors
- 📧 Microsoft Graph integration for email notifications
- 🔍 Advanced filtering, search, and sorting
- 📊 Timeline-based reporting
- 👥 Multi-level delegation with responsible, approver, and co-owner support
- 🗓️ Audit coverage with optional start/end month fields

---

## 🧱 Tech Stack

- **Frontend**: React, TailwindCSS, Lucide Icons, ShadCN UI
- **Backend**: Express.js
- **Database**: MySQL
- **Other**: Multer (file uploads), XLSX (parsing Excel), Microsoft Graph API

---

## 🛠️ Getting Started

### Prerequisites

- Node.js (v18+)
- MySQL server
- Microsoft Azure App Registration (for email integration)

### Installation

# Install backend dependencies
npm install

# Configure environment
cp .env.example .env
# Fill in DB and email credentials

# Initialize database
npm run migrate   # or a custom SQL script for table setup

# Start development server
npm run dev
