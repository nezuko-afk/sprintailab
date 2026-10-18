# Sequence diagrams

Status: **implemented** for flows 1 to 4. Flow 5 is future work (no sandbox yet).

## 1. Call covered by an existing authorization

```mermaid
sequenceDiagram
    autonumber
    participant A as AI agent
    participant G as Governance proxy
    participant P as Policy and gate
    participant L as Audit log
    participant R as REA (rea mcp)

    A->>G: tools/call open_binary(path=/work/clientA/app)
    G->>P: Tier lookup, extract targets, check authorizations
    P-->>G: Allow (tier 1, covered by authorization id X)
    G->>L: authorization_observed (first use), tool_call allow + targets + id X
    G->>R: Forward call unchanged
    R-->>G: Result + Evidence (evidence_id)
    G->>L: tool_result (outcome, evidence_id, duration)
    G-->>A: Result unchanged
```

## 2. Not yet authorized: the person is asked (client supports prompts)

```mermaid
sequenceDiagram
    autonumber
    participant A as AI agent
    participant G as Governance proxy
    actor U as Person (client UI)
    participant L as Audit log
    participant R as REA (rea mcp)

    A->>G: tools/call open_binary(path=/work/clientA/app)
    G->>G: Tier ok, target not covered
    G->>U: elicitation: target, tool, statement, reference, duration
    Note over A,U: The agent never sees or answers this form
    U-->>G: confirm = true, reference, 4h
    G->>G: Save authorization (scoped to that folder, tier 1, expires in 4h)
    G->>L: authorization_granted, then tool_call allow
    G->>R: Forward call
    R-->>G: Result + Evidence
    G-->>A: Result
```

If the person declines, cancels, leaves the box unticked, or omits a required reference, the call is
denied with rule R5 and `authorization_declined` is logged.

## 3. Not authorized and the client cannot prompt (terminal path)

```mermaid
sequenceDiagram
    autonumber
    participant A as AI agent
    participant G as Governance proxy
    actor U as Person (terminal)
    participant S as Authorizations file
    participant L as Audit log

    A->>G: tools/call open_binary(path=/work/clientA/app)
    G->>L: tool_call deny R3
    G-->>A: Denied: not authorized. A person can run: sprintailab authorize --scope ...
    A-->>U: Asks the person to authorize
    U->>S: sprintailab authorize (interactive terminal, types YES)
    A->>G: Retry the same call
    G->>S: Read active authorizations
    G->>L: authorization_observed, tool_call allow
    Note over G: Forwarded to REA as in flow 1
```

## 4. Denied without contacting REA

```mermaid
sequenceDiagram
    autonumber
    participant A as AI agent
    participant G as Governance proxy
    participant L as Audit log
    participant R as REA (rea mcp)

    A->>G: tools/call (unknown tool, or tier above the limit, or tier 3)
    G->>L: tool_call deny with rule id (R1, R2 or R4)
    G-->>A: MCP error result with the rule and reason
    Note over G,R: REA is never contacted
```

## 5. Runtime-capture tool inside a sandbox (future)

Today every tier 3 tool is denied (R4). The intended flow once a sandbox controller exists:

```mermaid
sequenceDiagram
    autonumber
    participant A as AI agent
    participant G as Governance proxy
    participant S as Sandbox controller
    participant R as REA (rea mcp)
    participant L as Audit log

    A->>G: tools/call (tier 3 tool, target)
    G->>G: Authorization with reference, second approval, role check
    G->>S: Provision isolated VM or container
    S-->>G: Sandbox ready
    G->>R: Forward call, scoped to the sandbox
    R-->>G: Observations + Evidence
    G->>S: Tear down
    G->>L: tool_call, sandbox id, evidence_id
    G-->>A: Result
```
