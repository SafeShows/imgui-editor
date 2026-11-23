// Writes the game's ImGui style (every ImGuiStyle field, every color, the font size) to
// <Documents>/My Games/Kitten Space Agency/imgui_style.json once, on the first GUI frame.
using System.Globalization;
using System.Reflection;
using System.Text;
using Brutal.ImGuiApi;
using StarMap.API;

namespace ImGuiStyleDump;

[StarMapMod]
public sealed class StyleDump
{
    bool _done;

    [StarMapAfterGui]
    public unsafe void OnGui(double dt)
    {
        if (_done) return;
        _done = true;
        try
        {
            static string F(float f) => f.ToString("R", CultureInfo.InvariantCulture);
            static string V(object v) => v switch
            {
                float f => F(f),
                bool b => b ? "true" : "false",
                Enum e => Convert.ToInt64(e).ToString(CultureInfo.InvariantCulture),
                _ when v.GetType().Name == "Bool8" => v.ToString()!.ToLowerInvariant() is "true" or "1" ? "true" : "false",
                _ => "[" + string.Join(", ", v.GetType().GetFields(BindingFlags.Public | BindingFlags.Instance).Where(f => f.FieldType == typeof(float)).Select(f => F((float)f.GetValue(v)!))) + "]",
            };
            var style = *ImGui.GetStyle().Ptr;
            var sb = new StringBuilder("{\n  \"vars\": {\n");
            var fields = typeof(ImGuiStyle).GetFields(BindingFlags.Public | BindingFlags.Instance).Where(f => f.Name != "Colors" && !f.Name.StartsWith('_')).ToList();
            for (int i = 0; i < fields.Count; i++)
                sb.Append($"    \"{fields[i].Name}\": {V(fields[i].GetValue(style)!)}{(i < fields.Count - 1 ? "," : "")}\n");
            sb.Append("  },\n  \"colors\": {\n");
            var cols = Enum.GetValues<ImGuiCol>().Where(c => (int)c >= 0 && Enum.GetName(c) is { } n && n != "COUNT").Distinct().ToList();
            for (int i = 0; i < cols.Count; i++)
            {
                var c = ImGui.GetStyleColorVec4(cols[i]);
                sb.Append($"    \"{cols[i]}\": [{F(c.X)}, {F(c.Y)}, {F(c.Z)}, {F(c.W)}]{(i < cols.Count - 1 ? "," : "")}\n");
            }
            sb.Append($"  }},\n  \"fontSize\": {F(ImGui.GetFontSize())},\n  \"version\": \"{ImGui.GetVersion()}\"\n}}\n");
            var path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "My Games", "Kitten Space Agency", "imgui_style.json");
            File.WriteAllText(path, sb.ToString());
            Console.WriteLine($"[ImGuiStyleDump] wrote {path}");
        }
        catch (Exception e)
        {
            Console.WriteLine($"[ImGuiStyleDump] failed: {e}");
        }
    }
}
