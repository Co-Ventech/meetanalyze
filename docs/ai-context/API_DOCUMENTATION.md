# MeetAnalyze (MeetLyst) — API & Protocol Documentation

## 1. Global API Conventions

### Base URLs
- **Local Development**: `http://localhost:5000` (or `http://localhost:2000`)
- **Production (Vercel)**: `https://<your-vercel-deployment>.vercel.app`

### Route Mounting
In [`backend/server.js`](file:///Users/aahil/Desktop/meetlyst/backend/server.js), every registered route is automatically prefixed with `/api/v1`:
```javascript
routes.forEach(route => {
    route.url = `/api/v1${route.url.startsWith('/') ? route.url : '/' + route.url}`;
    fastify.route(route);
});
```

### Common Headers
- `Content-Type: application/json`
- `Authorization: Bearer <jwt_access_token>` (for authenticated endpoints)
- `Access-Control-Allow-Origin: *` (enabled via `@fastify/cors`)

---

## 2. Authentication Endpoints

### 2.1 Register User
Creates a new user account.

- **Method**: `POST`
- **URL**: `/api/v1/auth/register`
- **Validation**: Enforced via Joi schema (`authValidator.registerValidator`).

#### Request Headers
```http
Content-Type: application/json
```

#### Request Body
```json
{
  "name": "Ahil Alwani",
  "email": "agent@example.com",
  "password": "SecurePassword123!",
  "userRole": "customer"
}
```

| Field | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `name` | `string` | Yes | Full display name (minimum 3 characters). |
| `email` | `string` | Yes | Valid email address. |
| `password` | `string` | Yes | User password (minimum 6 characters). |
| `userRole` | `string` | No | `'customer'` or `'admin'` (default: `'customer'`). |

#### Responses
- **`201 Created`**:
  ```json
  {
    "status": 201,
    "message": "User Created Successfully",
    "data": {
      "user_id": "4b68e994-35bb-41a2-97b7-2ad0b0ef2140",
      "name": "Ahil Alwani",
      "email": "agent@example.com",
      "user_role": "customer",
      "createdAt": "2026-11-04T12:00:00.000Z",
      "updatedAt": "2026-11-04T12:00:00.000Z"
    }
  }
  ```
- **`400 Bad Request`**: Joi validation failure.
- **`500 Internal Server Error`**: Database constraint or connection failure.

---

### 2.2 Login User
Authenticates user credentials and issues a signed JSON Web Token.

- **Method**: `POST`
- **URL**: `/api/v1/auth/login`
- **Validation**: Enforced via Joi schema (`authValidator.loginValidator`).

#### Request Body
```json
{
  "email": "agent@example.com",
  "password": "SecurePassword123!"
}
```

#### Responses
- **`200 OK`**:
  ```json
  {
    "status": 200,
    "message": "User Logged in",
    "data": {
      "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
    }
  }
  ```
- **`401 Unauthorized`**: Password does not match.
- **`404 Not Found`**: No account found with provided email.

---

## 3. Transcription & Meeting Intelligence Endpoints

### 3.1 Get Ephemeral Transcription Token
Generates a short-lived, client-safe streaming token from AssemblyAI so the frontend extension never exposes the master `ASSEMBLYAI_API_KEY`.

- **Method**: `GET`
- **URL**: `/api/v1/transcription/token`

#### Responses
- **`200 OK`**:
  ```json
  {
    "success": true,
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "host": "streaming.assemblyai.com"
  }
  ```
- **`500 Internal Server Error`**:
  ```json
  {
    "success": false,
    "message": "ASSEMBLYAI_API_KEY is not defined in backend/.env"
  }
  ```

---

### 3.2 Summarize Transcript & Generate Sales Insight (.doc)
Submits transcript data to AssemblyAI's LLM Gateway, evaluates sales performance against `SALES_PROMPT`, formats the output into an executive Microsoft Word document, and streams the file binary back for immediate browser download.

- **Method**: `POST`
- **URL**: `/api/v1/summarize`
- **Alias URL**: `/api/v1/transcription/summarize`

#### Request Headers
```http
Content-Type: application/json
```

#### Request Body
Accepts either an array of turn objects or a pre-formatted string:

**Format A: Array of Turns (sent by Extension Popup):**
```json
{
  "transcript": [
    {
      "id": "turn_1",
      "speaker": "Ahil (You)",
      "isSelf": true,
      "text": "Hello, thank you for joining our sales demonstration today.",
      "timestamp": "2:30 PM"
    },
    {
      "id": "turn_2",
      "speaker": "Arsalan",
      "isSelf": false,
      "text": "Thanks Ahil. What is your pricing structure for enterprise teams?",
      "timestamp": "2:31 PM"
    }
  ]
}
```

**Format B: Plain Text:**
```json
{
  "transcript": "Ahil [2:30 PM]: Hello, thank you for joining...\n\nArsalan [2:31 PM]: What is your pricing?"
}
```

#### Response Headers
```http
Content-Type: application/msword
Content-Disposition: attachment; filename="Meeting_Insight_Report_1793807432902.doc"
Access-Control-Expose-Headers: Content-Disposition
```

#### Response Body
Binary stream (`Buffer`) containing the complete `.doc` file (Office HTML with XML namespaces).

#### Error Responses
- **`400 Bad Request`**:
  ```json
  {
    "success": false,
    "message": "A valid meeting transcript is required to generate meeting insights."
  }
  ```
- **`500 Internal Server Error`**:
  ```json
  {
    "success": false,
    "message": "Failed to generate meeting insight summary"
  }
  ```

---

## 4. WebSocket Protocol (AssemblyAI Real-Time Streaming v3)

The extension's offscreen document connects directly to AssemblyAI's streaming WebSocket.

### 4.1 Connection Parameters
- **URL**: `wss://<host>/v3/ws` (default host: `streaming.assemblyai.com`)
- **Query Parameters**:
  - `token`: Ephemeral token from `/api/v1/transcription/token`.
  - `sample_rate`: Sample rate matching browser `AudioContext.sampleRate` (e.g. `16000`, `44100`, or `48000`).
  - `speech_model`: `universal-3-6-pro` (flagship streaming model supporting 32 languages, native code-switching, and live punctuate).

### 4.2 Inbound Audio Messages (Client -> Server)
Binary WebSocket frames containing 16-bit Linear PCM audio (`Int16Array` converted via `floatTo16BitPCM`).

### 4.3 Outbound Event Messages (Server -> Client)

#### Transcript Turn (`Turn`)
```json
{
  "type": "Turn",
  "transcript": "Hello, how can I help you today?",
  "end_of_turn": true,
  "turn_order": 1
}
```
- `transcript`: Current spoken text.
- `end_of_turn`: `false` for partial, continuous transcription; `true` when a complete sentence or pause concludes the turn.

#### Termination
```json
{
  "type": "Termination"
}
```
Acknowledges clean closure after client transmits `{"type": "Terminate"}`.

