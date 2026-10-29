namespace QCStatusBoard;

// Word range probes are not glyph ink bounds or rendered inline rectangles.
public sealed class RenderedGeometrySnapshot
{
    public int SchemaVersion { get; set; }
    public string Scope { get; set; } = "";
    public bool Complete { get; set; }
    public int RootStoryCount { get; set; }
    public int MainParagraphCount { get; set; }
    public int MainInlineShapeCount { get; set; }
    public List<StoryGeometry> Stories { get; set; } = [];
}
public sealed class StoryGeometry
{
    public int StoryType { get; set; }
    public int ChainIndex { get; set; }
    public int ParagraphCount { get; set; }
    public int InlineShapeCount { get; set; }
    public List<ParagraphGeometry> Paragraphs { get; set; } = [];
    public List<InlineGeometry> InlineShapes { get; set; } = [];
}
public sealed class GeometryPoint
{
    public int Page { get; set; }
    public double? X { get; set; }
    public double? Y { get; set; }
}
public sealed class ParagraphGeometry
{
    public int Index { get; set; }
    public GeometryPoint? Start { get; set; }
    public GeometryPoint? End { get; set; }
}
public sealed class InlineGeometry
{
    public int Index { get; set; }
    public GeometryPoint? Anchor { get; set; }
    public double? Width { get; set; }
    public double? Height { get; set; }
}

public static class RenderedGeometry
{
    public const string Scope = "all-enumerated-word-stories";
    public const double TolerancePoints = .5;
    public static IReadOnlyList<string> Validate(RenderedGeometrySnapshot? value, string role,
        int? expectedMainParagraphs = null, int? expectedMainInlines = null)
    {
        var issues = new List<string>();
        if (value is null || value.SchemaVersion != 1) { issues.Add(role + "_geometry_version_unverified"); return issues; }
        if (value.Scope != Scope || !value.Complete || value.Stories is null || value.RootStoryCount < 1
            || value.MainParagraphCount < 1 || value.MainInlineShapeCount < 0
            || expectedMainParagraphs is { } paragraphs && paragraphs != value.MainParagraphCount
            || expectedMainInlines is { } inlines && inlines != value.MainInlineShapeCount)
        { issues.Add(role + "_geometry_coverage_unverified"); return issues; }
        var stories = value.Stories;
        if (stories.Any(s => s is null || s.StoryType is < 1 or > 17 || s.ChainIndex < 0)
            || stories.Select(s => (s.StoryType, s.ChainIndex)).Distinct().Count() != stories.Count)
        { issues.Add(role + "_story_coverage_invalid"); return issues; }
        var roots = stories.GroupBy(s => s.StoryType).ToArray();
        if (roots.Length != value.RootStoryCount || roots.Any(g => !g.Select(s => s.ChainIndex).Order()
            .SequenceEqual(Enumerable.Range(0, g.Count())))) issues.Add(role + "_story_coverage_incomplete");
        var main = stories.SingleOrDefault(s => s.StoryType == 1 && s.ChainIndex == 0);
        if (main is null || main.ParagraphCount != value.MainParagraphCount || main.InlineShapeCount != value.MainInlineShapeCount)
            issues.Add(role + "_main_story_coverage_incomplete");
        foreach (var story in stories)
        {
            var key = $"{role}_story_{story.StoryType}_{story.ChainIndex}";
            if (story.ParagraphCount < 0 || story.InlineShapeCount < 0 || story.Paragraphs is null || story.InlineShapes is null
                || story.Paragraphs.Any(p => p is null) || story.InlineShapes.Any(p => p is null)
                || !story.Paragraphs.Select(p => p.Index).SequenceEqual(Enumerable.Range(1, story.ParagraphCount))
                || !story.InlineShapes.Select(p => p.Index).SequenceEqual(Enumerable.Range(1, story.InlineShapeCount)))
            { issues.Add(key + "_member_coverage_incomplete"); continue; }
            foreach (var p in story.Paragraphs)
            {
                if (!Valid(p.Start)) issues.Add(key + $"_paragraph_{p.Index}_start_unavailable");
                if (!Valid(p.End)) issues.Add(key + $"_paragraph_{p.Index}_end_unavailable");
            }
            foreach (var image in story.InlineShapes)
                if (!Valid(image.Anchor) || !Positive(image.Width) || !Positive(image.Height))
                    issues.Add(key + $"_inline_{image.Index}_geometry_unavailable");
        }
        return issues;
    }
    public static IReadOnlyList<string> Compare(RenderedGeometrySnapshot? source, RenderedGeometrySnapshot? target)
    {
        var issues = Validate(source, "source").Concat(Validate(target, "target")).ToList();
        if (issues.Count > 0) return issues;
        var left = source!.Stories.ToDictionary(s => (s.StoryType, s.ChainIndex));
        var right = target!.Stories.ToDictionary(s => (s.StoryType, s.ChainIndex));
        if (!left.Keys.ToHashSet().SetEquals(right.Keys)) { issues.Add("geometry_story_coverage_changed"); return issues; }
        foreach (var (id, a) in left)
        {
            var b = right[id]; var key = $"story_{id.StoryType}_{id.ChainIndex}";
            if (a.ParagraphCount != b.ParagraphCount || a.InlineShapeCount != b.InlineShapeCount)
            { issues.Add(key + "_member_coverage_changed"); continue; }
            for (var i = 0; i < a.Paragraphs.Count; i++)
            {
                ComparePoint(issues, key + $"_paragraph_{i + 1}_start", a.Paragraphs[i].Start!, b.Paragraphs[i].Start!);
                ComparePoint(issues, key + $"_paragraph_{i + 1}_end", a.Paragraphs[i].End!, b.Paragraphs[i].End!);
            }
            for (var i = 0; i < a.InlineShapes.Count; i++)
            {
                var x = a.InlineShapes[i]; var y = b.InlineShapes[i]; var label = key + $"_inline_{i + 1}";
                ComparePoint(issues, label + "_anchor", x.Anchor!, y.Anchor!);
                CompareNumber(issues, label + "_width", x.Width!.Value, y.Width!.Value);
                CompareNumber(issues, label + "_height", x.Height!.Value, y.Height!.Value);
            }
        }
        return issues;
    }
    private static bool Coordinate(double? value) => value is >= 0 && double.IsFinite(value.Value);
    private static bool Positive(double? value) => Coordinate(value) && value > 0;
    private static bool Valid(GeometryPoint? p) => p is not null && p.Page > 0 && Coordinate(p.X) && Coordinate(p.Y);
    private static void ComparePoint(List<string> issues, string name, GeometryPoint a, GeometryPoint b)
    {
        if (a.Page != b.Page) issues.Add(name + "_page_changed");
        CompareNumber(issues, name + "_x", a.X!.Value, b.X!.Value);
        CompareNumber(issues, name + "_y", a.Y!.Value, b.Y!.Value);
    }
    private static void CompareNumber(List<string> issues, string name, double a, double b)
    { if (Math.Abs(a - b) > TolerancePoints) issues.Add(name + "_changed"); }
}
