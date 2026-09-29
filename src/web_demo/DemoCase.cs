namespace MedicalQcWebDemo;

public sealed class DemoCase
{
    public string Id { get; set; } = "";
    public string Title { get; set; } = "";
    public string Mode { get; set; } = "";
    public string GeneratedUtc { get; set; } = "";
    public string Generator { get; set; } = "";
    public string Scope { get; set; } = "";
    public DemoSource Source { get; set; } = new();
    public List<DemoTranslation> Translations { get; set; } = [];
}

public sealed class DemoSource
{
    public string Citation { get; set; } = "";
    public string Url { get; set; } = "";
    public string License { get; set; } = "";
    public string Modifications { get; set; } = "";
    public string Preview { get; set; } = "";
    public List<DemoSection> Sections { get; set; } = [];
}

public sealed class DemoTranslation
{
    public string Language { get; set; } = "";
    public string Status { get; set; } = "";
    public string Preview { get; set; } = "";
    public string Download { get; set; } = "";
    public List<DemoSection> Sections { get; set; } = [];
    public List<DemoFinding> Findings { get; set; } = [];
}

public sealed class DemoSection
{
    public string Id { get; set; } = "";
    public string Label { get; set; } = "";
    public string Text { get; set; } = "";
}

public sealed class DemoFinding
{
    public string Id { get; set; } = "";
    public string Title { get; set; } = "";
    public string Status { get; set; } = "";
    public string Basis { get; set; } = "";
    public string SourceSection { get; set; } = "";
    public string TargetSection { get; set; } = "";
}
