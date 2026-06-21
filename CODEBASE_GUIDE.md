# Apex AI — Codebase Guide

A deep-dive into how this app works, what every important piece does, and a full post-mortem of every error we hit during setup.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [The Three Package Roles](#2-the-three-package-roles)
3. [The API Route — `app/api/chat/route.ts`](#3-the-api-route)
4. [The Frontend — `app/page.tsx`](#4-the-frontend)
5. [The Data Flow End-to-End](#5-the-data-flow-end-to-end)
6. [Key Patterns You Will Reuse Everywhere](#6-key-patterns-you-will-reuse-everywhere)
7. [Debugging Post-Mortem — Every Error Explained](#7-debugging-post-mortem)

---

## 1. Architecture Overview

```
Browser (React)                    Server (Next.js API Route)           Anthropic API
─────────────────                  ──────────────────────────           ─────────────
useChat hook          ──POST──▶    route.ts                  ──HTTPS──▶ Claude
(manages messages)    ◀──stream──  streamText()              ◀──stream── (generates text)
```

This is a **streaming chat app**. Instead of waiting for the full response before showing anything, the server streams tokens back to the browser one chunk at a time — the same way you see Claude "type" in real time on claude.ai.

There are exactly two files that matter:

| File | Role |
|---|---|
| `app/api/chat/route.ts` | Receives messages from the browser, calls Claude, streams the response back |
| `app/page.tsx` | Renders the chat UI, captures user input, sends it to the route |

---

## 2. The Three Package Roles

```json
"@ai-sdk/anthropic": "^3.0.85"   ← The Anthropic MODEL PROVIDER (server-side only)
"@ai-sdk/react":     "^3.0.210"  ← React HOOKS for chat UI (client-side)
"ai":                "^6.0.208"  ← Core SDK: streamText, convertToModelMessages, etc.
```

**Critical distinction to internalize:**

- `@ai-sdk/anthropic` — knows how to talk to Anthropic's API. Gives you `anthropic('claude-sonnet-4-6')`. Nothing else. It does NOT contain any React hooks.
- `@ai-sdk/react` — knows how to manage chat state in React. Gives you `useChat()`. It does NOT contain model providers.
- `ai` — the core engine. Contains `streamText`, `convertToModelMessages`, and all the streaming plumbing that connects the two sides.

A common mistake (which broke this app initially) is importing `useChat` from `@ai-sdk/anthropic`. That package has no idea what React is.

---

## 3. The API Route

**File:** `app/api/chat/route.ts`

```ts
import { streamText, convertToModelMessages } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

const model = anthropic('claude-sonnet-4-6');

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: model,
    system: systemPrompt,
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}
```

### Line-by-line breakdown

**`import { streamText, convertToModelMessages } from 'ai'`**
- `streamText` — the main function for making a streaming LLM call. You will use this in every AI app that needs real-time output.
- `convertToModelMessages` — translates the frontend's `UIMessage[]` format into the `ModelMessage[]` format that `streamText` expects. This conversion step is required in `ai` v6 because the client and server use different message schemas.

**`import { anthropic } from '@ai-sdk/anthropic'`**
- `anthropic` is a factory function. Call it with a model ID string and it returns a model object the SDK knows how to call.
- You swap this out to use a different provider: `import { openai } from '@ai-sdk/openai'` and then `openai('gpt-4o')` — the rest of your code stays identical. That's the point of the provider abstraction.

**`const model = anthropic('claude-sonnet-4-6')`**
- Model IDs are version-pinned strings. `claude-sonnet-4-6` is the current production Sonnet. Always check the Anthropic docs for the current IDs — old ones get deprecated and return a 404.

**`export async function POST(req: Request)`**
- Next.js App Router convention. A file at `app/api/chat/route.ts` that exports `POST` automatically becomes the endpoint `POST /api/chat`. No configuration needed.

**`const { messages } = await req.json()`**
- Parses the JSON body sent by `useChat`. In `ai` v6, the body contains `{ id, messages, trigger, messageId }`. We only need `messages`.

**`await convertToModelMessages(messages)`**
- `messages` from the request are `UIMessage[]` — they have an `id`, a `role`, and a `parts` array (structured content blocks).
- `streamText` requires `ModelMessage[]` — they have a `role` and a `content` field (string or array).
- `convertToModelMessages` is `async` — you must `await` it. Without `await`, you hand a `Promise` to `streamText` instead of an array, and it crashes.

**`result.toUIMessageStreamResponse()`**
- Returns an HTTP `Response` that streams chunks back to the browser in the format `useChat` expects to receive.
- In `ai` v6 this method replaced the old `toDataStreamResponse()`.

### The system prompt
The `system` field is how you give Claude its persona and instructions without those instructions being part of the visible conversation. It's separate from `messages` and always applied. Everything in the backtick string in this file is the Race Engineer's rulebook — Claude reads it before every reply.

---

## 4. The Frontend

**File:** `app/page.tsx`

```tsx
'use client';

import { useState } from 'react';
import { useChat } from '@ai-sdk/react';

export default function Chat() {
  const { messages, sendMessage, status } = useChat();
  const [input, setInput] = useState('');
  const isLoading = status !== 'ready';

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage({ text: input });
    setInput('');
  }
  // ...
}
```

### Line-by-line breakdown

**`'use client'`**
- Next.js App Router runs components on the server by default. This directive tells Next.js this component uses browser APIs (React state, event handlers) and must run in the browser. Any file using `useState`, `useEffect`, or any hook needs this at the top.

**`useChat()`**
- The core hook from `@ai-sdk/react`. It manages the entire chat lifecycle:
  - Stores the conversation history in `messages`
  - Provides `sendMessage` to submit a new user message
  - Exposes `status` so you know if the model is currently generating
- By default it hits `/api/chat` — matching the route file exactly.

**`const { messages, sendMessage, status } = useChat()`**

| Property | Type | What it does |
|---|---|---|
| `messages` | `UIMessage[]` | The full conversation history. Re-renders the component as new tokens arrive. |
| `sendMessage` | `function` | Sends a message to `/api/chat` and begins streaming the response |
| `status` | `'ready' \| 'submitted' \| 'streaming' \| 'error'` | Current state of the connection |

**`const isLoading = status !== 'ready'`**
- In older SDK versions this was a boolean `isLoading` returned directly by the hook. In v3, it became a `status` string with four possible values. `status !== 'ready'` covers both `'submitted'` (request sent, waiting for first token) and `'streaming'` (tokens arriving).

**`sendMessage({ text: input })`**
- The v3 API for submitting a message. The argument is `{ text: string }`.
- Internally, the hook converts this into a `UIMessage` with `parts: [{ type: 'text', text: '...' }]` and sends the full conversation to the API route.
- The old pattern was `handleSubmit(event)` tied to a form — that no longer exists.

**`const [input, setInput] = useState('')`**
- In older SDK versions, `useChat` owned the input state and returned `input` and `handleInputChange`. In v3 it no longer does. You manage input yourself with `useState`, the same as any controlled form field in React.

### Rendering messages

```tsx
{messages.map((message) => (
  <div key={message.id} ...>
    {(message.parts ?? [{ type: 'text', text: message.content ?? '' }]).map((part, i) =>
      part.type === 'text'
        ? part.text.split('**').map((chunk, j) =>
            j % 2 === 1
              ? <strong key={`${i}-${j}`}>{chunk}</strong>
              : chunk
          )
        : null
    )}
  </div>
))}
```

**`message.id`** — Every message has a stable unique ID generated by the SDK. Always use this as the React `key` when mapping messages.

**`message.parts`** — In `ai` v6, a message is not a flat string. It's a list of typed content blocks:
- `{ type: 'text', text: '...' }` — a text segment
- `{ type: 'file', ... }` — a file attachment
- `{ type: 'tool-call', ... }` — a tool invocation (for agentic apps)

For a basic chat app, you only encounter `type: 'text'`.

**The `??` fallback** — The `??` (nullish coalescing) operator means "if the left side is null or undefined, use the right side." This guards against any message that arrives without a `parts` array.

**The `**` bold parsing** — This is a simple inline markdown parser. It splits the text on `**`, then every odd-indexed chunk was between two `**` markers, so it wraps those in `<strong>`. A real app would use a library like `react-markdown` for full markdown support.

---

## 5. The Data Flow End-to-End

Here is exactly what happens when you type a message and hit Send:

```
1. User types in <input>
   → setInput updates React state
   → input field re-renders with new value

2. User clicks Send / presses Enter
   → handleSubmit fires
   → sendMessage({ text: "Hello" }) is called

3. useChat builds a UIMessage:
   { id: "abc123", role: "user", parts: [{ type: "text", text: "Hello" }] }
   → Appends it to messages (instant — no waiting for server)
   → Sets status to "submitted"
   → POST /api/chat with body: { id, messages: [...all messages...], trigger, messageId }

4. route.ts receives the POST
   → req.json() extracts { messages }
   → convertToModelMessages(messages) converts UIMessage[] → ModelMessage[]
   → streamText() calls https://api.anthropic.com/v1/messages with stream: true

5. Anthropic starts streaming tokens back to route.ts
   → streamText forwards them through toUIMessageStreamResponse()
   → The HTTP response body is a live stream of SSE (Server-Sent Events) chunks

6. useChat receives the stream
   → For each chunk: updates the assistant message in messages in real-time
   → status changes from "submitted" → "streaming"
   → Component re-renders with each new token (you see text appear live)

7. Stream ends
   → status returns to "ready"
   → isLoading becomes false
   → Input field re-enables
```

---

## 6. Key Patterns You Will Reuse Everywhere

These are the patterns from this codebase that appear in virtually every AI application you will build.

### Pattern 1 — The Provider + streamText pattern (server)
```ts
import { streamText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

const result = streamText({
  model: anthropic('claude-sonnet-4-6'),
  system: 'You are a helpful assistant.',
  messages: await convertToModelMessages(messages),
});

return result.toUIMessageStreamResponse();
```
This exact structure is the foundation of every streaming AI route you will write. Swap the provider import and model string to change which model you use. Everything else stays the same.

### Pattern 2 — useChat hook (client)
```ts
const { messages, sendMessage, status } = useChat();
```
This is your standard starting point for any chat interface. You will add options to this as your apps grow more complex (`useChat({ api: '/api/custom', headers: { ... } })`), but the destructured values stay the same.

### Pattern 3 — Controlled input with manual state
```ts
const [input, setInput] = useState('');
// ...
sendMessage({ text: input });
setInput('');
```
Since the hook no longer owns input state, you always pair `useChat` with your own `useState` for the text field.

### Pattern 4 — UIMessage parts rendering
```tsx
{message.parts.map((part, i) =>
  part.type === 'text' ? part.text : null
)}
```
Every time you render a message, you iterate `parts` and filter by `type`. As you build more advanced apps (with tool calls, file attachments, reasoning traces), you add more `part.type` cases here.

### Pattern 5 — System prompt separation
```ts
streamText({
  system: 'Your persona instructions here...',
  messages: conversationHistory,
})
```
The system prompt is always separate from messages. It gives Claude its instructions and persona. It is never shown to the user and never included in the `messages` array. This is a strict convention across all LLM APIs.

### Pattern 6 — Streaming response method
```ts
return result.toUIMessageStreamResponse();
```
This is the method that converts the `streamText` result into a proper HTTP streaming response. In `ai` v6, always use `toUIMessageStreamResponse()`. In older versions (v3 and earlier) it was `toDataStreamResponse()` — you will see the old name in tutorials online.

---

## 7. Debugging Post-Mortem

We hit 5 distinct errors getting this app running. Each one was caused by breaking changes introduced in the `ai` SDK v6 and `@ai-sdk/react` v3 — versions so new that most tutorials online (and AI coding assistants trained before mid-2025) don't know about them. Here is every error, its root cause, and what we changed.

---

### Error 1 — `useChat` import from wrong package

**Error:**
```
Module not found: Can't resolve 'useChat' from '@ai-sdk/anthropic'
```

**Root cause:**
The original code imported `useChat` from `@ai-sdk/anthropic`. That package is only a model provider — it has no React code whatsoever. This is a common confusion because both packages start with `@ai-sdk/`.

**Fix:**
```ts
// Before
import { useChat } from '@ai-sdk/anthropic';

// After
import { useChat } from '@ai-sdk/react';
```

**Rule to remember:** `@ai-sdk/anthropic` = server-side model factory only. `@ai-sdk/react` = client-side hooks only.

---

### Error 2 — `input` is undefined / `.trim()` crash

**Error:**
```
TypeError: Cannot read properties of undefined (reading 'trim')
    at Chat (app/page.tsx:59:43)
```

**Root cause:**
In `ai` v3 (old), `useChat` returned `{ input, handleInputChange, handleSubmit, isLoading, ... }` — the hook owned the input field's state. In `@ai-sdk/react` v3 (new), the hook no longer manages input state at all. `input` is simply not returned, so it's `undefined`.

**Fix:**
Manage input state yourself with `useState`:
```ts
// Before — hook owned the input
const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat();

// After — you own the input
const { messages, sendMessage, status } = useChat();
const [input, setInput] = useState('');
const isLoading = status !== 'ready';
```

---

### Error 3 — `message.parts` is undefined

**Error:**
```
TypeError: Cannot read properties of undefined (reading 'map')
    at message.parts.map (app/page.tsx:39)
```

**Root cause:**
Two sub-problems at once:

1. The old rendering code used `message.content` (a flat string). In `ai` v6, messages use a `parts` array instead. `content` is no longer a top-level field on `UIMessage`.

2. When we called `sendMessage({ role: 'user', content: input })` (the old API), the SDK didn't recognize the shape and stored the message as-is — without building the `parts` array. So `message.parts` was `undefined`.

**Fix:**
```ts
// Before — old message format and old sendMessage API
sendMessage({ role: 'user', content: input });

// After — correct v6 sendMessage API
sendMessage({ text: input });
// The hook internally creates: { parts: [{ type: 'text', text: input }] }
```

And for rendering:
```tsx
// Before
{message.content}

// After
{(message.parts ?? [...]).map((part) =>
  part.type === 'text' ? part.text : null
)}
```

---

### Error 4 — `toDataStreamResponse is not a function`

**Error:**
```
TypeError: result.toDataStreamResponse is not a function
    at POST (app/api/chat/route.ts:283)
```

**Root cause:**
In `ai` v3–v5, the streaming result object had a method called `toDataStreamResponse()`. In `ai` v6, this was renamed to `toUIMessageStreamResponse()` as part of the new UIMessage architecture. The old method no longer exists.

**Fix:**
```ts
// Before
return result.toDataStreamResponse();

// After
return result.toUIMessageStreamResponse();
```

---

### Error 5 — `messages.some is not a function` (missing await)

**Error:**
```
TypeError: messages.some is not a function
```

**Root cause:**
`convertToModelMessages` is declared as an `async function`. Without `await`, calling it returns a `Promise` object, not an array. `streamText` received a `Promise` and immediately crashed when it tried to call `.some()` on it (a `Promise` has no `.some` method).

This is a subtle JavaScript async bug. The code looks correct at a glance — it compiles without errors — but the runtime behavior is wrong.

**Fix:**
```ts
// Before — missing await, passes a Promise to streamText
messages: convertToModelMessages(messages),

// After — awaits the async conversion, passes a real array
messages: await convertToModelMessages(messages),
```

**Rule to remember:** Whenever you call a function that returns data you intend to use, check if it's `async`. If it is, `await` it. TypeScript will sometimes catch this, but not always.

---

### Error 6 — Model ID 404

**Error:**
```
AI_APICallError: model: claude-3-5-sonnet-20240620
statusCode: 404
"type": "not_found_error"
```

**Root cause:**
The model ID `claude-3-5-sonnet-20240620` was deprecated by Anthropic. The API returns a 404 for any model ID that no longer exists in their system. This is not a code bug — it's a version management issue.

**Fix:**
```ts
// Before — deprecated model
const model = anthropic('claude-3-5-sonnet-20240620');

// After — current production model
const model = anthropic('claude-sonnet-4-6');
```

**Rule to remember:** Model IDs are not permanent. When an app stops working with a 404 from the Anthropic API and the error message contains a model name, the model has been retired. Always check the current model IDs in the Anthropic documentation.

---

### Summary Table

| # | Error | Root Cause | Fix |
|---|---|---|---|
| 1 | `useChat` not found in `@ai-sdk/anthropic` | Wrong package — hooks and providers are separate packages | Import from `@ai-sdk/react` |
| 2 | `input.trim()` crashes, `input` is undefined | `useChat` v3 no longer owns input state | Manage input with `useState` yourself |
| 3 | `message.parts` is undefined | Old `sendMessage({ role, content })` API bypassed `parts` construction | Use `sendMessage({ text })` — the v6 API |
| 4 | `toDataStreamResponse is not a function` | Method renamed in `ai` v6 | Use `toUIMessageStreamResponse()` |
| 5 | `messages.some is not a function` | `convertToModelMessages` is async, missing `await` | Add `await` before the call |
| 6 | 404 from Anthropic API | Model ID `claude-3-5-sonnet-20240620` was deprecated | Update to `claude-sonnet-4-6` |

---

*This codebase uses Next.js App Router, Vercel AI SDK v6, and @ai-sdk/react v3 — versions that introduced significant breaking changes from older tutorials. When searching for help online, look for resources dated 2025 or later.*
