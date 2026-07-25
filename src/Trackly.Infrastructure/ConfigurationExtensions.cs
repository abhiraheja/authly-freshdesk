// ReSharper disable once CheckNamespace — deliberately in the config namespace so
// it's in scope anywhere IConfiguration is already used.
namespace Microsoft.Extensions.Configuration;

public static class TracklyConfigurationExtensions
{
    // Returns the value for key, or null when it is absent OR empty/whitespace.
    // appsettings.json ships discoverable "" placeholders; an empty string must be
    // treated as "not set" so `?? default` and validation behave correctly.
    public static string? GetNonEmpty(this IConfiguration configuration, string key)
    {
        var value = configuration[key];
        return string.IsNullOrWhiteSpace(value) ? null : value;
    }
}
