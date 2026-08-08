namespace Trackly.Modules.Tickets;

/// <summary>
/// What a workspace is allowed to attach, and what it is served back as.
///
/// **An allowlist.** Anything not named below is refused, which is the strict
/// end of the trade: a customer with a .pcap or a vendor .msg export cannot
/// attach it and has to be told another way. That is the deliberate cost of not
/// having to reason about what an unknown format might do.
///
/// **The map IS the policy.** Each extension names the single content type
/// Trackly will serve that file under — derived from the extension, never from
/// the upload header. That removes the attacker-controlled type entirely rather
/// than sanitising it: the uploader's declared type is not consulted on the way
/// out at all.
/// </summary>
public static class UploadPolicy
{
    /// <summary>
    /// Extension → the one type it is served as.
    ///
    /// Several entries are pairs of the same format under two names. Rejecting
    /// one half of a pair is never what anybody means — a desk that accepts
    /// <c>.jpg</c> and refuses <c>.jpeg</c> looks broken to the person whose
    /// phone chose the other one.
    /// </summary>
    private static readonly Dictionary<string, string> Allowed = new(StringComparer.OrdinalIgnoreCase)
    {
        // ---- Images ----
        [".jpg"] = "image/jpeg",
        // Same format, the other spelling. Which one you get depends on the
        // camera, the OS and the screenshot tool, and none of that is a choice
        // the person attaching it made.
        [".jpeg"] = "image/jpeg",
        [".png"] = "image/png",

        // ---- Video ----
        // Both are capped by the 10 MB attachment limit, so in practice these
        // carry a few seconds of screen recording. That limit is the thing to
        // raise if real video is wanted, not this list.
        [".mp4"] = "video/mp4",
        [".mov"] = "video/quicktime",

        // ---- Audio ----
        [".mp3"] = "audio/mpeg",
        [".wav"] = "audio/wav",

        // ---- Documents ----
        [".txt"] = "text/plain",
        [".pdf"] = "application/pdf",
        [".doc"] = "application/msword",
        [".docx"] = "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        // .xls is the pre-2007 format. A list with .xls but not .xlsx would
        // reject every spreadsheet saved by Excel in the last eighteen years,
        // which is the opposite of the intent.
        [".xls"] = "application/vnd.ms-excel",
        [".xlsx"] = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        [".csv"] = "text/csv",
    };

    /// <summary>
    /// Types the browser is allowed to render rather than download.
    ///
    /// Only images. Everything else — including PDF, which has a scripting
    /// engine, and the Office formats, which are zip archives — is downloaded.
    /// An inline PDF renders in Trackly's origin, and that is a surface worth
    /// declining for the sake of one extra click.
    /// </summary>
    private static readonly HashSet<string> RenderInline = new(StringComparer.OrdinalIgnoreCase)
    {
        "image/jpeg", "image/png",
    };

    /// <summary>What the file picker puts in its `accept` attribute.</summary>
    public static string AcceptList => string.Join(",", Allowed.Keys.Order());

    /// <summary>
    /// Rejects a file, or returns null when it is allowed.
    ///
    /// The message lists what IS accepted. "That file type is not allowed" sends
    /// somebody back to guess, and the usual second guess is the same file
    /// renamed — which this would also refuse, because only the final extension
    /// is consulted.
    /// </summary>
    public static string? Reject(string fileName)
    {
        var extension = Path.GetExtension(fileName);

        if (extension.Length == 0)
            return "That file has no extension, so Trackly can't tell what it is. "
                   + $"Accepted types: {Friendly}.";

        return Allowed.ContainsKey(extension)
            ? null
            : $"\"{extension}\" files can't be attached. Accepted types: {Friendly}.";
    }

    /// <summary>
    /// What the download response says the bytes are.
    ///
    /// **Derived from the extension, never from what was uploaded.** The stored
    /// content type arrived as a header and nothing has checked it against the
    /// bytes, so it is not consulted here at all — a .png whose upload claimed
    /// text/html still comes back as image/png.
    ///
    /// The octet-stream fallback is for rows written before this policy existed:
    /// the allowlist stops anything new getting in, and history still has to
    /// download.
    /// </summary>
    public static string SafeContentType(string fileName, string? storedContentType)
    {
        var extension = Path.GetExtension(fileName);
        return Allowed.TryGetValue(extension, out var type) ? type : "application/octet-stream";
    }

    /// <summary>
    /// Whether the browser may display this inline instead of downloading it.
    ///
    /// Images only. This is what lets a screenshot preview in the thread without
    /// giving a PDF or a Word document the same permission.
    /// </summary>
    public static bool CanRenderInline(string fileName) =>
        Allowed.TryGetValue(Path.GetExtension(fileName), out var type) && RenderInline.Contains(type);

    /// <summary>The accepted list, for an error somebody has to act on.</summary>
    private static string Friendly =>
        string.Join(", ", Allowed.Keys.Order().Select(k => k.TrimStart('.')));
}
