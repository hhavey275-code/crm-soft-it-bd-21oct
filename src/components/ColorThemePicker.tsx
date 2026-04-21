import { Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useColorTheme, type ColorTheme } from "@/contexts/ColorThemeContext";

const themes: { value: ColorTheme; label: string; color: string }[] = [
  { value: "blue", label: "Blue", color: "bg-blue-500" },
  { value: "orange", label: "Orange", color: "bg-orange-500" },
  { value: "green", label: "Green", color: "bg-emerald-500" },
];

export function ColorThemePicker() {
  const { colorTheme, setColorTheme } = useColorTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Color theme">
          <Palette className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {themes.map((t) => (
          <DropdownMenuItem
            key={t.value}
            onClick={() => setColorTheme(t.value)}
            className="gap-2"
          >
            <span className={`h-3 w-3 rounded-full ${t.color}`} />
            {t.label}
            {colorTheme === t.value && <span className="ml-auto text-xs">✓</span>}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
