# MeetAnalyze

A full-stack Chrome extension with backend service for Google Meet intelligence and automation.

## Project Structure

```
meetanalyze/
├── backend/                  # Fastify backend service (Node.js, Sequelize, PostgreSQL)
│   ├── config/               # Database and server configuration
│   ├── src/                  # Controllers, models, routes, services, validators
│   ├── .env.example          # Backend environment variables template
│   └── package.json          # Backend dependencies and scripts
├── frontend/                 # Chrome extension (WXT, React 19, Tailwind CSS v4)
│   ├── entrypoints/          # Extension popup, background, and content scripts
│   ├── assets/               # Static images and icons
│   ├── public/               # Public extension assets and manifest icons
│   ├── wxt.config.ts         # WXT framework configuration with Tailwind Vite plugin
│   └── package.json          # Frontend dependencies and scripts
├── package.json              # Monorepo root workspace configuration and scripts
├── pnpm-workspace.yaml       # pnpm workspace definition
└── README.md
```

## Quick Start

### 1. Install Dependencies

You can install all dependencies from the root:
```bash
# Using npm
npm run install:all

# Or individually
cd frontend && npm install
cd ../backend && npm install # or yarn install
```

### 2. Configure Backend Environment

Copy the example environment file in `backend`:
```bash
cp backend/.env.example backend/.env
```
Fill in your database credentials and JWT configuration.

### 3. Running Development Servers

From the project root:

- **Run both Frontend and Backend concurrently:**
  ```bash
  npm run dev
  ```
- **Run Frontend only (Extension):**
  ```bash
  npm run dev:frontend
  ```
- **Run Backend only:**
  ```bash
  npm run dev:backend
  ```

### 4. Building the Extension

To build the extension for production:
```bash
npm run build:frontend
```
The compiled extension will be output to `frontend/.output/chrome-mv3`.
