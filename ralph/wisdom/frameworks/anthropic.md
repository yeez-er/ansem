# Anthropic SDK (Claude) Wisdom

<!-- Patterns for projects calling the Anthropic Messages API via @anthropic-ai/sdk -->

- Hide the SDK behind a narrow client interface (e.g. `VisionClient`/`TextClient` exposing only `complete()`) and inject it everywhere; narrow the transport down to `messages.create`. Call sites and tests never touch the raw SDK, so the whole AI surface is swappable and mockable. [from: itqan]
- Tests use a fake/fixture transport — NEVER hit a live model in CI. Keep recorded responses under `tests/fixtures/ai/`, and assert the request shape (system prompt, user text, image block) separately from response parsing. [from: itqan]
- `createClient(env)` must throw a typed `NOT_CONFIGURED` error loudly on a missing `ANTHROPIC_API_KEY` — never construct a key-less SDK instance that fails later with an opaque 401. Create the client LAZILY so a worker/process can boot without the key and only fail when a job actually needs AI. [from: itqan]
- Give AI errors a typed `.code` family (`NOT_CONFIGURED | EMPTY_RESPONSE | REQUEST_FAILED`). Each stage wrapper re-wraps any non-typed throw as `REQUEST_FAILED` and a malformed/parse failure as a stage-specific code, so the job retry loop can branch on the code instead of string-matching. [from: itqan]
- Model responses that "return JSON" usually wrap it in a ```json fence. Use ONE shared fenced-JSON parser that strips the optional fence, `JSON.parse`es, then validates against a Zod schema — don't re-implement the strip-and-parse per call site. [from: itqan]
- Keep request shapers (the pure function that builds the `messages.create` params) exported and unit-testable without a transport; assert the built request, not just the parsed response. [from: itqan]
- Pin model ids in a constant overridable by env (`MODEL_EXTRACT`, etc.) and set an explicit output-token budget; don't scatter literal model strings across call sites. [from: itqan]
- `message.content` from the Anthropic SDK is a `ContentBlock[]` (text / image / tool_use blocks), NOT the Vercel AI SDK `UIMessage.parts` shape. Auto-suggested Vercel "ai-sdk" / "ai-elements" skills are false positives on a direct-SDK project — decline them. [from: itqan]
