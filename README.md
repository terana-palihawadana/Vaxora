<p align="center">
  <img src="mobile/assets/images/logo.png" alt="Vaxora" width="160" />
</p>

<h1 align="center">Vaxora</h1>

<p align="center">
  An immunization operations platform for bookings, inventory, clinical staff, and governed AI assistance.
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#stack">Stack</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#configuration">Configuration</a> ·
  <a href="#usage">Usage</a> ·
  <a href="#contributing">Contributing</a>
</p>

<p align="center">
  <img alt="backend" src="https://img.shields.io/badge/backend-ASP.NET%20Core%208-512BD4?style=flat" />
  <img alt="frontend" src="https://img.shields.io/badge/frontend-React%2019-61DAFB?style=flat&labelColor=555" />
  <img alt="mobile" src="https://img.shields.io/badge/mobile-Flutter-02569B?style=flat" />
  <img alt="agents" src="https://img.shields.io/badge/agents-FastAPI-009688?style=flat" />
  <img alt="database" src="https://img.shields.io/badge/database-PostgreSQL-4169E1?style=flat" />
</p>

---

## Overview

Vaxora is a full-stack system for vaccination program operations. It supports patients, hospitals, and clinical staff across appointment booking, inventory and schedules, rostering and cover requests, payments, and document handling. An AI layer can propose actions; authorized users approve sensitive changes before they take effect.

## Features

- Role-based web portals and a Flutter mobile client
- Appointments, hospital schedules, and payment integration
- Hospital inventory (formulary, batches, stock alerts)
- Staff affiliations, shifts, and cover workflows
- Multi-agent AI accessible only through the ASP.NET Core API
- Human approval before high-impact writes
- Object storage for registration documents
- JWT authentication and automated CI

## Stack

| Layer | Technologies |
|-------|----------------|
| API | ASP.NET Core 8, EF Core, JWT, PostgreSQL |
| Web | React 19, Vite, React Router |
| Mobile | Flutter |
| Agents | Python, FastAPI, OpenAI-compatible LLM provider |
| Infrastructure | Containerized API and agent services, SPA hosting, managed PostgreSQL, object storage |
| Tests | xUnit, Vitest, pytest, Flutter tests |

## Prerequisites

- Git
- .NET 8 SDK
- Node.js 20+ and npm
- Python 3.11+
- Flutter SDK (for the mobile app)
- PostgreSQL
- An OpenAI-compatible LLM API key (required only for agent features)

## Quick start

### 1. Clone the repository

```bash
git clone https://github.com/Risi2004/Vaxora.git
cd Vaxora
```

### 2. Create environment files

```bash
# Windows
copy Vaxora.Api\.env.example Vaxora.Api\.env
copy agent\.env.example agent\.env
copy frontend\.env.example frontend\.env

# macOS / Linux
cp Vaxora.Api/.env.example Vaxora.Api/.env
cp agent/.env.example agent/.env
cp frontend/.env.example frontend/.env
```

Fill in your values (see [Configuration](#configuration)). Do not commit `.env` files.

### 3. Run the stack

Start each process in its own terminal.

**API**

```bash
cd Vaxora.Api
dotnet run --urls http://localhost:5004
```

**Agent**

```bash
cd agent
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
# source .venv/bin/activate

pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

**Web**

```bash
cd frontend
npm install
npm run dev
```

| Local endpoint | URL |
|----------------|-----|
| Web app | http://localhost:5173 |
| API Swagger | http://localhost:5004/swagger |
| API health | http://localhost:5004/api/health |
| Agent health | http://localhost:8001/api/agent/health |

**Mobile (optional)**

```bash
cd mobile
flutter pub get
flutter run --dart-define=API_URL=http://10.0.2.2:5004/api
```

For a physical device, use a host URL the device can reach.

## Configuration

| Service | File | Required settings |
|---------|------|-------------------|
| API | `Vaxora.Api/.env` | Database connection string, JWT signing key, agent service URL (and shared key if used) |
| Agent | `agent/.env` | LLM credentials, API base URL (include `/api`), matching shared key if used |
| Web | `frontend/.env` | Leave empty for local proxy, or set `VITE_API_URL` to your API origin |

Full variable names are listed in each `*.env.example`.

## Usage

### Architecture

Clients call the ASP.NET Core API only. The API owns persistence, integrations, and authorization. It may invoke the internal agent service; agents call back into the API with the caller’s credentials for allow-listed tools. Sensitive changes require approval in the product UI.

```text
React / Flutter ──► ASP.NET Core API ──► PostgreSQL / storage / payments
                         │
                         └──► Agent service ──► LLM provider
                                   └── tool calls ──► API
```

### Health checks

```bash
curl http://localhost:5004/api/health
curl http://localhost:8001/api/agent/health
```

Sign in through the web or mobile UI. Use Swagger to explore protected endpoints after authentication.

### Pointing clients at a remote API

```env
# frontend/.env
VITE_API_URL=https://your-api-host.example
```

```bash
flutter run --dart-define=API_URL=https://your-api-host.example/api
```

## Testing

```bash
# API
dotnet test Vaxora.Api/Vaxora.Api.Tests/Vaxora.Api.Tests.csproj

# Web
cd frontend && npm test

# Agent
cd agent && pytest tests -q

# Mobile
cd mobile && flutter test
```

Continuous integration is defined in [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Contributing

1. Branch from `main` for each change.
2. Match existing project structure and coding patterns.
3. Keep secrets out of version control; extend `*.env.example` only with non-secret variable names.
4. Run the relevant tests before opening a pull request.
5. Describe the change and how it was verified.
