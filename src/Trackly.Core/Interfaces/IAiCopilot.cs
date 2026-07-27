namespace Trackly.Core.Interfaces;

// Thin wrapper over the LLM. One text-in / text-out call; the Modules layer owns
// prompt construction and the guardrails (no internal notes, workspace-scoped
// data only, never auto-send). IsConfigured is false when no API key is set, so
// callers can degrade gracefully instead of throwing.
public interface IAiCopilot
{
    bool IsConfigured { get; }

    Task<string> CompleteAsync(
        string systemPrompt, string userPrompt, int maxTokens, CancellationToken cancellationToken = default);
}
