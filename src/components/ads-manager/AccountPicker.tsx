import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { matchesSearch } from "@/lib/searchNormalize";

type Account = { id: string; name: string; account_id: string; kind: string };
const label = (a: Account) => `${a.name} (${String(a.account_id).replace(/^act_/, "")})`;

export function AccountPicker({ accounts, value, onChange }: { accounts: Account[]; value?: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = accounts.find((a) => a.id === value);
  const filtered = accounts.filter((a) => matchesSearch(search, a.name, a.account_id));
  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setSearch(""); }}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-label="Ad account বাছুন" aria-expanded={open} disabled={!accounts.length} className="h-9 w-full justify-between gap-2 border-fb-border text-[13px] sm:w-auto sm:min-w-[260px] sm:max-w-[360px]">
          <span className="min-w-0 truncate">{selected ? label(selected) : "Ad account বাছুন"}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(460px,calc(100vw-2rem))] p-0">
        <Command shouldFilter={false}>
          <CommandInput aria-label="Search ad accounts" placeholder="Account-এর নাম বা ID খুঁজুন…" value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>কোনো ad account পাওয়া যায়নি।</CommandEmpty>
            {(["own", "shared"] as const).map((kind) => filtered.some((a) => a.kind === kind) && (
              <CommandGroup key={kind} heading={kind === "own" ? "আপনার Ad Accounts" : "Shared Ad Accounts (wallet)"}>
                {filtered.filter((a) => a.kind === kind).map((a) => (
                  <CommandItem key={a.id} value={a.id} onSelect={() => { onChange(a.id); setOpen(false); setSearch(""); }} className="items-start">
                    <span className="min-w-0 flex-1 break-words">{label(a)}</span>
                    {a.id === value && <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}