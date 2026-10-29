using System.Text.Json;
using System.Text;
using System.Text.RegularExpressions;
namespace MedicalQcWebDemo;
// Finite transport DATA only, never glyph/source custody or semantic math authority.
internal static class NativeMathEnvelope
{
    private static readonly Regex Id=new(@"^[A-Za-z0-9._-]{1,128}$",RegexOptions.CultureInvariant);
    private readonly record struct Box(double X,double Y,double W,double H);
    private static bool Contains(Box a,Box b)=>b.X>=a.X&&b.Y>=a.Y&&b.X+b.W<=a.X+a.W&&b.Y+b.H<=a.Y+a.H;
    private static bool Fields(JsonElement e,params string[] keys)=>e.ValueKind==JsonValueKind.Object&&e.EnumerateObject().Count()==keys.Length&&e.EnumerateObject().All(p=>keys.Contains(p.Name,StringComparer.Ordinal));
    private static string Str(JsonElement e)=>e.ValueKind==JsonValueKind.String?e.GetString()!:throw new InvalidDataException();
    private static bool ValidId(string s)=>Id.IsMatch(s);
    private static double Number(JsonElement e){if(e.ValueKind!=JsonValueKind.Number||!e.TryGetDouble(out var n)||!double.IsFinite(n))throw new InvalidDataException();return n;}
    private static int Index(JsonElement e,int max=100000){var n=Number(e);return n>=0&&n<=max&&n==Math.Truncate(n)?(int)n:throw new InvalidDataException();}
    private static JsonElement[] List(JsonElement e,int max)=>e.ValueKind==JsonValueKind.Array&&e.GetArrayLength()<=max?e.EnumerateArray().ToArray():throw new InvalidDataException();
    private static Box ReadBox(JsonElement e,Box frame){if(!Fields(e,"x","y","width","height"))throw new InvalidDataException();var b=new Box(Number(e.GetProperty("x")),Number(e.GetProperty("y")),Number(e.GetProperty("width")),Number(e.GetProperty("height")));if(b.X<0||b.Y<0||b.W<=0||b.H<=0||b.X+b.W<=b.X||b.Y+b.H<=b.Y||!Contains(frame,b))throw new InvalidDataException();return b;}
    internal static bool Valid(string json,out string? literal)
    {
        literal=null;
        try{
            if(json.Length>16384)return false;
            using var document=JsonDocument.Parse(json,new JsonDocumentOptions{MaxDepth=16});int work=0,units=0,glyphCount=0;
            void Walk(JsonElement e){if(++work>4096)throw new InvalidDataException();if(e.ValueKind==JsonValueKind.Object){var keys=new HashSet<string>(StringComparer.Ordinal);foreach(var p in e.EnumerateObject()){if(!keys.Add(p.Name))throw new InvalidDataException();Walk(p.Value);}}else if(e.ValueKind==JsonValueKind.Array)foreach(var child in e.EnumerateArray())Walk(child);else if(e.ValueKind==JsonValueKind.Number)Number(e);}
            Walk(document.RootElement);var l=document.RootElement;
            if(!Fields(l,"version","frame","sourceBox","literal","tokens","bars","relations","glyphStatus","barStatus")||Str(l.GetProperty("version"))!="native-math-v1")return false;
            var f=l.GetProperty("frame");if(!Fields(f,"width","height"))return false;var frame=new Box(0,0,Number(f.GetProperty("width")),Number(f.GetProperty("height")));if(frame.W<=0||frame.H<=0||frame.W>16384||frame.H>16384)return false;var crop=ReadBox(l.GetProperty("sourceBox"),frame);
            string Text(JsonElement e){var s=Str(e);units+=s.Length;if(units>4096||s.Any(c=>c<=8||c==11||c==12||c>=14&&c<=31||c>=127&&c<=159)||new[]{"[[MTQC:","[[MATH:","[[CELL:","[[NOTE:","[[/MTQC]]"}.Any(s.Contains))throw new InvalidDataException();return s;}
            literal=Text(l.GetProperty("literal"));if(string.IsNullOrWhiteSpace(literal))return false;var glyphStatus=Str(l.GetProperty("glyphStatus"));var barStatus=Str(l.GetProperty("barStatus"));if(glyphStatus is not("unknown" or "mapped-unverified")||barStatus is not("unknown" or "source-bound-unverified"))return false;
            var tokens=new Dictionary<string,Box>(StringComparer.Ordinal);var indices=new HashSet<int>();
            foreach(var t in List(l.GetProperty("tokens"),64)){
                if(!Fields(t,"id","sourceIndex","text","box","glyphs"))return false;var id=Str(t.GetProperty("id"));var index=Index(t.GetProperty("sourceIndex"),9999);if(!ValidId(id)||!Regex.IsMatch(id,@"^p[1-9][0-9]*-f"+index+"$",RegexOptions.CultureInvariant)||!indices.Add(index))return false;var b=ReadBox(t.GetProperty("box"),frame);if(!Contains(crop,b)||!tokens.TryAdd(id,b))return false;var text=Text(t.GetProperty("text"));if(string.IsNullOrWhiteSpace(text))return false;
                if(glyphStatus=="unknown"){if(t.GetProperty("glyphs").ValueKind!=JsonValueKind.Null)return false;}
                else{var gs=List(t.GetProperty("glyphs"),4096);glyphCount+=gs.Length;if(gs.Length==0||glyphCount>4096)return false;var collected="";int? op=null;for(int i=0;i<gs.Length;i++){var g=gs[i];if(!Fields(g,"glyphOrdinal","operatorIndex","unicode","box","painted")||Index(g.GetProperty("glyphOrdinal"))!=i)return false;var operation=Index(g.GetProperty("operatorIndex"));if(op is not null&&op!=operation)return false;op=operation;var unicode=Text(g.GetProperty("unicode"));if(unicode.EnumerateRunes().Count()!=1||g.GetProperty("painted").ValueKind is not(JsonValueKind.True or JsonValueKind.False))return false;collected+=unicode;if(g.GetProperty("box").ValueKind==JsonValueKind.Null){if(g.GetProperty("painted").GetBoolean()||unicode!=" ")return false;}else if(!Contains(crop,ReadBox(g.GetProperty("box"),frame)))return false;}if(collected!=text)return false;}
            }
            if(tokens.Count==0)return false;var bars=new Dictionary<string,Box>(StringComparer.Ordinal);var operations=new HashSet<int>();
            foreach(var b in List(l.GetProperty("bars"),32)){if(!Fields(b,"id","operatorIndex","line","box"))return false;var id=Str(b.GetProperty("id"));if(!ValidId(id)||!operations.Add(Index(b.GetProperty("operatorIndex"))))return false;var line=b.GetProperty("line");if(!Fields(line,"x1","y1","x2","y2"))return false;var x1=Number(line.GetProperty("x1"));var x2=Number(line.GetProperty("x2"));var y=Number(line.GetProperty("y1"));var bb=ReadBox(b.GetProperty("box"),frame);if(y!=Number(line.GetProperty("y2"))||x2<=x1||bb.X!=x1||bb.W!=x2-x1||bb.Y+bb.H/2!=y||bb.H>2||!Contains(crop,bb)||!bars.TryAdd(id,bb))return false;}
            if(barStatus=="unknown"&&bars.Count>0)return false;
            var usedBars=new HashSet<string>(StringComparer.Ordinal);var parents=new HashSet<string>(StringComparer.Ordinal);var graph=tokens.Keys.ToDictionary(k=>k,_=>new List<string>(),StringComparer.Ordinal);
            string[] Refs(JsonElement e){var names=List(e,64).Select(Str).ToArray();if(names.Length==0||names.Distinct(StringComparer.Ordinal).Count()!=names.Length||names.Any(n=>!tokens.ContainsKey(n)))throw new InvalidDataException();return names;}
            bool Within(string[] ids,Box bar,bool above)=>ids.All(id=>{var t=tokens[id];return t.X>=bar.X&&t.X+t.W<=bar.X+bar.W&&(above?t.Y+t.H<bar.Y:t.Y>bar.Y+bar.H);});
            foreach(var r in List(l.GetProperty("relations"),64)){
                var kind=Str(r.GetProperty("kind"));
                if(kind is "fraction" or "underbar" or "overbar"){
                    if(!Fields(r,kind=="fraction"?["kind","barId","numeratorIds","denominatorIds"]:["kind","barId","tokenIds"]))return false;var id=Str(r.GetProperty("barId"));if(barStatus!="source-bound-unverified"||!bars.TryGetValue(id,out var bar)||!usedBars.Add(id))return false;
                    if(kind=="fraction"){var n=Refs(r.GetProperty("numeratorIds"));var d=Refs(r.GetProperty("denominatorIds"));if(n.Intersect(d,StringComparer.Ordinal).Any()||!Within(n,bar,true)||!Within(d,bar,false))return false;}else if(!Within(Refs(r.GetProperty("tokenIds")),bar,kind=="underbar"))return false;
                }else if(kind is "subscript" or "superscript"){
                    if(!Fields(r,"kind","baseId","scriptIds"))return false;var id=Str(r.GetProperty("baseId"));if(!tokens.TryGetValue(id,out var b))return false;foreach(var name in Refs(r.GetProperty("scriptIds"))){var t=tokens[name];if(name==id||!parents.Add(name)||t.X<b.X||(kind=="subscript"?t.Y<=b.Y:t.Y>=b.Y))return false;graph[id].Add(name);}
                }else return false;
            }
            var active=new HashSet<string>(StringComparer.Ordinal);var done=new HashSet<string>(StringComparer.Ordinal);bool Visit(string id){if(active.Contains(id))return false;if(done.Contains(id))return true;active.Add(id);foreach(var child in graph[id])if(!Visit(child))return false;active.Remove(id);done.Add(id);return true;}return tokens.Keys.All(Visit);
        }catch(Exception e)when(e is JsonException or InvalidDataException or InvalidOperationException or KeyNotFoundException or ArgumentException or OverflowException){return false;}
    }
}
