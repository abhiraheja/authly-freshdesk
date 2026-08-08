using Microsoft.EntityFrameworkCore;
using Trackly.Core.Entities;
using Trackly.Infrastructure.Data;

namespace Trackly.Modules;

/// <summary>
/// Resolving the workspace on surfaces that have no session to read it from —
/// guest ticket views, live chat, public branding, the widget, CSAT, SSO start.
///
/// Trackly is self-hosted: one deployment, one workspace. The slug survives
/// because those surfaces already pass <c>?workspace=</c> in links that are out
/// in the wild, and breaking them to remove a parameter nobody is asked to
/// invent would be a poor trade. New links can simply omit it.
/// </summary>
public static class WorkspaceLookup
{
    /// <summary>
    /// The workspace named by <paramref name="slug"/>, or the installation's own
    /// workspace when no slug is given. Null means "no such workspace" — for the
    /// slug-less case that only happens before first-run setup.
    /// </summary>
    public static Task<Workspace?> ResolveWorkspaceAsync(
        this TracklyDbContext db, string? slug, CancellationToken ct)
        => string.IsNullOrWhiteSpace(slug)
            // Oldest-first rather than SingleOrDefault. A database carried over
            // from when Trackly could hold several workspaces would make Single
            // throw, and that would take sign-in down entirely — a far worse
            // failure than deterministically picking the original one.
            ? db.Workspaces.OrderBy(w => w.CreatedAt).FirstOrDefaultAsync(ct)
            : db.Workspaces.SingleOrDefaultAsync(w => w.Slug == slug, ct);
}
