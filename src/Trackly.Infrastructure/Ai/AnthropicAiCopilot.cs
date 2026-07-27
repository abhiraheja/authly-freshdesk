using Anthropic;
using Anthropic.Models.Messages;
using Microsoft.Extensions.Configuration;
using Trackly.Core.Interfaces;

namespace Trackly.Infrastructure.Ai;

// Claude-backed copilot via the official Anthropic .NET SDK. Model defaults to
// claude-opus-5 and is overridable with Ai:Model; the API key comes from
// Ai:ApiKey (a deployment secret). Effort is capped low — these are bounded
// draft/summarize/triage tasks and the agent is waiting on the response.
public class AnthropicAiCopilot : IAiCopilot
{
    private readonly string? _apiKey;
    private readonly string _model;

    public AnthropicAiCopilot(IConfiguration configuration)
    {
        _apiKey = configuration.GetNonEmpty("Ai:ApiKey");
        _model = configuration.GetNonEmpty("Ai:Model") ?? "claude-opus-5";
    }

    public bool IsConfigured => !string.IsNullOrEmpty(_apiKey);

    public async Task<string> CompleteAsync(
        string systemPrompt, string userPrompt, int maxTokens, CancellationToken cancellationToken = default)
    {
        if (!IsConfigured)
            throw new InvalidOperationException("AI is not configured (Ai:ApiKey is unset).");

        AnthropicClient client = new() { ApiKey = _apiKey };
        var response = await client.Messages.Create(new MessageCreateParams
        {
            Model = _model,
            MaxTokens = maxTokens,
            System = systemPrompt,
            OutputConfig = new OutputConfig { Effort = Effort.Low },
            Messages = [new() { Role = Role.User, Content = userPrompt }],
        }, cancellationToken: cancellationToken);

        // Concatenate the text blocks; ignore any thinking/other block types.
        var text = string.Concat(response.Content.Select(b => b.Value).OfType<TextBlock>().Select(t => t.Text));
        return text.Trim();
    }
}
