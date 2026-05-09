# AI Runtime Configuration Architecture

## Problem Statement

How might we let Along flexibly configure AI providers, tokens, models, runtimes, agents, and lightweight prompts without mixing model APIs with agent editor runtimes?

## Recommended Direction

Use a small configuration registry with two execution paths.

The first path is for agents. `Agent` selects a `Runtime`, and the runtime executes the agent turn through Codex, OpenCode, or another editor runtime. A runtime may define its default model and credential because the same runtime kind can be used with different model providers.

The second path is for direct model calls. `Prompt` represents lightweight AI tasks such as title summary, classification, PR title generation, or structured extraction. These prompts are executed by `LLMService`, not by an agent runtime.

Both paths share the same provider, credential, and model registry:

```txt
Provider
Credential
Model
Runtime
Agent
Prompt

RuntimeService
LLMService
```

`Provider` owns provider-level connection details such as `baseUrl`. `Credential` belongs to a provider. `Model` belongs to a provider and stores the provider model name. `Runtime` may point to a default model and credential. `Agent` points to a runtime and can override model or credential. `Prompt` points directly to a model and can override credential.

Runtime model resolution should follow this chain:

```txt
Runtime.modelId
  -> Model
  -> Model.providerId
  -> Provider.baseUrl
  -> Credential token
```

Credential priority:

```txt
task override
> agent.credentialId
> runtime.credentialId
> model.credentialId
> provider.defaultCredentialId
```

Model priority:

```txt
task override
> agent.modelId
> runtime.modelId
> global default
```

## Concept Model

```ts
type Provider = {
  id: string;
  kind: 'openai-compatible' | 'anthropic' | 'custom';
  name?: string;
  baseUrl?: string;
  defaultCredentialId?: string;
};

type Credential = {
  id: string;
  providerId: string;
  name?: string;
  token?: string;
  tokenEnv?: string;
};

type Model = {
  id: string;
  providerId: string;
  model: string;
  name?: string;
  credentialId?: string;
};

type Runtime = {
  id: string;
  kind: 'codex' | 'opencode' | string;
  name?: string;
  modelId?: string;
  credentialId?: string;
  settings?: Record<string, unknown>;
};

type Agent = {
  id: string;
  runtimeId: string;
  name?: string;
  modelId?: string;
  credentialId?: string;
  personalityVersion?: string;
};

type Prompt = {
  id: string;
  modelId: string;
  name?: string;
  credentialId?: string;
  systemPrompt: string;
  userTemplate?: string;
  temperature?: number;
  maxTokens?: number;
  outputFormat?: 'text' | 'json';
};
```

## Example

```json
{
  "providers": [
    {
      "id": "openai",
      "kind": "openai-compatible",
      "baseUrl": "https://api.openai.com/v1"
    },
    {
      "id": "openrouter",
      "kind": "openai-compatible",
      "baseUrl": "https://openrouter.ai/api/v1"
    }
  ],
  "credentials": [
    {
      "id": "openai-main",
      "providerId": "openai",
      "tokenEnv": "OPENAI_API_KEY"
    },
    {
      "id": "router-main",
      "providerId": "openrouter",
      "tokenEnv": "OPENROUTER_API_KEY"
    }
  ],
  "models": [
    {
      "id": "gpt-main",
      "providerId": "openai",
      "model": "gpt-5.2",
      "credentialId": "openai-main"
    },
    {
      "id": "claude-router",
      "providerId": "openrouter",
      "model": "anthropic/claude-sonnet-4.5",
      "credentialId": "router-main"
    }
  ],
  "runtimes": [
    {
      "id": "codex-openai",
      "kind": "codex",
      "modelId": "gpt-main"
    },
    {
      "id": "opencode-router",
      "kind": "opencode",
      "modelId": "claude-router"
    }
  ],
  "agents": [
    {
      "id": "planner",
      "runtimeId": "codex-openai"
    },
    {
      "id": "builder",
      "runtimeId": "opencode-router"
    }
  ],
  "prompts": [
    {
      "id": "title-summary",
      "modelId": "gpt-main",
      "systemPrompt": "Generate a concise task title."
    }
  ]
}
```

## Key Assumptions to Validate

- [ ] Codex and OpenCode can be adapted behind a common `RuntimeService.runAgentTurn` interface without hiding important runtime-specific behavior.
- [ ] Users can understand `Agent -> Runtime -> Model -> Provider -> Credential` without the configuration feeling too indirect.
- [ ] `Prompt` is a clear enough name for lightweight direct model tasks and will not be confused with editor workflow prompt files.
- [ ] Provider-compatible APIs such as OpenAI and OpenRouter can share enough client code to make `LLMService` useful.
- [ ] `tokenEnv` plus optional local `token` is enough for personal multi-machine configuration sharing.

## MVP Scope

Build the minimum registry and resolver first:

- Define `Provider`, `Credential`, `Model`, `Runtime`, `Agent`, and `Prompt` configuration types.
- Add validation for missing ids, unknown references, and provider mismatch between model and credential.
- Resolve an agent runtime into a fully usable runtime execution config.
- Resolve a prompt into a direct LLM execution config.
- Keep existing Codex behavior working as the first runtime implementation.
- Use one prompt, such as task title summary, to prove the `LLMService` path.

## Not Doing

- Memory layer - long-term memory should be added later as a context injection layer, not mixed into this configuration pass.
- Encryption and audit - this is personal configuration for one user across machines.
- Automatic model routing and fallback - useful later, but not needed to validate the entity model.
- Full provider capability matrix - start with only the fields needed to execute calls.
- Treating every prompt as an agent - lightweight prompts should not inherit agent runtime lifecycle, sessions, or tool permissions.
- Embedding full referenced entities inline - store ids in configuration, resolve full objects at runtime.

## Open Questions

- Should provider defaults include `defaultModelId`, or should model defaults only live on runtime, agent, and prompt?
- Should `Prompt` be renamed to `PromptTemplate` if variable interpolation becomes central?
- How much runtime-specific configuration should live in `Runtime.settings` before each runtime kind needs a typed settings schema?
- Should user-facing UI call `Runtime` an editor while keeping the internal entity name as `Runtime`?
